/**
 * Prominent People — Hall of Fame (admin CMS + member read).
 */

import { Op, type Order, type WhereOptions } from "sequelize";
import {
  ProminentCategory,
  ProminentPerson,
  ProminentGalleryItem,
  ProminentTimelineEntry
} from "../models";
import {
  PROMINENT_DEFAULT_PAGE_SIZE,
  PROMINENT_MAX_PAGE_SIZE,
  PROMINENT_LIST_CACHE_TTL_MS,
  PROMINENT_FEATURED_CACHE_TTL_MS,
  PROMINENT_CATEGORIES_CACHE_TTL_MS,
  type ProminentSortOption,
  type ProminentMediaKind
} from "../constants/prominentPeople.constants";
import { mdmCacheGet, mdmCacheSet, mdmCacheInvalidateAll, mdmCacheKey } from "../utils/mdmCache";
import {
  extractR2KeyFromUrl,
  getCdnPublicUrl,
  getPresignedGetUrl,
  getPresignedPutUrl,
  putR2ObjectBuffer,
  toSignedUrlIfR2
} from "../utils/r2Client";
import { randomUUID } from "crypto";
import path from "path";

function httpError(message: string, status: number): Error {
  const err = new Error(message);
  (err as any).status = status;
  return err;
}

function normalizeKey(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const t = raw.trim();
  return extractR2KeyFromUrl(t) || t;
}

async function signKey(key: string | null | undefined): Promise<string | null> {
  if (!key) return null;
  const url = key.startsWith("http") ? key : getCdnPublicUrl(key);
  return toSignedUrlIfR2(url);
}

export type TimelineInput = {
  id?: number;
  year: string;
  title: string;
  description?: string | null;
  sortOrder?: number;
};

export type GalleryInput = {
  id?: number;
  imageKey: string;
  caption?: string | null;
  sortOrder?: number;
};

export type PersonWriteInput = {
  fullName: string;
  categoryId: number;
  occupation?: string | null;
  currentDesignation?: string | null;
  shortDescription?: string | null;
  biography?: string | null;
  education?: string | null;
  achievements?: string | null;
  awards?: string | null;
  communityContribution?: string | null;
  profileImageKey?: string | null;
  heroImageKey?: string | null;
  isFeatured?: boolean;
  isPublished?: boolean;
  featuredSortOrder?: number;
  sortOrder?: number;
  timeline?: TimelineInput[];
  gallery?: GalleryInput[];
};

function clampPageSize(n?: number): number {
  const v = Number(n) || PROMINENT_DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(1, v), PROMINENT_MAX_PAGE_SIZE);
}

async function mapCategoryDto(cat: ProminentCategory) {
  return {
    id: cat.id,
    code: cat.code,
    label: cat.label,
    color: cat.color,
    sortOrder: cat.sortOrder
  };
}

async function mapPersonCard(person: ProminentPerson & { Category?: ProminentCategory }) {
  const category = person.Category
    ? await mapCategoryDto(person.Category)
    : null;
  return {
    id: person.id,
    fullName: person.fullName,
    occupation: person.occupation,
    currentDesignation: person.currentDesignation,
    shortDescription: person.shortDescription,
    category,
    profileImageUrl: await signKey(person.profileImageKey),
    heroImageUrl: await signKey(person.heroImageKey),
    isFeatured: !!person.isFeatured,
    isPublished: !!person.isPublished,
    verified: true
  };
}

