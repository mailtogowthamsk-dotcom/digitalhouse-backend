import { Location, Kulam } from "../models";

const DEFAULT_LOCATIONS = [
  "Chennai",
  "Coimbatore",
  "Madurai",
  "Trichy",
  "Salem",
  "Tirunelveli",
  "Erode",
  "Other"
];

const DEFAULT_KULAMS = [
  "Semba Vattuar",
  "Karaiya Vettuvar",
  "Paandi Vettuvar",
  "Other"
];

/** Seed locations and kulams if tables are empty (run after sync). */
export async function seedOptionsIfEmpty(): Promise<void> {
  const locationCount = await Location.count();
  if (locationCount === 0) {
    const now = new Date();
    await Location.bulkCreate(
      DEFAULT_LOCATIONS.map((name, i) => ({
        name,
        sortOrder: i + 1,
        createdAt: now,
        updatedAt: now
      })) as any
    );
    console.log("Seeded", DEFAULT_LOCATIONS.length, "locations.");
  }

  const kulamCount = await Kulam.count();
  if (kulamCount === 0) {
    const now = new Date();
    await Kulam.bulkCreate(
      DEFAULT_KULAMS.map((name, i) => ({
        name,
        sortOrder: i + 1,
        createdAt: now,
        updatedAt: now
      })) as any
    );
    console.log("Seeded", DEFAULT_KULAMS.length, "kulams.");
  }
}
