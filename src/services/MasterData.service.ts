import { Op, type WhereOptions } from "sequelize";
import { MasterDataType, MasterDataItem, MasterDataAudit, Location, Kulam } from "../models";
import {
  MDM_TYPE_DEFINITIONS,
  MDM_TYPE_CODES,
  MDM_LABEL_MAX,
  type MdmTypeCode
} from "../constants/masterData.constants";
import { MARKETPLACE_CATEGORIES } from "../constants/marketplace.constants";
import { HELP_CATEGORIES, HELP_CATEGORY_LABELS } from "../constants/helpingHands.constants";
import { mdmCacheGet, mdmCacheSet, mdmCacheInvalidateAll, mdmCacheKey } from "../utils/mdmCache";

export type MdmItemDto = {
  id: number;
  type_code: string;
  code: string | null;
  label: string;
  parent_id: number | null;
  sort_order: number;
  is_active: boolean;
  metadata: Record<string, unknown> | null;
  aliases: string[] | null;
};

export type MdmTypeDto = {
  code: string;
  name: string;
  description: string | null;
  parent_type_code: string | null;
  parent_optional: boolean;
  is_system: boolean;
};

function toItemDto(row: MasterDataItem): MdmItemDto {
  return {
    id: row.id,
    type_code: row.typeCode,
    code: row.code ?? null,
    label: row.label,
    parent_id: row.parentId ?? null,
    sort_order: row.sortOrder,
    is_active: Boolean(row.isActive),
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    aliases: Array.isArray(row.aliases) ? (row.aliases as string[]) : null
  };
}

function normalizeLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ");
}

function normalizeAliasKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

async function writeAudit(opts: {
  itemId?: number | null;
  typeCode: string;
  action: string;
  before?: unknown;
  after?: unknown;
  adminUserId?: number | null;
  note?: string | null;
}) {
  await MasterDataAudit.create({
    itemId: opts.itemId ?? null,
    typeCode: opts.typeCode,
    action: opts.action,
    beforeJson: (opts.before as any) ?? null,
    afterJson: (opts.after as any) ?? null,
    adminUserId: opts.adminUserId ?? null,
    note: opts.note ?? null
  } as any);
}

export async function ensureMasterDataTypes(): Promise<void> {
  const now = new Date();
  for (const def of MDM_TYPE_DEFINITIONS) {
    const existing = await MasterDataType.findOne({ where: { code: def.code } });
    if (!existing) {
      await MasterDataType.create({
        code: def.code,
        name: def.name,
        description: def.description,
        parentTypeCode: def.parentTypeCode,
        parentOptional: def.parentOptional,
        isSystem: def.isSystem,
        createdAt: now,
        updatedAt: now
      } as any);
    } else if (
      existing.name !== def.name ||
      existing.description !== def.description ||
      existing.parentTypeCode !== def.parentTypeCode ||
      Boolean(existing.parentOptional) !== def.parentOptional
    ) {
      await existing.update({
        name: def.name,
        description: def.description,
        parentTypeCode: def.parentTypeCode,
        parentOptional: def.parentOptional,
        updatedAt: now
      } as any);
      mdmCacheInvalidateAll();
    }
  }
}

async function ensureItem(opts: {
  typeCode: MdmTypeCode;
  label: string;
  code?: string | null;
  parentId?: number | null;
  sortOrder?: number;
  aliases?: string[];
}): Promise<MasterDataItem> {
  const label = normalizeLabel(opts.label);
  if (opts.code) {
    const byCode = await MasterDataItem.findOne({
      where: { typeCode: opts.typeCode, code: opts.code }
    });
    if (byCode) return byCode;
  }
  const byLabel = await MasterDataItem.findOne({
    where: {
      typeCode: opts.typeCode,
      label,
      ...(opts.parentId != null ? { parentId: opts.parentId } : {})
    }
  });
  if (byLabel) return byLabel;

  return MasterDataItem.create({
    typeCode: opts.typeCode,
    code: opts.code ?? null,
    label,
    parentId: opts.parentId ?? null,
    sortOrder: opts.sortOrder ?? 0,
    isActive: true,
    metadata: null,
    aliases: opts.aliases ?? null,
    createdBy: null,
    updatedBy: null
  } as any);
}