async function mapPersonDetail(
  person: ProminentPerson & {
    Category?: ProminentCategory;
    Gallery?: ProminentGalleryItem[];
    Timeline?: ProminentTimelineEntry[];
  }
) {
  const base = await mapPersonCard(person);
  const gallery = await Promise.all(
    (person.Gallery || [])
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
      .map(async (g) => ({
        id: g.id,
        caption: g.caption,
        sortOrder: g.sortOrder,
        imageUrl: await signKey(g.imageKey),
        imageKey: g.imageKey
      }))
  );
  const timeline = (person.Timeline || [])
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
    .map((t) => ({
      id: t.id,
      year: t.year,
      title: t.title,
      description: t.description,
      sortOrder: t.sortOrder
    }));

  return {
    ...base,
    biography: person.biography,
    education: person.education,
    achievements: person.achievements,
    awards: person.awards,
    communityContribution: person.communityContribution,
    profileImageKey: person.profileImageKey,
    heroImageKey: person.heroImageKey,
    featuredSortOrder: person.featuredSortOrder,
    sortOrder: person.sortOrder,
    publishedAt: person.publishedAt ? person.publishedAt.toISOString() : null,
    createdAt: person.createdAt.toISOString(),
    updatedAt: person.updatedAt.toISOString(),
    gallery,
    timeline
  };
}

export async function listCategories(activeOnly = true) {
  const cacheKey = mdmCacheKey(["prominent", "categories", activeOnly ? "1" : "0"]);
  const cached = mdmCacheGet<Awaited<ReturnType<typeof mapCategoryDto>>[]>(cacheKey);
  if (cached) return cached;

  const rows = await ProminentCategory.findAll({
    where: activeOnly ? { isActive: true } : undefined,
    order: [
      ["sortOrder", "ASC"],
      ["id", "ASC"]
    ]
  });
  const out = await Promise.all(rows.map(mapCategoryDto));
  mdmCacheSet(cacheKey, out, PROMINENT_CATEGORIES_CACHE_TTL_MS);
  return out;
}

export async function listFeatured(limit = 8) {
  const cacheKey = mdmCacheKey(["prominent", "featured", limit]);
  const cached = mdmCacheGet<unknown[]>(cacheKey);
  if (cached) return cached;

  const rows = await ProminentPerson.findAll({
    where: { isPublished: true, isFeatured: true },
    include: [{ model: ProminentCategory, as: "Category", required: false }],
    order: [
      ["featuredSortOrder", "ASC"],
      ["id", "DESC"]
    ],
    limit: Math.min(Math.max(1, limit), 20)
  });
  const out = await Promise.all(rows.map((r) => mapPersonCard(r as any)));
  mdmCacheSet(cacheKey, out, PROMINENT_FEATURED_CACHE_TTL_MS);
  return out;
}

export async function listPeople(input: {
  q?: string;
  categoryCode?: string;
  categoryId?: number;
  sort?: ProminentSortOption;
  page?: number;
  limit?: number;
  publishedOnly?: boolean;
  featuredOnly?: boolean;
}) {
  const page = Math.max(1, Number(input.page) || 1);
  const limit = clampPageSize(input.limit);
  const sort: ProminentSortOption = input.sort === "alphabetical" ? "alphabetical" : "latest";
  const publishedOnly = input.publishedOnly !== false;

  const cacheKey = mdmCacheKey([
    "prominent",
    "list",
    publishedOnly ? "pub" : "all",
    input.featuredOnly ? "feat" : "_",
    input.q?.trim().toLowerCase() || "_",
    input.categoryCode || input.categoryId || "_",
    sort,
    page,
    limit
  ]);
  const cached = mdmCacheGet<{ items: unknown[]; page: number; limit: number; total: number; hasMore: boolean }>(
    cacheKey
  );
  if (cached) return cached;

  const where: WhereOptions = {};
  if (publishedOnly) (where as any).isPublished = true;
  if (input.featuredOnly) (where as any).isFeatured = true;

  if (input.categoryId) {
    (where as any).categoryId = input.categoryId;
  } else if (input.categoryCode && input.categoryCode !== "all") {
    const cat = await ProminentCategory.findOne({ where: { code: input.categoryCode } });
    if (!cat) {
      return { items: [], page, limit, total: 0, hasMore: false };
    }
    (where as any).categoryId = cat.id;
  }

  const q = input.q?.trim();
  if (q) {
    const like = `%${q.replace(/[%_]/g, "\\$&")}%`;
    (where as any)[Op.or] = [
      { fullName: { [Op.like]: like } },
      { occupation: { [Op.like]: like } },
      { currentDesignation: { [Op.like]: like } },
      { shortDescription: { [Op.like]: like } }
    ];
  }

  const order: Order =
    sort === "alphabetical"
      ? [
          ["fullName", "ASC"],
          ["id", "ASC"]
        ]
      : [
          ["createdAt", "DESC"],
          ["id", "DESC"]
        ];

  const { rows, count } = await ProminentPerson.findAndCountAll({
    where,
    include: [{ model: ProminentCategory, as: "Category", required: false }],
    order,
    limit,
    offset: (page - 1) * limit,
    distinct: true
  });

  const items = await Promise.all(rows.map((r) => mapPersonCard(r as any)));
  const out = {
    items,
    page,
    limit,
    total: count,
    hasMore: page * limit < count
  };
  mdmCacheSet(cacheKey, out, PROMINENT_LIST_CACHE_TTL_MS);
  return out;
}

