import { QueryTypes, type Transaction } from "sequelize";
import { sequelize } from "../config/db";
import { NOTIFICATION_ACTIONS, NOTIFICATION_TYPES } from "../constants/notification.constants";
import { sendPublicationPush, type PublicationPush } from "./NotificationPlatform.service";

const PAGE_SIZE = 250;
const DEVICE_BATCH = 8;

export async function enqueueFirstPublication(personId: number, transaction: Transaction) {
  await sequelize.query(
    `INSERT INTO prominent_publication_jobs (person_id, max_user_id)
     VALUES (:personId, (SELECT COALESCE(MAX(id), 0) FROM users))
     ON DUPLICATE KEY UPDATE person_id = VALUES(person_id)`,
    { replacements: { personId }, transaction }
  );
}

type PublicationJob = { person_id: number; last_user_id: number; max_user_id: number };

/** The inbox entries, device work and member cursor commit together. */
export async function preparePublicationPage(): Promise<boolean> {
  return sequelize.transaction(async (transaction) => {
    const [job] = await sequelize.query<PublicationJob>(
      `SELECT person_id, last_user_id, max_user_id FROM prominent_publication_jobs
       WHERE finished = 0 ORDER BY person_id LIMIT 1 FOR UPDATE`,
      { type: QueryTypes.SELECT, transaction }
    );
    if (!job) return false;

    const personId = job.person_id;
    const [person] = await sequelize.query<{ full_name: string }>(
      "SELECT full_name FROM prominent_people WHERE id = :personId AND is_published = 1",
      { replacements: { personId }, type: QueryTypes.SELECT, transaction }
    );
    const members = person ? await sequelize.query<{ id: number }>(
      `SELECT id FROM users WHERE status = 'APPROVED' AND deleted_at IS NULL
       AND id > :cursor AND id <= :maxId ORDER BY id LIMIT :pageSize`,
      {
        replacements: { cursor: job.last_user_id, maxId: job.max_user_id, pageSize: PAGE_SIZE },
        type: QueryTypes.SELECT, transaction
      }
    ) : [];

    if (members.length) {
      const replacements = {
        ids: members.map(member => member.id),
        personId,
        type: NOTIFICATION_TYPES.PROMINENT_PERSON_PUBLISHED,
        action: NOTIFICATION_ACTIONS.OPEN_PROMINENT_PERSON,
        groupKey: `prominent-publication:${personId}`,
        title: "பிரபலங்கள் வரிசையில் புதிய அறிமுகம்",
        body: `${person.full_name} அவர்களின் வாழ்க்கைப் பயணத்தையும் சாதனைகளையும் அறிந்துகொள்ளுங்கள்.`
      };
      await sequelize.query(
        `INSERT INTO notifications
         (userId, type, category, title, body, action_type, action_target_id, group_key, createdAt, updatedAt)
         SELECT u.id, :type, 'COMMUNITY', :title, :body,
                :action, :personId, :groupKey, NOW(), NOW()
         FROM users u LEFT JOIN notification_preferences p ON p.user_id = u.id
         WHERE u.id IN (:ids) AND u.status = 'APPROVED' AND u.deleted_at IS NULL
           AND COALESCE(p.community_enabled, 1) = 1`,
        { replacements, transaction }
      );
      await sequelize.query(
        `INSERT INTO prominent_publication_pushes (notification_id, token_id)
         SELECT n.id, MIN(d.id) FROM notifications n
         JOIN push_device_tokens d ON d.user_id = n.userId
         LEFT JOIN notification_preferences p ON p.user_id = n.userId
         WHERE n.userId IN (:ids) AND n.group_key = :groupKey AND COALESCE(p.push_enabled, 1) = 1
         GROUP BY n.id, d.token`,
        { replacements, transaction }
      );
    }
    await sequelize.query(
      `UPDATE prominent_publication_jobs SET last_user_id = :cursor, finished = :finished
       WHERE person_id = :personId`,
      {
        replacements: {
          personId, cursor: members.at(-1)?.id ?? job.last_user_id,
          finished: members.length < PAGE_SIZE
        },
        transaction
      }
    );
    return true;
  });
}