/** Seed types + default values (idempotent). Import legacy locations/kulams. */
export async function seedMasterDataIfNeeded(): Promise<void> {
  await ensureMasterDataTypes();

  const anyDistrict = await MasterDataItem.count({ where: { typeCode: "DISTRICT" } });
  const tn = await ensureItem({
    typeCode: "STATE",
    label: "Tamil Nadu",
    code: "TN",
    sortOrder: 1
  });

  if (anyDistrict === 0) {
    const locations = await Location.findAll({ order: [["sortOrder", "ASC"], ["name", "ASC"]] });
    let i = 1;
    for (const loc of locations) {
      if (!loc.name?.trim() || loc.name.trim().toLowerCase() === "other") continue;
      await ensureItem({
        typeCode: "DISTRICT",
        label: loc.name,
        parentId: tn.id,
        sortOrder: i++,
        aliases: [normalizeAliasKey(loc.name)]
      });
    }
  }

  const TN_EXTRA_DISTRICTS: Array<{ label: string; aliases?: string[] }> = [
    { label: "Chennai" },
    { label: "Coimbatore" },
    { label: "Madurai" },
    { label: "Trichy", aliases: ["trichy", "tiruchirappalli", "tiruchi"] },
    { label: "Salem" },
    { label: "Tirunelveli" },
    { label: "Dharmapuri" },
    { label: "Namakkal" },
    { label: "Karur" },
    { label: "Thanjavur" },
    { label: "Tiruppur" },
    { label: "Vellore" },
    { label: "Kanchipuram" },
    { label: "Chengalpattu" },
    { label: "Cuddalore" },
    { label: "Dindigul" },
    { label: "Krishnagiri" },
    { label: "Nilgiris" },
    { label: "Pudukkottai" },
    { label: "Ramanathapuram" },
    { label: "Sivaganga" },
    { label: "Theni" },
    { label: "Thoothukudi" },
    { label: "Tiruvallur" },
    { label: "Tiruvannamalai" },
    { label: "Tiruvarur" },
    { label: "Villupuram" },
    { label: "Virudhunagar" },
    { label: "Ariyalur" },
    { label: "Kallakurichi" },
    { label: "Mayiladuthurai" },
    { label: "Perambalur" },
    { label: "Ranipet" },
    { label: "Tenkasi" },
    { label: "Tirupathur" },
    { label: "Erode", aliases: ["erode", "erodu", "erod", "erodai"] }
  ];
  let i = 1;
  for (const d of TN_EXTRA_DISTRICTS) {
    await ensureItem({
      typeCode: "DISTRICT",
      label: d.label,
      parentId: tn.id,
      sortOrder: i++,
      aliases: d.aliases ?? [normalizeAliasKey(d.label)]
    });
  }
  console.log("[MDM] Ensured Tamil Nadu districts.");

  const anyKulam = await MasterDataItem.count({ where: { typeCode: "KULAM" } });
  if (anyKulam === 0) {
    const kulams = await Kulam.findAll({ order: [["sortOrder", "ASC"], ["name", "ASC"]] });
    let i = 1;
    for (const k of kulams) {
      if (!k.name?.trim()) continue;
      await ensureItem({
        typeCode: "KULAM",
        label: k.name,
        sortOrder: i++,
        aliases: [normalizeAliasKey(k.name)]
      });
    }
    console.log("[MDM] Seeded kulams.");
  }

  const seedFlat = async (
    typeCode: MdmTypeCode,
    values: Array<{ label: string; code?: string; aliases?: string[] }>
  ) => {
    const count = await MasterDataItem.count({ where: { typeCode } });
    if (count > 0) return;
    let i = 1;
    for (const v of values) {
      await ensureItem({
        typeCode,
        label: v.label,
        code: v.code ?? null,
        sortOrder: i++,
        aliases: v.aliases
      });
    }
    console.log(`[MDM] Seeded ${typeCode} (${values.length}).`);
  };

  await seedFlat("BLOOD_GROUP", [
    { label: "A+", code: "A_POS" },
    { label: "A-", code: "A_NEG" },
    { label: "B+", code: "B_POS" },
    { label: "B-", code: "B_NEG" },
    { label: "AB+", code: "AB_POS" },
    { label: "AB-", code: "AB_NEG" },
    { label: "O+", code: "O_POS" },
    { label: "O-", code: "O_NEG" },
    { label: "Unknown", code: "UNKNOWN" }
  ]);

  await seedFlat("MARITAL_STATUS", [
    { label: "Single", code: "SINGLE" },
    { label: "Married", code: "MARRIED" },
    { label: "Divorced", code: "DIVORCED" },
    { label: "Widowed", code: "WIDOWED" },
    { label: "Separated", code: "SEPARATED" }
  ]);

  await seedFlat("LANGUAGE", [
    { label: "Tamil", code: "TA" },
    { label: "English", code: "EN" },
    { label: "Hindi", code: "HI" },
    { label: "Telugu", code: "TE" },
    { label: "Kannada", code: "KN" },
    { label: "Malayalam", code: "ML" },
    { label: "Other", code: "OTHER" }
  ]);

  await seedFlat("EDUCATION", [
    { label: "Below 10th", code: "BELOW_10" },
    { label: "10th / SSLC", code: "SSLC" },
    { label: "12th / HSC", code: "HSC" },
    { label: "Diploma", code: "DIPLOMA" },
    { label: "Undergraduate", code: "UG" },
    { label: "Postgraduate", code: "PG" },
    { label: "Doctorate / PhD", code: "PHD" },
    { label: "Professional (CA/CS/etc.)", code: "PROFESSIONAL" },
    { label: "Other", code: "OTHER" }
  ]);

  await seedFlat("OCCUPATION", [
    { label: "Student", code: "STUDENT" },
    { label: "Private Employee", code: "PRIVATE" },
    { label: "Government Employee", code: "GOVT" },
    { label: "Business / Self-employed", code: "BUSINESS" },
    { label: "Agriculture", code: "AGRI" },
    { label: "Homemaker", code: "HOMEMAKER" },
    { label: "Professional", code: "PROFESSIONAL" },
    { label: "Retired", code: "RETIRED" },
    { label: "Unemployed", code: "UNEMPLOYED" },
    { label: "Other", code: "OTHER" }
  ]);

  await seedFlat(
    "MARKETPLACE_CATEGORY",
    MARKETPLACE_CATEGORIES.map((c) => ({
      label: c.replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase()),
      code: c
    }))
  );

  await seedFlat(
    "HELP_CATEGORY",
    HELP_CATEGORIES.map((c) => ({
      label: HELP_CATEGORY_LABELS[c] ?? c.replace(/_/g, " "),
      code: c
    }))
  );
}

