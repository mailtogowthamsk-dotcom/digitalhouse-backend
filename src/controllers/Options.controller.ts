import { Request, Response } from "express";
import { Location, Kulam } from "../models";
import { success } from "../utils/response";

/** GET /api/options/locations — list all locations for registration dropdown */
export async function getLocations(_req: Request, res: Response) {
  const rows = await Location.findAll({
    order: [
      ["sortOrder", "ASC"],
      ["name", "ASC"]
    ],
    attributes: ["id", "name"]
  });
  return success(res, { locations: rows.map((r) => ({ id: r.id, name: r.name })) });
}

/** GET /api/options/kulams — list all kulams for registration dropdown */
export async function getKulams(_req: Request, res: Response) {
  const rows = await Kulam.findAll({
    order: [
      ["sortOrder", "ASC"],
      ["name", "ASC"]
    ],
    attributes: ["id", "name"]
  });
  return success(res, { kulams: rows.map((r) => ({ id: r.id, name: r.name })) });
}