export async function getPersonById(id: number, opts?: { publishedOnly?: boolean }) {
  const person = await ProminentPerson.findByPk(id, {
    include: [
      { model: ProminentCategory, as: "Category", required: false },
      { model: ProminentGalleryItem, as: "Gallery", required: false },
      { model: ProminentTimelineEntry, as: "Timeline", required: false }
    ]
  });
  if (!person) throw httpError("Person not found.", 404);
  if (opts?.publishedOnly !== false && !person.isPublished) {
    throw httpError("Person not found.", 404);
  }
  return mapPersonDetail(person as any);
}

export async function adminListPeople(input: {
  q?: string;
  categoryId?: number;
  published?: boolean;
  featured?: boolean;
  page?: number;
  limit?: number;
  sort?: ProminentSortOption;
}) {
  const page = Math.max(1, Number(input.page) || 1);
  const limit = clampPageSize(input.limit);
  const sort: ProminentSortOption = input.sort === "alphabetical" ? "alphabetical" : "latest";
  const where: WhereOptions = {};
  if (input.published === true) (where as any).isPublished = true;
  if (input.published === false) (where as any).isPublished = false;
  if (input.featured === true) (where as any).isFeatured = true;
  if (input.categoryId) (where as any).categoryId = input.categoryId;
  const q = input.q?.trim();
  if (q) {
    const like = `%${q.replace(/[%_]/g, "\\$&")}%`;
    (where as any)[Op.or] = [
      { fullName: { [Op.like]: like } },
      { occupation: { [Op.like]: like } },
      { currentDesignation: { [Op.like]: like } }
    ];
  }
  const order: Order =
    sort === "alphabetical"
      ? [
          ["fullName", "ASC"],
          ["id", "ASC"]
        ]
      : [
          ["updatedAt", "DESC"],
          ["id", "DESC"]
        ];
  const { rows, count } = await ProminentPerson.findAndCountAll({
    where,
    include: [{ model: ProminentCategory, as: "Category", required: false }],
    order,
    limit,
    offset: (page - 1) * limit,
    distinct: true
  });
  const items = await Promise.all(rows.map((r) => mapPersonCard(r as any)));
  return { items, page, limit, total: count, hasMore: page * limit < count };
}

async function replaceTimeline(personId: number, entries: TimelineInput[] | undefined) {
  if (entries === undefined) return;
  await ProminentTimelineEntry.destroy({ where: { personId } });
  if (!entries.length) return;
  const now = new Date();
  await ProminentTimelineEntry.bulkCreate(
    entries.map((e, i) => ({
      personId,
      year: String(e.year).trim(),
      title: String(e.title).trim(),
      description: e.description?.trim() || null,
      sortOrder: e.sortOrder ?? i,
      createdAt: now,
      updatedAt: now
    })) as any
  );
}