export async function listTypes(): Promise<MdmTypeDto[]> {
  const cacheKey = mdmCacheKey(["types"]);
  const cached = mdmCacheGet<MdmTypeDto[]>(cacheKey);
  if (cached) return cached;

  await ensureMasterDataTypes();
  const rows = await MasterDataType.findAll({ order: [["name", "ASC"]] });
  const items = rows.map((r) => ({
    code: r.code,
    name: r.name,
    description: r.description ?? null,
    parent_type_code: r.parentTypeCode ?? null,
    parent_optional: Boolean(r.parentOptional),
    is_system: Boolean(r.isSystem)
  }));
  mdmCacheSet(cacheKey, items);
  return items;
}

export async function listPublicItems(opts: {
  typeCode: string;
  parentId?: number | null;
  q?: string;
  includeInactive?: boolean;
}): Promise<MdmItemDto[]> {
  if (!MDM_TYPE_CODES.includes(opts.typeCode as MdmTypeCode)) {
    throw Object.assign(new Error("Unknown master data type"), { status: 400 });
  }

  const cacheKey = mdmCacheKey([
    "public",
    opts.typeCode,
    opts.parentId ?? "",
    opts.q ?? "",
    opts.includeInactive ? "1" : "0"
  ]);
  const cached = mdmCacheGet<MdmItemDto[]>(cacheKey);
  if (cached) return cached;

  const where: WhereOptions = { typeCode: opts.typeCode };
  if (!opts.includeInactive) where.isActive = true;
  if (opts.parentId != null) where.parentId = opts.parentId;
  if (opts.q?.trim()) {
    const like = `%${opts.q.trim()}%`;
    Object.assign(where, { label: { [Op.like]: like } });
  }

  const rows = await MasterDataItem.findAll({
    where,
    order: [
      ["sortOrder", "ASC"],
      ["label", "ASC"]
    ],
    limit: 500
  });
  const items = rows.map(toItemDto);
  mdmCacheSet(cacheKey, items);
  return items;
}

