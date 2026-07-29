/**
 * Centralized Business Settings — DB first, constant fallback, in-memory cache.
 * Does not replace domain constants; callers opt in gradually (Phase 2+).
 */

import { PlatformBusinessSetting } from "../models";
import {
  BUSINESS_SETTING_DEFINITION_MAP,
  BUSINESS_SETTING_DEFINITIONS,
  BUSINESS_SETTING_MODULES,
  BUSINESS_SETTING_VALUE_TYPES,
  BUSINESS_SETTINGS_CACHE_TTL_MS,
  definitionKey,
  type BusinessSettingDefinition,
  type BusinessSettingModule,
  type BusinessSettingValueType
} from "../constants/businessSettings.constants";
import { recordConfigChange, valuesEqual } from "./PlatformConfigAudit.service";

type CacheEntry = { parsed: unknown; expiresAt: number };

const valueCache = new Map<string, CacheEntry>();
/** Coalesce concurrent module warm loads into one DB round-trip. */
const moduleWarmInflight = new Map<string, Promise<void>>();

function now() {
  return new Date();
}

function serializeValue(value: unknown, valueType: BusinessSettingValueType): string {
  if (valueType === "json") {
    return JSON.stringify(value ?? null);
  }
  if (valueType === "boolean") {
    return value === true || value === "true" || value === 1 || value === "1" ? "true" : "false";
  }
  if (valueType === "number") {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) {
      const err: any = new Error("Invalid number value");
      err.status = 400;
      throw err;
    }
    return String(n);
  }
  return String(value ?? "");
}

function parseStoredValue(raw: string, valueType: BusinessSettingValueType): unknown {
  if (valueType === "json") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (valueType === "boolean") {
    return raw === "true" || raw === "1";
  }
  if (valueType === "number") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : NaN;
  }
  return raw;
}

function parseDefault(def: BusinessSettingDefinition): unknown {
  return def.defaultValue;
}

function invalidateCache(module?: string, key?: string) {
  if (module && key) {
    valueCache.delete(definitionKey(module, key));
    return;
  }
  if (module) {
    for (const k of valueCache.keys()) {
      if (k.startsWith(`${module}::`)) valueCache.delete(k);
    }
    moduleWarmInflight.delete(module);
    return;
  }
  valueCache.clear();
  moduleWarmInflight.clear();
}

function moduleCacheFresh(module: string): boolean {
  const nowMs = Date.now();
  const defs = BUSINESS_SETTING_DEFINITIONS.filter((d) => d.module === module);
  if (defs.length === 0) return false;
  return defs.every((d) => {
    const hit = valueCache.get(definitionKey(d.module, d.key));
    return Boolean(hit && hit.expiresAt > nowMs);
  });
}

/** Bulk warm: one findAll per module; fills registry keys + orphan DB rows. */
export async function warmModuleCache(module: string): Promise<void> {
  const rows = await PlatformBusinessSetting.findAll({ where: { module } });
  const expiresAt = Date.now() + BUSINESS_SETTINGS_CACHE_TTL_MS;
  const byKey = new Map(rows.map((r) => [r.settingKey, r]));

  for (const def of BUSINESS_SETTING_DEFINITIONS) {
    if (def.module !== module) continue;
    const row = byKey.get(def.key);
    valueCache.set(definitionKey(def.module, def.key), {
      parsed: row ? parseStoredValue(row.value, row.valueType) : parseDefault(def),
      expiresAt
    });
  }
  for (const row of rows) {
    const ck = definitionKey(row.module, row.settingKey);
    if (BUSINESS_SETTING_DEFINITION_MAP.has(ck)) continue;
    valueCache.set(ck, {
      parsed: parseStoredValue(row.value, row.valueType),
      expiresAt
    });
  }
}

/** Ensure module values are in cache (shared across concurrent callers). */
export async function ensureModuleWarmed(module: string): Promise<void> {
  if (moduleCacheFresh(module)) return;
  let pending = moduleWarmInflight.get(module);
  if (!pending) {
    pending = warmModuleCache(module).finally(() => {
      moduleWarmInflight.delete(module);
    });
    moduleWarmInflight.set(module, pending);
  }
  await pending;
}

function refreshSubscriptionCatalogIfNeeded(moduleName: string) {
  if (moduleName !== "subscriptions") return;
  void import("./MatrimonyPlatformSettings.service")
    .then((m) => m.refreshPlanCatalogCache())
    .catch(() => {});
}

