import type { Request, Response } from "express";
import { z } from "zod";
import { success, error } from "../utils/response";
import { masterDataService } from "../services/MasterData.service";
import { Location, Kulam } from "../models";
import { MDM_TYPE_CODES } from "../constants/masterData.constants";

/** GET /api/options/locations — legacy; prefers MDM DISTRICT, falls back to locations table */
export async function getLocations(_req: Request, res: Response) {
  try {
    const items = await masterDataService.listPublicItems({ typeCode: "DISTRICT" });
    if (items.length > 0) {
      return success(res, {
        locations: items.map((i) => ({ id: i.id, name: i.label })),
        source: "master_data"
      });
    }
  } catch {
    /* fall through */
  }
  const rows = await Location.findAll({
    order: [
      ["sortOrder", "ASC"],
      ["name", "ASC"]
    ],
    attributes: ["id", "name"]
  });
  return success(res, {
    locations: rows.map((r) => ({ id: r.id, name: r.name })),
    source: "legacy"
  });
}

/** GET /api/options/kulams — legacy; prefers MDM KULAM */
export async function getKulams(_req: Request, res: Response) {
  try {
    const items = await masterDataService.listPublicItems({ typeCode: "KULAM" });
    if (items.length > 0) {
      return success(res, {
        kulams: items.map((i) => ({ id: i.id, name: i.label })),
        source: "master_data"
      });
    }
  } catch {
    /* fall through */
  }
  const rows = await Kulam.findAll({
    order: [
      ["sortOrder", "ASC"],
      ["name", "ASC"]
    ],
    attributes: ["id", "name"]
  });
  return success(res, {
    kulams: rows.map((r) => ({ id: r.id, name: r.name })),
    source: "legacy"
  });
}

/** GET /api/options/types */
export async function getTypes(_req: Request, res: Response) {
  const types = await masterDataService.listTypes();
  return success(res, { types });
}

/** GET /api/options/bundle?types=DISTRICT,KULAM,BLOOD_GROUP */
export async function getBundle(req: Request, res: Response) {
  const raw = String(req.query.types || "");
  const codes = raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const bundle = await masterDataService.getPublicBundle(
    codes.length ? codes : ["DISTRICT", "KULAM", "EDUCATION", "OCCUPATION", "BLOOD_GROUP", "MARITAL_STATUS", "LANGUAGE", "MARKETPLACE_CATEGORY"]
  );
  return success(res, { bundle, cached_hint_seconds: 300 });
}

/** GET /api/options/:typeCode?parentId=&q= */
export async function getByType(req: Request, res: Response) {
  const typeCode = String(req.params.typeCode || "").toUpperCase();
  if (!MDM_TYPE_CODES.includes(typeCode as any)) {
    return error(res, "Unknown master data type", 404);
  }
  const parentIdRaw = req.query.parentId;
  const parentId =
    parentIdRaw === undefined || parentIdRaw === ""
      ? undefined
      : Number(parentIdRaw);
  if (parentId != null && Number.isNaN(parentId)) {
    return error(res, "Invalid parentId", 400);
  }
  const q = typeof req.query.q === "string" ? req.query.q : undefined;
  const items = await masterDataService.listPublicItems({
    typeCode,
    parentId: parentId ?? undefined,
    q
  });
  return success(res, { type: typeCode, items });
}