/** Bundle multiple types for mobile cache warm-up. */
export async function getPublicBundle(typeCodes: string[]): Promise<Record<string, MdmItemDto[]>> {
  const out: Record<string, MdmItemDto[]> = {};
  for (const code of typeCodes) {
    if (!MDM_TYPE_CODES.includes(code as MdmTypeCode)) continue;
    // Root-level only in bundle (no parent filter) — geography children loaded on demand
    const def = MDM_TYPE_DEFINITIONS.find((d) => d.code === code);
    if (def?.parentTypeCode && ["TALUK", "TOWN", "VILLAGE", "PINCODE"].includes(code)) {
      out[code] = [];
      continue;
    }
    out[code] = await listPublicItems({ typeCode: code });
  }
  return out;
}

export async function adminListItems(opts: {
  typeCode: string;
  parentId?: number | null;
  q?: string;
  active?: "all" | "active" | "inactive";
  page: number;
  limit: number;
  sort?: "label" | "sort_order" | "updated";
}): Promise<{ items: MdmItemDto[]; total: number; page: number; limit: number }> {
  if (!MDM_TYPE_CODES.includes(opts.typeCode as MdmTypeCode)) {
    throw Object.assign(new Error("Unknown master data type"), { status: 400 });
  }
  const where: WhereOptions = { typeCode: opts.typeCode };
  if (opts.parentId != null) where.parentId = opts.parentId;
  if (opts.active === "active") where.isActive = true;
  if (opts.active === "inactive") where.isActive = false;
  if (opts.q?.trim()) {
    const like = `%${opts.q.trim()}%`;
    Object.assign(where, {
      [Op.or]: [{ label: { [Op.like]: like } }, { code: { [Op.like]: like } }]
    });
  }

  const order =
    opts.sort === "label"
      ? ([["label", "ASC"]] as const)
      : opts.sort === "updated"
        ? ([["updatedAt", "DESC"]] as const)
        : ([["sortOrder", "ASC"], ["label", "ASC"]] as const);

  const page = Math.max(1, opts.page);
  const limit = Math.min(100, Math.max(1, opts.limit));
  // Sequential queries (not findAndCountAll's Promise.all) — remote DB pool is small;
  // parallel count+select under Master Data UI fans-out caused ETIMEDOUT.
  const count = await MasterDataItem.count({ where });
  const rows = await MasterDataItem.findAll({
    where,
    order: order as any,
    limit,
    offset: (page - 1) * limit
  });
  return { items: rows.map(toItemDto), total: count, page, limit };
}

