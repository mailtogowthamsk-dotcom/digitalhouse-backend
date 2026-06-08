/**
 * Why does browse show zero profiles for a user?
 * Usage: node scripts/diagnose-matrimony-discover.js <userId>
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const userId = Number(process.argv[2]);
if (!userId || Number.isNaN(userId)) {
  console.error("Usage: node scripts/diagnose-matrimony-discover.js <userId>");
  process.exit(1);
}

async function main() {
  const { sequelize } = require("../dist/config/database");
  const Discover = require("../dist/services/MatrimonyDiscover.service");
  const { getMatrimonyHub } = require("../dist/services/Matrimony.service");
  const { User, UserProfile } = require("../dist/models");
  const { normalizeJsonColumn, SECTION_ALLOWED_KEYS } = require("../dist/services/Profile.service");
  const { resolveMatrimonyCandidate } = require("../dist/utils/matrimonyCandidate.util");

  await sequelize.authenticate();

  const hub = await getMatrimonyHub(userId);
  console.log("Hub:", {
    status: hub.status,
    can_browse: hub.can_browse,
    matrimony_active: hub.matrimony_profile_active
  });

  const viewer = await User.findByPk(userId);
  const viewerProfile = await UserProfile.findOne({ where: { userId } });
  const viewerM = normalizeJsonColumn(viewerProfile?.matrimony, SECTION_ALLOWED_KEYS.matrimony);
  const viewerCandidate = resolveMatrimonyCandidate(viewer, viewerM ?? {});
  console.log("Viewer prefs:", {
    kulam: viewerM?.kulamSnapshot ?? viewer?.kulam,
    age: viewerCandidate.age,
    gender: viewerCandidate.gender,
    district: viewerCandidate.district,
    partnerGenderPreference: viewerM?.partnerGenderPreference,
    partnerAgeMin: viewerM?.partnerAgeMin,
    partnerAgeMax: viewerM?.partnerAgeMax,
    preferredDistrictIds: viewerM?.preferredDistrictIds
  });

  const result = await Discover.discoverProfiles(userId, { page: 1, limit: 50 });
  console.log("Discover:", { total: result.total, emptyHint: result.emptyHint ?? "(none)" });

  await sequelize.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
