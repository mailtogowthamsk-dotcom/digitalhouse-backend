import { Kulam } from "../models";
import { masterDataService } from "./MasterData.service";

/**
 * Validate Kulam against MDM (preferred) or legacy kulams table.
 * Returns the canonical display name. Empty / unknown values are rejected.
 * If no master list is configured yet, accepts a non-empty trimmed string
 * (bootstrap / empty-catalog environments only).
 */
export async function assertValidKulam(raw: string | null | undefined): Promise<string> {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) {
    throw Object.assign(new Error("Please select your Kulam."), { status: 400 });
  }

  try {
    const items = await masterDataService.listPublicItems({ typeCode: "KULAM" });
    if (items.length > 0) {
      const hit = items.find((i) => i.label.trim().toLowerCase() === trimmed.toLowerCase());
      if (!hit) {
        throw Object.assign(new Error("Please select a valid Kulam."), { status: 400 });
      }
      return hit.label.trim();
    }
  } catch (e: unknown) {
    if (e && typeof e === "object" && (e as { status?: number }).status === 400) throw e;
    /* fall through to legacy */
  }

  const rows = await Kulam.findAll({ attributes: ["id", "name"] });
  if (rows.length > 0) {
    const hit = rows.find((r) => r.name.trim().toLowerCase() === trimmed.toLowerCase());
    if (!hit) {
      throw Object.assign(new Error("Please select a valid Kulam."), { status: 400 });
    }
    return hit.name.trim();
  }

  // No catalog configured — require a real name but skip membership check.
  if (trimmed.length > 80) {
    throw Object.assign(new Error("Please select a valid Kulam."), { status: 400 });
  }
  return trimmed;
}