export async function adminCreateItem(
  adminUserId: number | null,
  payload: {
    type_code: string;
    label: string;
    code?: string | null;
    parent_id?: number | null;
    sort_order?: number;
    aliases?: string[];
    metadata?: Record<string, unknown> | null;
    is_active?: boolean;
  }
): Promise<MdmItemDto> {
  const typeCode = payload.type_code;
  const def = MDM_TYPE_DEFINITIONS.find((d) => d.code === typeCode);
  if (!def) throw Object.assign(new Error("Unknown type"), { status: 400 });

  const label = normalizeLabel(payload.label);
  if (!label || label.length > MDM_LABEL_MAX) {
    throw Object.assign(new Error("Invalid label"), { status: 400 });
  }

  if (def.parentTypeCode && !def.parentOptional && payload.parent_id == null) {
    throw Object.assign(new Error(`parent_id is required for ${typeCode}`), { status: 400 });
  }

  if (payload.parent_id != null) {
    const parent = await MasterDataItem.findByPk(payload.parent_id);
    if (!parent || parent.typeCode !== def.parentTypeCode) {
      throw Object.assign(new Error("Invalid parent_id for this type"), { status: 400 });
    }
  }

  const dup = await MasterDataItem.findOne({
    where: {
      typeCode,
      label,
      parentId: payload.parent_id ?? null
    }
  });
  if (dup) throw Object.assign(new Error("An item with this label already exists"), { status: 409 });

  const row = await MasterDataItem.create({
    typeCode,
    code: payload.code?.trim() || null,
    label,
    parentId: payload.parent_id ?? null,
    sortOrder: payload.sort_order ?? 0,
    isActive: payload.is_active !== false,
    metadata: payload.metadata ?? null,
    aliases: payload.aliases?.map(normalizeAliasKey) ?? null,
    createdBy: adminUserId,
    updatedBy: adminUserId
  } as any);

  await writeAudit({
    itemId: row.id,
    typeCode,
    action: "CREATE",
    after: toItemDto(row),
    adminUserId
  });
  mdmCacheInvalidateAll();
  return toItemDto(row);
}

export async function adminUpdateItem(
  adminUserId: number | null,
  itemId: number,
  payload: {
    label?: string;
    code?: string | null;
    parent_id?: number | null;
    sort_order?: number;
    aliases?: string[] | null;
    metadata?: Record<string, unknown> | null;
    is_active?: boolean;
  }
): Promise<MdmItemDto> {
  const row = await MasterDataItem.findByPk(itemId);
  if (!row) throw Object.assign(new Error("Item not found"), { status: 404 });
  const before = toItemDto(row);
  const def = MDM_TYPE_DEFINITIONS.find((d) => d.code === row.typeCode);

  if (payload.label !== undefined) {
    const label = normalizeLabel(payload.label);
    if (!label) throw Object.assign(new Error("Invalid label"), { status: 400 });
    const dup = await MasterDataItem.findOne({
      where: {
        typeCode: row.typeCode,
        label,
        parentId: payload.parent_id !== undefined ? payload.parent_id : row.parentId,
        id: { [Op.ne]: itemId }
      }
    });
    if (dup) throw Object.assign(new Error("An item with this label already exists"), { status: 409 });
    row.label = label;
  }
  if (payload.code !== undefined) row.code = payload.code?.trim() || null;
  if (payload.sort_order !== undefined) row.sortOrder = payload.sort_order;
  if (payload.is_active !== undefined) row.isActive = payload.is_active;
  if (payload.aliases !== undefined) {
    row.aliases = payload.aliases?.map(normalizeAliasKey) ?? null;
  }
  if (payload.metadata !== undefined) row.metadata = payload.metadata;
  if (payload.parent_id !== undefined) {
    if (payload.parent_id != null) {
      const parent = await MasterDataItem.findByPk(payload.parent_id);
      if (!parent || (def && parent.typeCode !== def.parentTypeCode)) {
        throw Object.assign(new Error("Invalid parent_id"), { status: 400 });
      }
    }
    row.parentId = payload.parent_id;
  }
  row.updatedBy = adminUserId;
  await row.save();

  await writeAudit({
    itemId: row.id,
    typeCode: row.typeCode,
    action: payload.is_active === false ? "DISABLE" : payload.is_active === true ? "ENABLE" : "UPDATE",
    before,
    after: toItemDto(row),
    adminUserId
  });
  mdmCacheInvalidateAll();
  return toItemDto(row);
}