async function replaceGallery(personId: number, items: GalleryInput[] | undefined) {
  if (items === undefined) return;
  await ProminentGalleryItem.destroy({ where: { personId } });
  if (!items.length) return;
  const now = new Date();
  await ProminentGalleryItem.bulkCreate(
    items.map((g, i) => ({
      personId,
      imageKey: normalizeKey(g.imageKey) || g.imageKey,
      caption: g.caption?.trim() || null,
      sortOrder: g.sortOrder ?? i,
      createdAt: now,
      updatedAt: now
    })) as any
  );
}

export async function createPerson(input: PersonWriteInput, adminEmail: string) {
  const category = await ProminentCategory.findByPk(input.categoryId);
  if (!category || !category.isActive) throw httpError("Invalid category.", 400);

  const now = new Date();
  const isPublished = !!input.isPublished;
  const person = await ProminentPerson.create({
    fullName: input.fullName.trim(),
    categoryId: input.categoryId,
    occupation: input.occupation?.trim() || null,
    currentDesignation: input.currentDesignation?.trim() || null,
    shortDescription: input.shortDescription?.trim() || null,
    biography: input.biography?.trim() || null,
    education: input.education?.trim() || null,
    achievements: input.achievements?.trim() || null,
    awards: input.awards?.trim() || null,
    communityContribution: input.communityContribution?.trim() || null,
    profileImageKey: normalizeKey(input.profileImageKey),
    heroImageKey: normalizeKey(input.heroImageKey),
    isFeatured: !!input.isFeatured,
    isPublished,
    featuredSortOrder: input.featuredSortOrder ?? 0,
    sortOrder: input.sortOrder ?? 0,
    createdBy: adminEmail,
    updatedBy: adminEmail,
    publishedAt: isPublished ? now : null,
    createdAt: now,
    updatedAt: now
  } as any);

  await replaceTimeline(person.id, input.timeline);
  await replaceGallery(person.id, input.gallery);
  mdmCacheInvalidateAll();
  return getPersonById(person.id, { publishedOnly: false });
}

export async function updatePerson(id: number, input: Partial<PersonWriteInput>, adminEmail: string) {
  const person = await ProminentPerson.findByPk(id);
  if (!person) throw httpError("Person not found.", 404);

  if (input.categoryId != null) {
    const category = await ProminentCategory.findByPk(input.categoryId);
    if (!category || !category.isActive) throw httpError("Invalid category.", 400);
  }

  const updates: Record<string, unknown> = { updatedBy: adminEmail };
  if (input.fullName !== undefined) updates.fullName = input.fullName.trim();
  if (input.categoryId !== undefined) updates.categoryId = input.categoryId;
  if (input.occupation !== undefined) updates.occupation = input.occupation?.trim() || null;
  if (input.currentDesignation !== undefined)
    updates.currentDesignation = input.currentDesignation?.trim() || null;
  if (input.shortDescription !== undefined)
    updates.shortDescription = input.shortDescription?.trim() || null;
  if (input.biography !== undefined) updates.biography = input.biography?.trim() || null;
  if (input.education !== undefined) updates.education = input.education?.trim() || null;
  if (input.achievements !== undefined) updates.achievements = input.achievements?.trim() || null;
  if (input.awards !== undefined) updates.awards = input.awards?.trim() || null;
  if (input.communityContribution !== undefined)
    updates.communityContribution = input.communityContribution?.trim() || null;
  if (input.profileImageKey !== undefined)
    updates.profileImageKey = normalizeKey(input.profileImageKey);
  if (input.heroImageKey !== undefined) updates.heroImageKey = normalizeKey(input.heroImageKey);
  if (input.isFeatured !== undefined) updates.isFeatured = !!input.isFeatured;
  if (input.featuredSortOrder !== undefined) updates.featuredSortOrder = input.featuredSortOrder;
  if (input.sortOrder !== undefined) updates.sortOrder = input.sortOrder;
  if (input.isPublished !== undefined) {
    updates.isPublished = !!input.isPublished;
    if (input.isPublished && !person.publishedAt) updates.publishedAt = new Date();
    if (!input.isPublished) updates.publishedAt = null;
  }

  await person.update(updates as any);
  await replaceTimeline(person.id, input.timeline);
  await replaceGallery(person.id, input.gallery);
  mdmCacheInvalidateAll();
  return getPersonById(person.id, { publishedOnly: false });
}

