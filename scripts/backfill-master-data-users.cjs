/**
 * Backfill user string fields to nearest Master Data labels via aliases.
 * Dry-run by default. Apply with: APPLY=1 node scripts/backfill-master-data-users.cjs
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", esModuleInterop: true }
});

async function main() {
  const apply = process.env.APPLY === "1";
  const { sequelize } = require("../src/config/db");
  const { User } = require("../src/models");
  const { masterDataService } = require("../src/services/MasterData.service");

  await sequelize.authenticate();
  await masterDataService.seedMasterDataIfNeeded();

  const users = await User.findAll({
    attributes: ["id", "location", "district", "kulam", "occupation", "education", "bloodGroup"],
    limit: 5000
  });

  let mapped = 0;
  let unchanged = 0;

  for (const u of users) {
    const updates = {};

    const loc = u.location || u.district;
    if (loc) {
      const d = await masterDataService.resolveMasterValue("DISTRICT", loc);
      if (d && d.label !== loc) {
        updates.location = d.label;
        if (u.district) updates.district = d.label;
        mapped++;
      } else if (d) unchanged++;
    }

    if (u.kulam) {
      const k = await masterDataService.resolveMasterValue("KULAM", u.kulam);
      if (k && k.label !== u.kulam) {
        updates.kulam = k.label;
        mapped++;
      }
    }

    if (u.occupation) {
      const o = await masterDataService.resolveMasterValue("OCCUPATION", u.occupation);
      if (o && o.label !== u.occupation) {
        updates.occupation = o.label;
        mapped++;
      }
    }

    if (u.education) {
      const e = await masterDataService.resolveMasterValue("EDUCATION", u.education);
      if (e && e.label !== u.education) {
        updates.education = e.label;
        mapped++;
      }
    }

    if (u.bloodGroup) {
      const b = await masterDataService.resolveMasterValue("BLOOD_GROUP", u.bloodGroup);
      if (b && b.label !== u.bloodGroup) {
        updates.bloodGroup = b.label;
        mapped++;
      }
    }

    if (apply && Object.keys(updates).length) {
      await u.update(updates);
      console.log(`Updated user ${u.id}`, updates);
    } else if (Object.keys(updates).length) {
      console.log(`[dry-run] user ${u.id}`, updates);
    }
  }

  console.log(
    apply
      ? `Applied. Fields remapped≈${mapped}, already-standard≈${unchanged}`
      : `Dry-run complete. Would remap≈${mapped}. Re-run with APPLY=1 to write.`
  );
  await sequelize.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