type DeviceDelivery = { notification_id: number; token_id: number; attempts: number };

async function claimDeviceBatch() {
  return sequelize.transaction(async (transaction) => {
    const rows = await sequelize.query<DeviceDelivery>(
      `SELECT notification_id, token_id, attempts FROM prominent_publication_pushes
       WHERE available_at <= NOW(3) ORDER BY available_at, notification_id, token_id
       LIMIT :limit FOR UPDATE`,
      { type: QueryTypes.SELECT, replacements: { limit: DEVICE_BATCH }, transaction }
    );
    for (const row of rows) {
      await sequelize.query(
        `UPDATE prominent_publication_pushes
         SET available_at = DATE_ADD(NOW(3), INTERVAL 10 MINUTE), attempts = attempts + 1
         WHERE notification_id = :notification_id AND token_id = :token_id`,
        { replacements: row, transaction }
      );
      row.attempts++;
    }
    return rows;
  });
}

async function deliverDevice(row: DeviceDelivery) {
  const claim = "notification_id = :notification_id AND token_id = :token_id AND attempts = :attempts";
  try {
    const [delivery] = await sequelize.query<PublicationPush>(
      `SELECT n.id, n.userId, n.title, n.body, n.action_target_id AS actionTargetId, d.token, d.platform
       FROM prominent_publication_pushes work
       JOIN notifications n ON n.id = work.notification_id
       JOIN users u ON u.id = n.userId AND u.status = 'APPROVED' AND u.deleted_at IS NULL
       JOIN prominent_people pp ON pp.id = n.action_target_id AND pp.is_published = 1
       JOIN push_device_tokens d ON d.id = :token_id AND d.user_id = u.id
       LEFT JOIN notification_preferences p ON p.user_id = u.id
       WHERE work.notification_id = :notification_id AND work.token_id = :token_id
         AND work.attempts = :attempts AND n.deleted_at IS NULL
         AND COALESCE(p.community_enabled, 1) = 1 AND COALESCE(p.push_enabled, 1) = 1`,
      { type: QueryTypes.SELECT, replacements: row }
    );
    if (delivery) await sendPublicationPush(delivery);
    await sequelize.query(`DELETE FROM prominent_publication_pushes WHERE ${claim}`, { replacements: row });
  } catch (error) {
    const delay = Math.min(3600, 15 * 2 ** Math.min(row.attempts, 8));
    await sequelize.query(
      `UPDATE prominent_publication_pushes SET available_at = DATE_ADD(NOW(3), INTERVAL :delay SECOND)
       WHERE ${claim}`,
      { replacements: { ...row, delay } }
    );
    console.warn("[prominent-publication] Retrying device delivery", row, error);
  }
}

export async function deliverPublicationBatch() {
  const rows = await claimDeviceBatch();
  await Promise.all(rows.map(deliverDevice));
  return rows.length;
}

let timer: ReturnType<typeof setInterval> | undefined;
let currentPass: Promise<void> | undefined;

async function runPublicationJobs() {
  const until = Date.now() + 10_000;
  do {
    const prepared = await preparePublicationPage();
    const devices = await deliverPublicationBatch();
    if (!prepared && devices === 0) break;
  } while (timer && Date.now() < until);
}

export function startPublicationJobs() {
  if (timer) return;
  timer = setInterval(() => {
    if (currentPass) return;
    currentPass = runPublicationJobs()
      .catch(error => console.error("[prominent-publication] Worker pass failed", error))
      .finally(() => { currentPass = undefined; });
  }, 10_000);
}

export async function stopPublicationJobs() {
  clearInterval(timer);
  timer = undefined;
  await currentPass;
}
