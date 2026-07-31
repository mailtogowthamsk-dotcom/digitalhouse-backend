import { Op } from "sequelize";
import { PlatformAppVersion } from "../../models";
import {
  defaultStoreUrl,
  type AppPlatform,
  type VersionStatus
} from "../../constants/platform.constants";
import { audit, now } from "./shared";

function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/i, "").split(".").map((n) => Number(n) || 0);
  const pb = b.replace(/^v/i, "").split(".").map((n) => Number(n) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

export async function versionPolicyFor(platform: AppPlatform, clientVersion?: string | null) {
  const active = await PlatformAppVersion.findOne({
    where: {
      platform,
      status: { [Op.in]: ["SOFT_UPDATE", "FORCE_UPDATE"] }
    },
    order: [["updatedAt", "DESC"]]
  });

  if (!active) {
    return {
      platform,
      status: "NONE" as const,
      latestVersion: null,
      minSupportedVersion: null,
      releaseNotes: null,
      releaseDate: null,
      storeUrl: defaultStoreUrl(platform),
      updateRequired: false,
      forceUpdate: false,
      softUpdate: false
    };
  }

  const client = (clientVersion || "").trim();
  let forceUpdate = false;
  let softUpdate = false;

  // Hard-block only when client is proven below minSupportedVersion.
  // Never freeze the app solely because a FORCE_UPDATE row exists (Expo Go / missing min).
  if (client && active.minSupportedVersion) {
    if (compareSemver(client, active.minSupportedVersion) < 0) {
      forceUpdate = true;
    } else if (
      active.latestVersion &&
      compareSemver(client, active.latestVersion) < 0 &&
      (active.status === "SOFT_UPDATE" || active.status === "FORCE_UPDATE")
    ) {
      softUpdate = true;
    }
  } else if (active.status === "SOFT_UPDATE" || active.status === "FORCE_UPDATE") {
    softUpdate = true;
  }

  return {
    platform,
    status: active.status,
    latestVersion: active.latestVersion,
    minSupportedVersion: active.minSupportedVersion,
    releaseNotes: active.releaseNotes,
    releaseDate: active.releaseDate,
    versionName: active.versionName,
    storeUrl: active.storeUrl || defaultStoreUrl(platform),
    updateRequired: forceUpdate || softUpdate,
    forceUpdate,
    softUpdate
  };
}

export async function listVersions(platform?: string) {
  const where: any = {};
  if (platform) where.platform = platform;
  const rows = await PlatformAppVersion.findAll({ where, order: [["updatedAt", "DESC"]] });
  return rows.map((v) => ({
    id: v.id,
    platform: v.platform,
    versionName: v.versionName,
    versionCode: v.versionCode,
    minSupportedVersion: v.minSupportedVersion,
    latestVersion: v.latestVersion,
    releaseNotes: v.releaseNotes,
    releaseDate: v.releaseDate,
    storeUrl: v.storeUrl,
    status: v.status,
    createdBy: v.createdBy,
    updatedBy: v.updatedBy,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString()
  }));
}

export async function upsertVersion(
  adminEmail: string | null,
  input: {
    id?: number;
    platform: AppPlatform;
    versionName: string;
    versionCode?: number;
    minSupportedVersion: string;
    latestVersion: string;
    releaseNotes?: string | null;
    releaseDate?: string | null;
    storeUrl?: string | null;
    status: VersionStatus;
  }
) {
  let row: PlatformAppVersion | null = null;
  if (input.id) row = await PlatformAppVersion.findByPk(input.id);

  // Only one active soft/force per platform
  if (input.status === "SOFT_UPDATE" || input.status === "FORCE_UPDATE") {
    await PlatformAppVersion.update(
      { status: "DISABLED", updatedAt: now(), updatedBy: adminEmail } as any,
      {
        where: {
          platform: input.platform,
          status: { [Op.in]: ["SOFT_UPDATE", "FORCE_UPDATE"] },
          ...(row ? { id: { [Op.ne]: row.id } } : {})
        }
      }
    );
  }

  const storeUrl =
    input.storeUrl !== undefined
      ? input.storeUrl?.trim() || null
      : row?.storeUrl ?? defaultStoreUrl(input.platform);

  if (row) {
    await row.update({
      platform: input.platform,
      versionName: input.versionName,
      versionCode: input.versionCode ?? row.versionCode,
      minSupportedVersion: input.minSupportedVersion,
      latestVersion: input.latestVersion,
      releaseNotes: input.releaseNotes ?? null,
      releaseDate: input.releaseDate ?? null,
      storeUrl,
      status: input.status,
      updatedBy: adminEmail,
      updatedAt: now()
    } as any);
  } else {
    row = await PlatformAppVersion.create({
      platform: input.platform,
      versionName: input.versionName,
      versionCode: input.versionCode ?? 0,
      minSupportedVersion: input.minSupportedVersion,
      latestVersion: input.latestVersion,
      releaseNotes: input.releaseNotes ?? null,
      releaseDate: input.releaseDate ?? null,
      storeUrl,
      status: input.status,
      createdBy: adminEmail,
      updatedBy: adminEmail,
      createdAt: now(),
      updatedAt: now()
    } as any);
  }

  await audit(adminEmail, `VERSION_${input.status}`, "version", {
    id: row.id,
    platform: input.platform,
    versionName: input.versionName
  });
  return listVersions();
}
