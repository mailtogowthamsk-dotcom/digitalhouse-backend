import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import mysql, { type Connection } from "mysql2/promise";
import { Sequelize, QueryTypes } from "sequelize";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Set PUBLICATION_TEST_SOCKET to a disposable local MySQL socket. This suite
// creates its own schema and only uses fake push tokens and a stubbed provider.
const socketPath = process.env.PUBLICATION_TEST_SOCKET;
const schema = "publication_test_" + randomUUID().replace(/-/g, "");
vi.mock("../../src/config/db", () => ({
  sequelize: new Sequelize(schema, "root", "", {
    dialect: "mysql", dialectOptions: { socketPath }, logging: false,
    define: { charset: "utf8mb4" }
  })
}));
vi.mock("../../src/services/ExpoPush.service", () => ({ sendExpoPush: vi.fn() }));

describe.skipIf(!socketPath)("Prominent People publication", () => {
  let admin: Connection;
  let db: Sequelize;
  let models: typeof import("../../src/models");
  let people: typeof import("../../src/services/ProminentPeople.service");
  let jobs: typeof import("../../src/services/ProminentPublication.service");
  let categoryId: number;

  beforeAll(async () => {
    admin = await mysql.createConnection({ socketPath, user: "root", multipleStatements: true });
    await admin.query(`CREATE DATABASE ${schema} CHARACTER SET utf8mb4`);
    await admin.query(`USE ${schema}`);
    db = (await import("../../src/config/db")).sequelize;
    models = await import("../../src/models");
    for (const model of [models.User, models.Notification, models.NotificationPreference,
      models.PushDeviceToken, models.ProminentCategory, models.ProminentPerson,
      models.ProminentGalleryItem, models.ProminentTimelineEntry]) {
      await model.sync();
    }
    categoryId = (await models.ProminentCategory.create({ code: "arts", label: "Arts" } as any)).id;
    people = await import("../../src/services/ProminentPeople.service");
    jobs = await import("../../src/services/ProminentPublication.service");

    await models.ProminentPerson.create({ fullName: "Existing", categoryId, isPublished: true } as any);
    const sql = readFileSync("db/migrations/20261118220000_prominent_publication_announcements/up.sql", "utf8");
    await admin.query(sql);
    await admin.query(sql);
  });

  afterAll(async () => {
    await db?.close();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS ${schema}`);
      await admin.end();
    }
  });

  it("keeps legacy profiles silent and rolls back a failed publication", async () => {
    const legacy = await models.ProminentPerson.findOne({ where: { fullName: "Existing" } });
    await people.setPublished(legacy!.id, false, "admin");
    await people.setPublished(legacy!.id, true, "admin");
    expect(await jobs.preparePublicationPage()).toBe(false);
    const failure = vi.spyOn(models.ProminentGalleryItem, "bulkCreate")
      .mockRejectedValueOnce(new Error("gallery failed"));
    try {
      await expect(people.createPerson({
        fullName: "Failed", categoryId, isPublished: true, gallery: [{ imageKey: "photo" }]
      }, "admin")).rejects.toThrow("gallery failed");
      expect(await models.ProminentPerson.count({ where: { fullName: "Failed" } })).toBe(0);
      expect(await jobs.preparePublicationPage()).toBe(false);
    } finally {
      failure.mockRestore();
    }
    const created = await people.createPerson({ fullName: "Direct", categoryId, isPublished: true }, "admin");
    expect(created.isPublished).toBe(true);
    expect(await jobs.preparePublicationPage()).toBe(true);
    expect(await jobs.preparePublicationPage()).toBe(false);
  });

  it("announces once, honors preferences and resumes only outstanding devices", async () => {
    await models.User.bulkCreate(["APPROVED", "APPROVED", "APPROVED", "PENDING", "APPROVED"].map((status, i) => ({
      id: i + 1, status, email: `member${i}@test.local`, fullName: "Member"
    })) as any);
    await models.NotificationPreference.bulkCreate([
      { userId: 2, pushEnabled: false }, { userId: 3, communityEnabled: false }
    ] as any);
    await models.PushDeviceToken.bulkCreate([1, 1, 2, 3, 4].map((userId, i) => ({
      token: `ExpoPushToken[fake${i}]`, userId, platform: "android", lastUsedAt: new Date()
    })) as any);
    const draft = await people.createPerson({ fullName: "Test Person", categoryId }, "admin");
    expect(await jobs.preparePublicationPage()).toBe(false);
    await Promise.all([
      people.setPublished(draft.id, true, "admin"),
      people.updatePerson(draft.id, { isPublished: true }, "admin")
    ]);
    await people.setFeatured(draft.id, true, "admin");
    await people.setPublished(draft.id, false, "admin");
    await people.setPublished(draft.id, true, "admin");
    await Promise.all([jobs.preparePublicationPage(), jobs.preparePublicationPage()]);
    expect(await jobs.preparePublicationPage()).toBe(false);

    const rows = await models.Notification.findAll({ order: [["userId", "ASC"]] });
    expect(rows.map(row => row.userId)).toEqual([1, 2, 5]);
    const { toNotificationDto } = await import("../../src/services/NotificationPlatform.service");
    expect(await toNotificationDto(rows[0])).toMatchObject({
      actionTargetId: null, prominentPersonId: String(draft.id), category: "COMMUNITY"
    });

    const { sendExpoPush } = await import("../../src/services/ExpoPush.service");
    let retry = true;
    const sends = vi.mocked(sendExpoPush).mockImplementation(async ([message]) => {
      if (retry && message.to.endsWith("[fake1]")) {
        retry = false;
        return { sent: 0, invalidTokens: [] };
      }
      return { sent: 1, invalidTokens: [] };
    });
    await Promise.all([jobs.deliverPublicationBatch(), jobs.deliverPublicationBatch()]);
    expect(sends).toHaveBeenCalledTimes(2);
    expect(sends.mock.calls[0][0][0].data).toMatchObject({
      notificationId: "0", publicationNotificationId: String(rows[0].id),
      actionType: "OPEN_PROMINENT_PERSON", prominentPersonId: String(draft.id)
    });
    expect(await jobs.deliverPublicationBatch()).toBe(0);
    await db.query("UPDATE prominent_publication_pushes SET available_at = NOW(3)");
    expect(await jobs.deliverPublicationBatch()).toBe(1);
    expect(sends.mock.lastCall?.[0][0].to).toBe("ExpoPushToken[fake1]");
    expect(await jobs.deliverPublicationBatch()).toBe(0);
    expect(await models.Notification.count()).toBe(3);

    // Recheck consent after the inbox batch and before contacting the provider.
    await people.createPerson({ fullName: "Next", categoryId, isPublished: true }, "admin");
    await jobs.preparePublicationPage();
    await models.NotificationPreference.create({ userId: 1, pushEnabled: false } as any);
    expect(await jobs.deliverPublicationBatch()).toBe(2);
    expect(sends).toHaveBeenCalledTimes(3);
    expect(await db.query("SELECT * FROM prominent_publication_pushes", { type: QueryTypes.SELECT })).toEqual([]);
  });

  it("resumes across member pages and suppresses queued pushes for withdrawn profiles", async () => {
    const members = Array.from({ length: 253 }, (_, i) => ({
      fullName: "Reader", email: `reader${i}@test.local`, status: "APPROVED"
    }));
    await models.User.bulkCreate(members as any);
    const user = await models.User.findOne({ where: { email: "reader0@test.local" } });
    await models.PushDeviceToken.create({
      userId: user!.id, platform: "android", token: "ExpoPushToken[withdrawn]", lastUsedAt: new Date()
    } as any);
    const person = await people.createPerson({ fullName: "Paginated", categoryId, isPublished: true }, "admin");
    const where = { actionTargetId: String(person.id), type: "PROMINENT_PERSON_PUBLISHED" };
    expect(await jobs.preparePublicationPage()).toBe(true);
    const firstPageCount = await models.Notification.count({ where });
    expect(firstPageCount).toBeGreaterThan(0);
    await models.User.create({ fullName: "Late", email: "late@test.local", status: "APPROVED" } as any);
    await Promise.all([jobs.preparePublicationPage(), jobs.preparePublicationPage()]);
    const rows = await models.Notification.findAll({ where });
    expect(rows.length).toBeGreaterThan(firstPageCount);
    expect(new Set(rows.map(row => row.userId)).size).toBe(rows.length);
    expect(rows.some(row => row.userId === user!.id)).toBe(true);
    const late = await models.User.findOne({ where: { email: "late@test.local" } });
    expect(rows.some(row => row.userId === late!.id)).toBe(false);
    await people.setPublished(person.id, false, "admin");
    const { sendExpoPush } = await import("../../src/services/ExpoPush.service");
    const countBefore = vi.mocked(sendExpoPush).mock.calls.length;
    expect(await jobs.deliverPublicationBatch()).toBeGreaterThan(0);
    expect(vi.mocked(sendExpoPush).mock.calls.length).toBe(countBefore);
    await expect(people.getPersonById(person.id)).rejects.toMatchObject({ status: 404 });
  });
});
