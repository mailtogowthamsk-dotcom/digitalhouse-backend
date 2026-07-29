import { Op } from "sequelize";
import {
  LEGAL_DOCUMENT_TYPE_SEEDS,
  LEGAL_PLATFORM_DEFAULTS,
  type LegalAcceptanceSource,
  type LegalVersionBump
} from "../constants/legal.constants";
import {
  LegalDocument,
  LegalDocumentAcceptance,
  LegalDocumentType
} from "../models/LegalDocument.model";
import { sanitizeLegalHtml } from "../utils/sanitizeLegalHtml";
import type {
  CreateLegalDraftBody,
  CreateLegalTypeBody,
  UpdateLegalDraftBody,
  UpdateLegalTypeBody
} from "../validations/legal.validation";

function serviceError(message: string, status: number, code?: string): never {
  throw Object.assign(new Error(message), { status, code });
}

function formatVersion(major: number, minor: number): string {
  return `${major}.${minor}`;
}

function nextVersion(
  current: { versionMajor: number; versionMinor: number } | null,
  bump: LegalVersionBump
): { version: string; versionMajor: number; versionMinor: number } {
  if (!current) {
    return { version: "1.0", versionMajor: 1, versionMinor: 0 };
  }
  if (bump === "major") {
    const versionMajor = current.versionMajor + 1;
    return { version: formatVersion(versionMajor, 0), versionMajor, versionMinor: 0 };
  }
  const versionMinor = current.versionMinor + 1;
  return {
    version: formatVersion(current.versionMajor, versionMinor),
    versionMajor: current.versionMajor,
    versionMinor
  };
}