export async function adminListAudits(opts: {
  typeCode?: string;
  itemId?: number;
  page: number;
  limit: number;
}): Promise<{
  items: Array<{
    id: number;
    item_id: number | null;
    type_code: string;
    action: string;
    before: unknown;
    after: unknown;
    admin_user_id: number | null;
    note: string | null;
    created_at: string;
  }>;
  total: number;
  page: number;
  limit: number;
}> {
  const where: WhereOptions = {};
  if (opts.typeCode) where.typeCode = opts.typeCode;
  if (opts.itemId) where.itemId = opts.itemId;
  const page = Math.max(1, opts.page);
  const limit = Math.min(100, Math.max(1, opts.limit));
  const { rows, count } = await MasterDataAudit.findAndCountAll({
    where,
    order: [["createdAt", "DESC"]],
    limit,
    offset: (page - 1) * limit
  });
  return {
    items: rows.map((r) => ({
      id: r.id,
      item_id: r.itemId,
      type_code: r.typeCode,
      action: r.action,
      before: r.beforeJson,
      after: r.afterJson,
      admin_user_id: r.adminUserId,
      note: r.note,
      created_at: r.createdAt.toISOString()
    })),
    total: count,
    page,
    limit
  };
}

/**
 * Resolve a free-text or id to a master item.
 * Used for validation and backfill. Includes inactive for display of existing values.
 */
export async function resolveMasterValue(
  typeCode: MdmTypeCode,
  value: string | number | null | undefined,
  opts?: { parentId?: number | null; activeOnly?: boolean }
): Promise<MdmItemDto | null> {
  if (value == null || value === "") return null;
  if (typeof value === "number" || /^\d+$/.test(String(value))) {
    const row = await MasterDataItem.findByPk(Number(value));
    if (!row || row.typeCode !== typeCode) return null;
    if (opts?.activeOnly && !row.isActive) return null;
    return toItemDto(row);
  }
  const label = normalizeLabel(String(value));
  const key = normalizeAliasKey(label);
  const where: WhereOptions = { typeCode };
  if (opts?.parentId != null) where.parentId = opts.parentId;
  if (opts?.activeOnly) where.isActive = true;

  const rows = await MasterDataItem.findAll({ where, limit: 500 });
  for (const r of rows) {
    if (normalizeAliasKey(r.label) === key) return toItemDto(r);
    const aliases = Array.isArray(r.aliases) ? (r.aliases as string[]) : [];
    if (aliases.some((a) => normalizeAliasKey(a) === key)) return toItemDto(r);
  }
  return null;
}

/** Validate that a submitted label/id is an approved active master value. */
export async function assertActiveMasterValue(
  typeCode: MdmTypeCode,
  value: string | number | null | undefined,
  opts?: { parentId?: number | null; fieldName?: string }
): Promise<MdmItemDto> {
  const resolved = await resolveMasterValue(typeCode, value, {
    parentId: opts?.parentId,
    activeOnly: true
  });
  if (!resolved) {
    throw Object.assign(
      new Error(`${opts?.fieldName || typeCode} must be selected from the approved list`),
      { status: 400 }
    );
  }
  return resolved;
}

export const masterDataService = {
  ensureMasterDataTypes,
  seedMasterDataIfNeeded,
  listTypes,
  listPublicItems,
  getPublicBundle,
  adminListItems,
  adminCreateItem,
  adminUpdateItem,
  adminListAudits,
  resolveMasterValue,
  assertActiveMasterValue
};
