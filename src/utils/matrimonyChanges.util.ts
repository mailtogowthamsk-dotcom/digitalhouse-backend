import { MATRIMONY_CHANGE_SECTIONS, type MatrimonyChangeSectionKey } from "../constants/matrimony-changes.constants";

export type FieldChange = {
  field: string;
  oldValue: unknown;
  newValue: unknown;
};

export function stableStringify(value: unknown): string {
  if (value === undefined) return "";
  if (value === null) return "null";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function computeFieldChanges(
  previous: Record<string, unknown> | null,
  current: Record<string, unknown>
): FieldChange[] {
  if (!previous) return [];
  const keys = new Set([...Object.keys(previous), ...Object.keys(current)]);
  const changes: FieldChange[] = [];
  for (const field of keys) {
    if (field.startsWith("_")) continue;
    const oldValue = previous[field];
    const newValue = current[field];
    if (stableStringify(oldValue) !== stableStringify(newValue)) {
      changes.push({ field, oldValue, newValue });
    }
  }
  return changes;
}

export function sectionKeysFromChangedFields(changedFields: string[]): string[] {
  const keys = new Set<string>();
  for (const [sectionKey, def] of Object.entries(MATRIMONY_CHANGE_SECTIONS)) {
    if (def.fields.some((f) => changedFields.includes(f))) {
      keys.add(sectionKey);
    }
  }
  return [...keys];
}

export function fieldBelongsToRequestedSection(
  field: string,
  requestedSections: string[]
): boolean {
  for (const sk of requestedSections) {
    const def = MATRIMONY_CHANGE_SECTIONS[sk as MatrimonyChangeSectionKey];
    if (def && (def.fields as readonly string[]).includes(field)) return true;
  }
  return false;
}