function toTypeDto(row: LegalDocumentType) {
  return {
    id: row.id,
    documentKey: row.documentKey,
    title: row.title,
    slug: row.slug,
    description: row.description,
    sortOrder: row.sortOrder,
    requiredAtRegistration: row.requiredAtRegistration,
    requiresReacceptance: row.requiresReacceptance,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function toDocumentDto(row: LegalDocument, opts?: { includeContent?: boolean }) {
  const base = {
    id: row.id,
    documentKey: row.documentKey,
    title: row.title,
    slug: row.slug,
    contentFormat: row.contentFormat,
    version: row.version,
    versionMajor: row.versionMajor,
    versionMinor: row.versionMinor,
    status: row.status,
    isPublished: row.isPublished,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    changeSummary: row.changeSummary,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
  if (opts?.includeContent === false) return base;
  return { ...base, content: row.content };
}

export async function ensureLegalDefaults(): Promise<void> {
  for (const seed of LEGAL_DOCUMENT_TYPE_SEEDS) {
    const existing = await LegalDocumentType.findOne({
      where: { documentKey: seed.documentKey }
    });
    if (existing) continue;
    await LegalDocumentType.create({
      documentKey: seed.documentKey,
      title: seed.title,
      slug: seed.slug,
      description: seed.description,
      sortOrder: seed.sortOrder,
      requiredAtRegistration: seed.requiredAtRegistration,
      requiresReacceptance: seed.requiresReacceptance,
      isActive: true
    } as any);
  }

  // Seed draft content only when a key has zero versions.
  try {
    const { buildLegalSeedDocuments } = await import("../seed/legalDocuments.content");
    const docs = buildLegalSeedDocuments({ ...LEGAL_PLATFORM_DEFAULTS });
    for (const doc of docs) {
      const count = await LegalDocument.count({ where: { documentKey: doc.documentKey } });
      if (count > 0) continue;
      const type = await LegalDocumentType.findOne({ where: { documentKey: doc.documentKey } });
      if (!type) continue;
      await LegalDocument.create({
        documentKey: doc.documentKey,
        title: doc.title || type.title,
        slug: type.slug,
        content: sanitizeLegalHtml(doc.content),
        contentFormat: "html",
        version: "1.0",
        versionMajor: 1,
        versionMinor: 0,
        status: "DRAFT",
        isPublished: false,
        publishedAt: null,
        changeSummary: "Initial Digital House draft",
        createdBy: "system",
        updatedBy: "system"
      } as any);
    }
  } catch (e) {
    console.warn("[legal] seed content skipped:", e instanceof Error ? e.message : e);
  }
}

export async function listTypes(includeInactive = false) {
  const rows = await LegalDocumentType.findAll({
    where: includeInactive ? undefined : { isActive: true },
    order: [
      ["sortOrder", "ASC"],
      ["title", "ASC"]
    ]
  });
  return rows.map(toTypeDto);
}

export async function createType(body: CreateLegalTypeBody, adminEmail: string) {
  const exists = await LegalDocumentType.findOne({
    where: {
      [Op.or]: [{ documentKey: body.documentKey }, { slug: body.slug }]
    }
  });
  if (exists) serviceError("A document type with this key or slug already exists.", 409, "LEGAL_TYPE_EXISTS");

  const row = await LegalDocumentType.create({
    documentKey: body.documentKey,
    title: body.title,
    slug: body.slug,
    description: body.description ?? null,
    sortOrder: body.sortOrder ?? 100,
    requiredAtRegistration: body.requiredAtRegistration ?? false,
    requiresReacceptance: body.requiresReacceptance ?? false,
    isActive: body.isActive ?? true
  } as any);

  void adminEmail;
  return toTypeDto(row);
}

export async function updateType(documentKey: string, body: UpdateLegalTypeBody) {
  const row = await LegalDocumentType.findOne({ where: { documentKey } });
  if (!row) serviceError("Document type not found.", 404, "LEGAL_TYPE_NOT_FOUND");

  if (body.slug && body.slug !== row.slug) {
    const clash = await LegalDocumentType.findOne({ where: { slug: body.slug } });
    if (clash) serviceError("Slug already in use.", 409, "LEGAL_SLUG_EXISTS");
  }

  await row.update({
    title: body.title ?? row.title,
    slug: body.slug ?? row.slug,
    description: body.description === undefined ? row.description : body.description,
    sortOrder: body.sortOrder ?? row.sortOrder,
    requiredAtRegistration: body.requiredAtRegistration ?? row.requiredAtRegistration,
    requiresReacceptance: body.requiresReacceptance ?? row.requiresReacceptance,
    isActive: body.isActive ?? row.isActive
  });

  // Keep published/draft slug/title in sync for discoverability.
  if (body.slug || body.title) {
    await LegalDocument.update(
      {
        ...(body.slug ? { slug: body.slug } : {}),
        ...(body.title ? { title: body.title } : {})
      } as any,
      { where: { documentKey, isPublished: true } }
    );
  }

  return toTypeDto(row);
}

export async function listDocumentsSummary() {
  const types = await LegalDocumentType.findAll({
    order: [
      ["sortOrder", "ASC"],
      ["title", "ASC"]
    ]
  });
  const published = await LegalDocument.findAll({ where: { isPublished: true } });
  const byKey = new Map(published.map((d) => [d.documentKey, d]));

  const drafts = await LegalDocument.findAll({
    where: { status: "DRAFT" },
    order: [["updatedAt", "DESC"]]
  });
  const draftByKey = new Map<string, LegalDocument>();
  for (const d of drafts) {
    if (!draftByKey.has(d.documentKey)) draftByKey.set(d.documentKey, d);
  }

  return types.map((type) => {
    const live = byKey.get(type.documentKey) ?? null;
    const draft = draftByKey.get(type.documentKey) ?? null;
    return {
      ...toTypeDto(type),
      currentVersion: live?.version ?? null,
      publishedStatus: live ? "PUBLISHED" : draft ? "DRAFT" : "NONE",
      isPublished: !!live,
      publishedAt: live?.publishedAt ? live.publishedAt.toISOString() : null,
      lastUpdatedAt: (draft?.updatedAt ?? live?.updatedAt ?? type.updatedAt).toISOString(),
      lastUpdatedBy: draft?.updatedBy ?? live?.updatedBy ?? null,
      publishedDocumentId: live?.id ?? null,
      draftDocumentId: draft?.id ?? null
    };
  });
}

async function requireType(documentKey: string) {
  const type = await LegalDocumentType.findOne({ where: { documentKey } });
  if (!type || !type.isActive) {
    serviceError("Document type not found.", 404, "LEGAL_TYPE_NOT_FOUND");
  }
  return type;
}

export async function getDocumentById(id: number, includeContent = true) {
  const row = await LegalDocument.findByPk(id);
  if (!row) serviceError("Document version not found.", 404, "LEGAL_DOC_NOT_FOUND");
  return toDocumentDto(row, { includeContent });
}

export async function getLatestDraft(documentKey: string) {
  await requireType(documentKey);
  const draft = await LegalDocument.findOne({
    where: { documentKey, status: "DRAFT" },
    order: [["updatedAt", "DESC"]]
  });
  if (draft) return toDocumentDto(draft);
  const published = await LegalDocument.findOne({
    where: { documentKey, isPublished: true }
  });
  return published ? toDocumentDto(published) : null;
}

export async function createDraft(body: CreateLegalDraftBody, adminEmail: string) {
  const type = await requireType(body.documentKey);
  const existingDraft = await LegalDocument.findOne({
    where: { documentKey: body.documentKey, status: "DRAFT" },
    order: [["updatedAt", "DESC"]]
  });
  if (existingDraft) {
    serviceError(
      "A draft already exists for this document. Edit or publish it first.",
      409,
      "LEGAL_DRAFT_EXISTS"
    );
  }

  const published = await LegalDocument.findOne({
    where: { documentKey: body.documentKey, isPublished: true }
  });
  const versionInfo = published
    ? {
        version: `${published.versionMajor}.${published.versionMinor}-draft`,
        versionMajor: published.versionMajor,
        versionMinor: published.versionMinor
      }
    : { version: "1.0-draft", versionMajor: 1, versionMinor: 0 };

  // Draft versions use a unique suffix so they don't collide with published versions.
  const row = await LegalDocument.create({
    documentKey: body.documentKey,
    title: body.title?.trim() || type.title,
    slug: type.slug,
    content: sanitizeLegalHtml(body.content),
    contentFormat: body.contentFormat ?? "html",
    version: versionInfo.version,
    versionMajor: versionInfo.versionMajor,
    versionMinor: versionInfo.versionMinor,
    status: "DRAFT",
    isPublished: false,
    publishedAt: null,
    changeSummary: body.changeSummary ?? null,
    createdBy: adminEmail,
    updatedBy: adminEmail
  } as any);

  return toDocumentDto(row);
}

export async function updateDraft(id: number, body: UpdateLegalDraftBody, adminEmail: string) {
  const row = await LegalDocument.findByPk(id);
  if (!row) serviceError("Document version not found.", 404, "LEGAL_DOC_NOT_FOUND");
  if (row.status !== "DRAFT") {
    serviceError("Only draft documents can be edited. Restore to draft first.", 400, "LEGAL_NOT_DRAFT");
  }

  await row.update({
    title: body.title?.trim() || row.title,
    content: body.content != null ? sanitizeLegalHtml(body.content) : row.content,
    contentFormat: body.contentFormat ?? row.contentFormat,
    changeSummary:
      body.changeSummary === undefined ? row.changeSummary : body.changeSummary,
    updatedBy: adminEmail
  });

  return toDocumentDto(row);
}

export async function publishDocument(
  documentKey: string,
  opts: { bump: LegalVersionBump; changeSummary?: string | null; documentId?: number },
  adminEmail: string
) {
  const type = await requireType(documentKey);
  const draft =
    (opts.documentId
      ? await LegalDocument.findOne({
          where: { id: opts.documentId, documentKey, status: "DRAFT" }
        })
      : await LegalDocument.findOne({
          where: { documentKey, status: "DRAFT" },
          order: [["updatedAt", "DESC"]]
        })) ?? null;

  if (!draft) serviceError("No draft available to publish.", 400, "LEGAL_NO_DRAFT");

  const currentPublished = await LegalDocument.findOne({
    where: { documentKey, isPublished: true }
  });
  const versionInfo = nextVersion(
    currentPublished
      ? { versionMajor: currentPublished.versionMajor, versionMinor: currentPublished.versionMinor }
      : null,
    opts.bump
  );

  const clash = await LegalDocument.findOne({
    where: { documentKey, version: versionInfo.version }
  });
  if (clash && clash.id !== draft.id) {
    serviceError("Version collision. Choose a different bump.", 409, "LEGAL_VERSION_CLASH");
  }

  const now = new Date();

  await LegalDocument.sequelize!.transaction(async (tx) => {
    if (currentPublished) {
      await currentPublished.update(
        { isPublished: false, status: "ARCHIVED", updatedBy: adminEmail },
        { transaction: tx }
      );
    }
    await draft.update(
      {
        title: draft.title || type.title,
        slug: type.slug,
        version: versionInfo.version,
        versionMajor: versionInfo.versionMajor,
        versionMinor: versionInfo.versionMinor,
        status: "PUBLISHED",
        isPublished: true,
        publishedAt: now,
        changeSummary: opts.changeSummary ?? draft.changeSummary,
        updatedBy: adminEmail
      },
      { transaction: tx }
    );
  });

  await draft.reload();
  return toDocumentDto(draft);
}

export async function listHistory(documentKey: string) {
  await requireType(documentKey);
  const rows = await LegalDocument.findAll({
    where: { documentKey },
    order: [
      ["versionMajor", "DESC"],
      ["versionMinor", "DESC"],
      ["updatedAt", "DESC"]
    ]
  });
  return rows.map((r) => toDocumentDto(r, { includeContent: false }));
}

export async function compareVersions(documentKey: string, leftId: number, rightId: number) {
  await requireType(documentKey);
  const [left, right] = await Promise.all([
    LegalDocument.findOne({ where: { id: leftId, documentKey } }),
    LegalDocument.findOne({ where: { id: rightId, documentKey } })
  ]);
  if (!left || !right) serviceError("One or both versions were not found.", 404, "LEGAL_DOC_NOT_FOUND");
  return {
    left: toDocumentDto(left),
    right: toDocumentDto(right)
  };
}

export async function restoreVersion(
  documentKey: string,
  versionId: number,
  adminEmail: string
) {
  await requireType(documentKey);
  const source = await LegalDocument.findOne({ where: { id: versionId, documentKey } });
  if (!source) serviceError("Version not found.", 404, "LEGAL_DOC_NOT_FOUND");

  const existingDraft = await LegalDocument.findOne({
    where: { documentKey, status: "DRAFT" },
    order: [["updatedAt", "DESC"]]
  });

  if (existingDraft) {
    await existingDraft.update({
      title: source.title,
      content: source.content,
      contentFormat: source.contentFormat,
      changeSummary: `Restored from version ${source.version}`,
      updatedBy: adminEmail
    });
    return toDocumentDto(existingDraft);
  }

  const published = await LegalDocument.findOne({
    where: { documentKey, isPublished: true }
  });
  const draftVersion = published
    ? `${published.versionMajor}.${published.versionMinor}-draft`
    : `${source.versionMajor}.${source.versionMinor}-draft`;

  const draft = await LegalDocument.create({
    documentKey,
    title: source.title,
    slug: source.slug,
    content: source.content,
    contentFormat: source.contentFormat,
    version: draftVersion,
    versionMajor: source.versionMajor,
    versionMinor: source.versionMinor,
    status: "DRAFT",
    isPublished: false,
    publishedAt: null,
    changeSummary: `Restored from version ${source.version}`,
    createdBy: adminEmail,
    updatedBy: adminEmail
  } as any);

  return toDocumentDto(draft);
}

/** Public: resolve published document by slug or documentKey. */
export async function getPublished(slugOrKey: string) {
  const type =
    (await LegalDocumentType.findOne({
      where: {
        isActive: true,
        [Op.or]: [{ slug: slugOrKey }, { documentKey: slugOrKey }]
      }
    })) ?? null;

  const documentKey = type?.documentKey ?? slugOrKey;
  const row = await LegalDocument.findOne({
    where: { documentKey, isPublished: true }
  });
  if (!row) serviceError("Published document not found.", 404, "LEGAL_NOT_PUBLISHED");
  return {
    type: type ? toTypeDto(type) : null,
    document: toDocumentDto(row)
  };
}

export async function listPublishedCatalog() {
  const types = await LegalDocumentType.findAll({
    where: { isActive: true },
    order: [
      ["sortOrder", "ASC"],
      ["title", "ASC"]
    ]
  });
  const published = await LegalDocument.findAll({ where: { isPublished: true } });
  const byKey = new Map(published.map((d) => [d.documentKey, d]));

  return types
    .map((type) => {
      const live = byKey.get(type.documentKey);
      if (!live) return null;
      return {
        documentKey: type.documentKey,
        title: live.title || type.title,
        slug: type.slug,
        description: type.description,
        version: live.version,
        publishedAt: live.publishedAt ? live.publishedAt.toISOString() : null,
        requiredAtRegistration: type.requiredAtRegistration,
        requiresReacceptance: type.requiresReacceptance,
        sortOrder: type.sortOrder
      };
    })
    .filter(Boolean);
}

async function latestAcceptedMap(userId: number) {
  const rows = await LegalDocumentAcceptance.findAll({
    where: { userId },
    order: [["acceptedAt", "DESC"]]
  });
  const map = new Map<string, LegalDocumentAcceptance>();
  for (const row of rows) {
    if (!map.has(row.documentKey)) map.set(row.documentKey, row);
  }
  return map;
}

export async function getAcceptanceStatus(userId: number) {
  const types = await LegalDocumentType.findAll({
    where: { isActive: true },
    order: [
      ["sortOrder", "ASC"],
      ["title", "ASC"]
    ]
  });
  const published = await LegalDocument.findAll({ where: { isPublished: true } });
  const publishedByKey = new Map(published.map((d) => [d.documentKey, d]));
  const accepted = await latestAcceptedMap(userId);

  const items = types.map((type) => {
    const live = publishedByKey.get(type.documentKey) ?? null;
    const acc = accepted.get(type.documentKey) ?? null;
    const acceptedCurrent = !!(live && acc && acc.version === live.version);
    const needsAcceptance = !!(
      live &&
      type.requiresReacceptance &&
      !acceptedCurrent
    );
    return {
      documentKey: type.documentKey,
      title: live?.title || type.title,
      slug: type.slug,
      requiredAtRegistration: type.requiredAtRegistration,
      requiresReacceptance: type.requiresReacceptance,
      publishedVersion: live?.version ?? null,
      publishedDocumentId: live?.id ?? null,
      acceptedVersion: acc?.version ?? null,
      acceptedAt: acc?.acceptedAt ? acc.acceptedAt.toISOString() : null,
      acceptedCurrent,
      needsAcceptance
    };
  });

  const pendingReacceptance = items.filter((i) => i.needsAcceptance);
  const registrationRequired = items.filter((i) => i.requiredAtRegistration && i.publishedVersion);

  return {
    mustAccept: pendingReacceptance.length > 0,
    pending: pendingReacceptance,
    registrationRequired,
    items
  };
}

export async function acceptDocuments(opts: {
  userId: number;
  documentKeys: string[];
  source: LegalAcceptanceSource;
  ipAddress?: string | null;
  userAgent?: string | null;
  /** When set, require exact published versions (registration). */
  expectedVersions?: Record<string, string>;
}) {
  const uniqueKeys = [...new Set(opts.documentKeys)];
  const results: Array<{ documentKey: string; version: string; documentId: number }> = [];

  for (const documentKey of uniqueKeys) {
    const type = await LegalDocumentType.findOne({ where: { documentKey, isActive: true } });
    if (!type) serviceError(`Unknown legal document: ${documentKey}`, 400, "LEGAL_TYPE_NOT_FOUND");

    const live = await LegalDocument.findOne({
      where: { documentKey, isPublished: true }
    });
    if (!live) {
      serviceError(
        `No published version for ${type.title}.`,
        400,
        "LEGAL_NOT_PUBLISHED"
      );
    }

    if (opts.expectedVersions?.[documentKey] && opts.expectedVersions[documentKey] !== live.version) {
      serviceError(
        `${type.title} was updated. Please review the latest version.`,
        409,
        "LEGAL_VERSION_STALE"
      );
    }

    const existing = await LegalDocumentAcceptance.findOne({
      where: {
        userId: opts.userId,
        documentKey,
        version: live.version
      }
    });
    if (!existing) {
      await LegalDocumentAcceptance.create({
        userId: opts.userId,
        documentKey,
        documentId: live.id,
        version: live.version,
        source: opts.source,
        ipAddress: opts.ipAddress ?? null,
        userAgent: opts.userAgent ? opts.userAgent.slice(0, 500) : null,
        acceptedAt: new Date()
      } as any);
    }

    results.push({
      documentKey,
      version: live.version,
      documentId: live.id
    });
  }

  const status = await getAcceptanceStatus(opts.userId);
  return { accepted: results, status };
}

export async function assertRegistrationAcceptances(
  acceptances: Array<{ documentKey: string; version: string }>
) {
  const requiredTypes = await LegalDocumentType.findAll({
    where: { isActive: true, requiredAtRegistration: true }
  });
  if (requiredTypes.length === 0) return;

  const provided = new Map(acceptances.map((a) => [a.documentKey, a.version]));
  for (const type of requiredTypes) {
    const live = await LegalDocument.findOne({
      where: { documentKey: type.documentKey, isPublished: true }
    });
    if (!live) {
      // Nothing published yet — do not block registration on empty catalog.
      continue;
    }
    const version = provided.get(type.documentKey);
    if (!version) {
      serviceError(
        `You must accept the ${type.title}.`,
        400,
        "LEGAL_ACCEPTANCE_REQUIRED"
      );
    }
    if (version !== live.version) {
      serviceError(
        `${type.title} was updated. Please review and accept the latest version.`,
        409,
        "LEGAL_VERSION_STALE"
      );
    }
  }
}

export function clientIp(req: { ip?: string; headers: Record<string, unknown> }): string | null {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0]?.trim() || null;
  }
  return req.ip ?? null;
}

export const legalService = {
  ensureLegalDefaults,
  listTypes,
  createType,
  updateType,
  listDocumentsSummary,
  getDocumentById,
  getLatestDraft,
  createDraft,
  updateDraft,
  publishDocument,
  listHistory,
  compareVersions,
  restoreVersion,
  getPublished,
  listPublishedCatalog,
  getAcceptanceStatus,
  acceptDocuments,
  assertRegistrationAcceptances,
  clientIp
};