export async function deletePerson(id: number) {
  const person = await ProminentPerson.findByPk(id);
  if (!person) throw httpError("Person not found.", 404);
  await ProminentGalleryItem.destroy({ where: { personId: id } });
  await ProminentTimelineEntry.destroy({ where: { personId: id } });
  await person.destroy();
  mdmCacheInvalidateAll();
  return { ok: true };
}

export async function setPublished(id: number, isPublished: boolean, adminEmail: string) {
  return updatePerson(id, { isPublished }, adminEmail);
}

export async function setFeatured(id: number, isFeatured: boolean, adminEmail: string) {
  return updatePerson(id, { isFeatured }, adminEmail);
}

/** Admin CMS upload — direct R2 (no media_files user FK). */
export async function generateProminentUploadUrl(
  kind: ProminentMediaKind,
  fileName: string,
  fileType: string
) {
  const built = buildProminentObjectKey(kind, fileName, fileType);
  const uploadUrl = await getPresignedPutUrl(built.key, built.mime);
  const publicUrl = getCdnPublicUrl(built.key);
  return { uploadUrl, publicUrl, key: built.key, fileName: built.safe };
}

function buildProminentObjectKey(kind: ProminentMediaKind, fileName: string, fileType: string) {
  const mime = fileType.toLowerCase().trim();
  if (!["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(mime)) {
    throw httpError("Only jpeg, png, or webp images are allowed.", 400);
  }
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const base = `${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
  const ext = mime.includes("png") ? ".png" : mime.includes("webp") ? ".webp" : ".jpg";
  const safe = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, "_") || `image${ext}`;
  const key = `digital-house/images/prominent/${kind}/${yyyy}/${mm}/${base}${ext}`;
  return { key, mime, safe };
}

/**
 * Proxy upload for admin panel — avoids browser→R2 CORS failures on private buckets.
 * Accepts base64 image payload and returns key + signed preview URL.
 */
export async function uploadProminentImageBuffer(input: {
  kind: ProminentMediaKind;
  fileName: string;
  fileType: string;
  dataBase64: string;
}) {
  const raw = input.dataBase64.includes(",")
    ? input.dataBase64.split(",").pop() || ""
    : input.dataBase64;
  let buffer: Buffer;
  try {
    buffer = Buffer.from(raw, "base64");
  } catch {
    throw httpError("Invalid image data.", 400);
  }
  if (!buffer.length) throw httpError("Empty image data.", 400);
  if (buffer.length > 2.5 * 1024 * 1024) {
    throw httpError("Image must be 2.5 MB or smaller.", 400);
  }

  const built = buildProminentObjectKey(input.kind, input.fileName, input.fileType);
  await putR2ObjectBuffer(built.key, buffer, built.mime);
  const publicUrl = getCdnPublicUrl(built.key);
  const previewUrl = await getPresignedGetUrl(built.key, 3600);
  return {
    key: built.key,
    publicUrl,
    previewUrl,
    fileName: built.safe,
    byteSize: buffer.length
  };
}

export const prominentPeopleService = {
  listCategories,
  listFeatured,
  listPeople,
  getPersonById,
  adminListPeople,
  createPerson,
  updatePerson,
  deletePerson,
  setPublished,
  setFeatured,
  generateProminentUploadUrl,
  uploadProminentImageBuffer
};
