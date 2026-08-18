import fs from "fs";
import os from "os";
import path from "path";

export const MEDIA_TEMP_PREFIXES = ["dh-vid-", "dh-thumb-", "dh-probe-", "dh-mod-"] as const;

const activeDirectories = new Set<string>();
const ACTIVE_MARKER = ".active.json";

export async function createMediaTempDirectory(
  prefix: (typeof MEDIA_TEMP_PREFIXES)[number]
): Promise<string> {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    await fs.promises.writeFile(
      path.join(directory, ACTIVE_MARKER),
      JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }),
      { flag: "wx" }
    );
  } catch (error) {
    await fs.promises.rm(directory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  activeDirectories.add(directory);
  return directory;
}

export async function removeMediaTempDirectory(directory: string): Promise<void> {
  activeDirectories.delete(directory);
  await fs.promises.rm(directory, { recursive: true, force: true }).catch(() => undefined);
}

function processIsRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export async function isMediaTempDirectoryActive(directory: string): Promise<boolean> {
  if (activeDirectories.has(directory)) return true;
  try {
    const marker = JSON.parse(
      await fs.promises.readFile(path.join(directory, ACTIVE_MARKER), "utf8")
    ) as { pid?: unknown };
    return typeof marker.pid === "number" && processIsRunning(marker.pid);
  } catch {
    return false;
  }
}