export type EffectiveBusinessSetting = {
  id: number | null;
  module: string;
  settingKey: string;
  value: unknown;
  rawValue: string;
  valueType: BusinessSettingValueType;
  description: string | null;
  category: string | null;
  isEditable: boolean;
  source: "database" | "constant";
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

function rowToEffective(row: PlatformBusinessSetting): EffectiveBusinessSetting {
  return {
    id: row.id,
    module: row.module,
    settingKey: row.settingKey,
    value: parseStoredValue(row.value, row.valueType),
    rawValue: row.value,
    valueType: row.valueType,
    description: row.description,
    category: row.category,
    isEditable: row.isEditable,
    source: "database",
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function defToEffective(def: BusinessSettingDefinition): EffectiveBusinessSetting {
  const parsed = parseDefault(def);
  return {
    id: null,
    module: def.module,
    settingKey: def.key,
    value: parsed,
    rawValue: serializeValue(parsed, def.valueType),
    valueType: def.valueType,
    description: def.description,
    category: def.category,
    isEditable: def.isEditable,
    source: "constant",
    createdBy: null,
    updatedBy: null,
    createdAt: null,
    updatedAt: null
  };
}

/** Resolve one setting: cache → module warm (one DB query) → constant default. */
export async function getSettingValue(
  module: string,
  key: string,
  options?: { skipCache?: boolean }
): Promise<unknown> {
  const ck = definitionKey(module, key);
  if (!options?.skipCache) {
    const hit = valueCache.get(ck);
    if (hit && hit.expiresAt > Date.now()) return hit.parsed;
    await ensureModuleWarmed(module);
    const warmed = valueCache.get(ck);
    if (warmed && warmed.expiresAt > Date.now()) return warmed.parsed;
  }

  const row = await PlatformBusinessSetting.findOne({
    where: { module, settingKey: key }
  });

  let parsed: unknown;
  if (row) {
    parsed = parseStoredValue(row.value, row.valueType);
  } else {
    const def = BUSINESS_SETTING_DEFINITION_MAP.get(ck);
    if (!def) {
      const err: any = new Error(`Unknown business setting: ${module}.${key}`);
      err.status = 404;
      throw err;
    }
    parsed = parseDefault(def);
  }

  valueCache.set(ck, {
    parsed,
    expiresAt: Date.now() + BUSINESS_SETTINGS_CACHE_TTL_MS
  });
  return parsed;
}

export async function getNumberSetting(module: string, key: string): Promise<number> {
  const v = await getSettingValue(module, key);
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) {
    const def = BUSINESS_SETTING_DEFINITION_MAP.get(definitionKey(module, key));
    return typeof def?.defaultValue === "number" ? def.defaultValue : 0;
  }
  return n;
}

export async function getBooleanSetting(module: string, key: string): Promise<boolean> {
  const v = await getSettingValue(module, key);
  return v === true || v === "true" || v === 1;
}

export async function getStringSetting(module: string, key: string): Promise<string> {
  const v = await getSettingValue(module, key);
  return v == null ? "" : String(v);
}

export async function getJsonSetting<T = unknown>(module: string, key: string): Promise<T> {
  return (await getSettingValue(module, key)) as T;
}

/**
 * List effective settings for admin UI.
 * Merges registry definitions with DB overrides; includes orphan DB rows not in registry.
 */
export async function listEffectiveSettings(filters?: {
  module?: string;
  category?: string;
}): Promise<EffectiveBusinessSetting[]> {
  const where: Record<string, unknown> = {};
  if (filters?.module) where.module = filters.module;
  if (filters?.category) where.category = filters.category;

  const rows = await PlatformBusinessSetting.findAll({
    where: Object.keys(where).length ? where : undefined,
    order: [
      ["module", "ASC"],
      ["category", "ASC"],
      ["settingKey", "ASC"]
    ]
  });

  const byKey = new Map(rows.map((r) => [definitionKey(r.module, r.settingKey), r]));
  const out: EffectiveBusinessSetting[] = [];
  const seen = new Set<string>();

  for (const def of BUSINESS_SETTING_DEFINITIONS) {
    if (filters?.module && def.module !== filters.module) continue;
    if (filters?.category && def.category !== filters.category) continue;
    const ck = definitionKey(def.module, def.key);
    seen.add(ck);
    const row = byKey.get(ck);
    out.push(row ? rowToEffective(row) : defToEffective(def));
  }

  for (const row of rows) {
    const ck = definitionKey(row.module, row.settingKey);
    if (seen.has(ck)) continue;
    if (filters?.category && row.category !== filters.category) continue;
    out.push(rowToEffective(row));
  }

  // Seed value cache so subsequent runtime getters avoid repeat queries.
  const expiresAt = Date.now() + BUSINESS_SETTINGS_CACHE_TTL_MS;
  for (const s of out) {
    valueCache.set(definitionKey(s.module, s.settingKey), {
      parsed: s.value,
      expiresAt
    });
  }

  return out;
}

export async function getSettingDetail(
  module: string,
  key: string
): Promise<EffectiveBusinessSetting> {
  const row = await PlatformBusinessSetting.findOne({
    where: { module, settingKey: key }
  });
  if (row) return rowToEffective(row);
  const def = BUSINESS_SETTING_DEFINITION_MAP.get(definitionKey(module, key));
  if (def) return defToEffective(def);
  const err: any = new Error(`Setting not found: ${module}.${key}`);
  err.status = 404;
  throw err;
}

export async function upsertSetting(
  adminEmail: string | null,
  input: {
    module: string;
    settingKey: string;
    value: unknown;
    valueType?: BusinessSettingValueType;
    description?: string | null;
    category?: string | null;
    isEditable?: boolean;
  }
): Promise<EffectiveBusinessSetting> {
  const module = String(input.module || "")
    .trim()
    .toLowerCase();
  const settingKey = String(input.settingKey || "")
    .trim()
    .toLowerCase();
  if (!module || !settingKey) {
    const err: any = new Error("module and settingKey are required");
    err.status = 400;
    throw err;
  }

  const def = BUSINESS_SETTING_DEFINITION_MAP.get(definitionKey(module, settingKey));
  const valueType: BusinessSettingValueType =
    input.valueType || def?.valueType || ("string" as BusinessSettingValueType);

  if (!BUSINESS_SETTING_VALUE_TYPES.includes(valueType)) {
    const err: any = new Error("Invalid valueType");
    err.status = 400;
    throw err;
  }

  let row = await PlatformBusinessSetting.findOne({
    where: { module, settingKey }
  });

  const oldValue = row
    ? parseStoredValue(row.value, row.valueType)
    : def
      ? parseDefault(def)
      : null;

  if (row && row.isEditable === false) {
    const err: any = new Error("This setting is not editable");
    err.status = 403;
    throw err;
  }
  if (!row && def && def.isEditable === false) {
    const err: any = new Error("This setting is not editable");
    err.status = 403;
    throw err;
  }

  const serialized = serializeValue(input.value, valueType);
  const newValue = parseStoredValue(serialized, valueType);

  // No-op value write: avoid duplicate DB update + audit noise.
  if (row && valuesEqual(oldValue, newValue)) {
    return rowToEffective(row);
  }

  const description =
    input.description !== undefined
      ? input.description
      : row?.description ?? def?.description ?? null;
  const category =
    input.category !== undefined ? input.category : row?.category ?? def?.category ?? null;
  const isEditable =
    input.isEditable !== undefined
      ? input.isEditable
      : row?.isEditable ?? def?.isEditable ?? true;

  if (row) {
    await row.update({
      value: serialized,
      valueType,
      description,
      category,
      isEditable,
      updatedBy: adminEmail
    });
    await row.reload();
  } else {
    row = await PlatformBusinessSetting.create({
      module,
      settingKey,
      value: serialized,
      valueType,
      description,
      category,
      isEditable,
      createdBy: adminEmail,
      updatedBy: adminEmail,
      createdAt: now(),
      updatedAt: now()
    } as any);
  }

  valueCache.set(definitionKey(module, settingKey), {
    parsed: newValue,
    expiresAt: Date.now() + BUSINESS_SETTINGS_CACHE_TTL_MS
  });

  await recordConfigChange({
    action: "BUSINESS_SETTING_UPSERT",
    auditModule: "business_settings",
    settingModule: module,
    setting: settingKey,
    oldValue,
    newValue,
    changedBy: adminEmail,
    meta: { valueType, category, description }
  });

  refreshSubscriptionCatalogIfNeeded(module);

  return rowToEffective(row);
}

export async function resetSettingToDefault(
  adminEmail: string | null,
  module: string,
  key: string
): Promise<EffectiveBusinessSetting> {
  const def = BUSINESS_SETTING_DEFINITION_MAP.get(definitionKey(module, key));
  if (!def) {
    const err: any = new Error(`No constant default for ${module}.${key}`);
    err.status = 404;
    throw err;
  }

  const row = await PlatformBusinessSetting.findOne({
    where: { module, settingKey: key }
  });
  const oldValue = row ? parseStoredValue(row.value, row.valueType) : parseDefault(def);

  if (row) {
    await row.destroy();
  }

  const newValue = parseDefault(def);
  valueCache.set(definitionKey(module, key), {
    parsed: newValue,
    expiresAt: Date.now() + BUSINESS_SETTINGS_CACHE_TTL_MS
  });

  await recordConfigChange({
    action: "BUSINESS_SETTING_RESET",
    auditModule: "business_settings",
    settingModule: module,
    setting: key,
    oldValue,
    newValue,
    changedBy: adminEmail,
    meta: { source: "constant", valueType: def.valueType }
  });

  refreshSubscriptionCatalogIfNeeded(module);

  return defToEffective(def);
}

export function listKnownModules(): string[] {
  const fromDefs = new Set<string>(BUSINESS_SETTING_MODULES);
  for (const d of BUSINESS_SETTING_DEFINITIONS) fromDefs.add(d.module);
  return Array.from(fromDefs).sort();
}

/** Drop cache (tests / ops). */
export function clearBusinessSettingsCache(): void {
  invalidateCache();
}

export async function getSettingsByModule(
  module: BusinessSettingModule | string
): Promise<Record<string, unknown>> {
  await ensureModuleWarmed(module);
  const out: Record<string, unknown> = {};
  for (const def of BUSINESS_SETTING_DEFINITIONS) {
    if (def.module !== module) continue;
    out[def.key] = await getSettingValue(module, def.key);
  }
  return out;
}
