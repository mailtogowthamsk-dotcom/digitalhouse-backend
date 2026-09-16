/**
 * Promote quarantine profile photos → public profile-photos path + rewrite DB refs.
 *
 * Usage (from backend/):
 *   npx ts-node --transpile-only scripts/repair-quarantine-profile-photos.ts --dry-run
 *   npx ts-node --transpile-only scripts/repair-quarantine-profile-photos.ts
 *
 * Production (after build):
 *   node -r dotenv/config dist-scripts…  OR use ts-node on server if available.
 *   Prefer: npx ts-node --transpile-only scripts/repair-quarantine-profile-photos.ts
 */

import "dotenv/config";
import { Op } from "sequelize";
import { sequelize } from "../src/config/db";
import { MediaFile, User } from "../src/models";
import { extractR2KeyFromUrl } from "../src/utils/r2Client";
import {
  deletePromotedQuarantineKeys,
  promoteQuarantineKeys,
  rewriteStoredKey
} from "../src/services/contentSafety/quarantine";
import { QUARANTINE_PREFIX } from "../src/constants/contentSafety.constants";

const dryRun = process.argv.includes("--dry-run");

function isQuarantineKey(urlOrKey: string | null | undefined): boolean {
  if (!urlOrKey?.trim()) return false;
  const key = extractR2KeyFromUrl(urlOrKey.trim()) ?? urlOrKey.trim();
  return key.startsWith(QUARANTINE_PREFIX) && key.includes("/profile-photos/");
}

async function main(): Promise<void> {
  console.log(`[repair-profile-quarantine] dryRun=${dryRun}`);

  const users = await User.findAll({
    attributes: ["id", "profilePhoto", "pendingProfilePhoto"],
    where: {
      [Op.or]: [
        { profilePhoto: { [Op.like]: `%${QUARANTINE_PREFIX}%profile-photos%` } },
        { pendingProfilePhoto: { [Op.like]: `%${QUARANTINE_PREFIX}%profile-photos%` } }
      ]
    }
  });

  const mediaRows = await MediaFile.findAll({
    where: {
      module: "profile",
      [Op.or]: [
        { objectKey: { [Op.like]: `%${QUARANTINE_PREFIX}%profile-photos%` } },
        { fileUrl: { [Op.like]: `%${QUARANTINE_PREFIX}%profile-photos%` } }
      ]
    }
  });

  console.log(`  users with quarantine profile refs: ${users.length}`);
  console.log(`  media_files quarantine profile rows: ${mediaRows.length}`);

  let promoted = 0;
  let skipped = 0;
  let failed = 0;

  const mediaByUser = new Map<number, MediaFile[]>();
  for (const m of mediaRows) {
    const list = mediaByUser.get(m.userId) ?? [];
    list.push(m);
    mediaByUser.set(m.userId, list);
  }

  const userIds = new Set<number>([
    ...users.map((u) => u.id),
    ...mediaRows.map((m) => m.userId)
  ]);

  for (const userId of userIds) {
    const user =
      users.find((u) => u.id === userId) ??
      (await User.findByPk(userId, {
        attributes: ["id", "profilePhoto", "pendingProfilePhoto"]
      }));
    const medias = mediaByUser.get(userId) ?? [];

    const seeds: Array<string | null | undefined> = [
      user?.profilePhoto,
      user?.pendingProfilePhoto,
      ...medias.map((m) => m.objectKey),
      ...medias.map((m) => m.fileUrl)
    ];
    const quarantineSeeds = seeds.filter((s) => isQuarantineKey(s));
    if (quarantineSeeds.length === 0) {
      skipped += 1;
      continue;
    }

    let variantsJson: string | null = null;
    for (const m of medias) {
      if (m.variantsJson) {
        variantsJson = m.variantsJson;
        break;
      }
    }

    try {
      const mapping = await promoteQuarantineKeys(quarantineSeeds, variantsJson);
      if (mapping.size === 0) {
        console.warn(`  user=${userId}: promote returned empty (R2 miss?)`, quarantineSeeds[0]);
        failed += 1;
        continue;
      }
      console.log(`  user=${userId}:`, Object.fromEntries(mapping));

      if (dryRun) {
        promoted += 1;
        continue;
      }

      for (const m of medias) {
        const nextKey = rewriteStoredKey(m.objectKey || m.fileUrl, mapping);
        const nextFile = rewriteStoredKey(m.fileUrl, mapping);
        let nextVariants = m.variantsJson;
        if (nextVariants) {
          try {
            const parsed = JSON.parse(nextVariants) as Record<string, unknown>;
            for (const [k, v] of Object.entries(parsed)) {
              if (typeof v === "string") parsed[k] = rewriteStoredKey(v, mapping) ?? v;
            }
            nextVariants = JSON.stringify(parsed);
          } catch {
            /* keep */
          }
        }
        if (nextKey && nextKey !== m.objectKey) {
          await m.update({
            objectKey: nextKey,
            fileUrl: nextFile ?? m.fileUrl,
            variantsJson: nextVariants
          });
        }
      }

      if (user) {
        const patch: Record<string, string> = {};
        if (isQuarantineKey(user.profilePhoto)) {
          const next = rewriteStoredKey(user.profilePhoto, mapping);
          if (next && next !== user.profilePhoto) patch.profilePhoto = next;
        }
        if (isQuarantineKey(user.pendingProfilePhoto)) {
          const next = rewriteStoredKey(user.pendingProfilePhoto, mapping);
          if (next && next !== user.pendingProfilePhoto) patch.pendingProfilePhoto = next;
        }
        if (Object.keys(patch).length) await user.update(patch as any);
      }

      await deletePromotedQuarantineKeys(mapping);
      promoted += 1;
    } catch (err) {
      failed += 1;
      console.error(
        `  user=${userId} failed:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  console.log(`[repair-profile-quarantine] done promoted=${promoted} skipped=${skipped} failed=${failed}`);
  await sequelize.close();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await sequelize.close();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
