/**
 * Orphan tmp_* cleanup — filesystem only (no DB).
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupOrphanStoryUploads,
  LOCAL_STORY_KEY_PREFIX,
  STORY_UPLOAD_TMP_PREFIX
} from "../../src/services/StoryLocalStorage.service";

describe("cleanupOrphanStoryUploads", () => {
  let root: string;
  let prevDir: string | undefined;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "dh-stories-orphan-"));
    prevDir = process.env.STORIES_STORAGE_DIR;
    process.env.STORIES_STORAGE_DIR = root;
  });

  afterEach(() => {
    if (prevDir === undefined) delete process.env.STORIES_STORAGE_DIR;
    else process.env.STORIES_STORAGE_DIR = prevDir;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("deletes old tmp files and preserves referenced + fresh + promoted files", async () => {
    const userDir = path.join(root, "9", "2026", "09");
    fs.mkdirSync(userDir, { recursive: true });
    const oldTmp = path.join(userDir, `${STORY_UPLOAD_TMP_PREFIX}old.mp4`);
    const freshTmp = path.join(userDir, `${STORY_UPLOAD_TMP_PREFIX}fresh.mp4`);
    const promoted = path.join(userDir, "kept.mp4");
    const referencedTmp = path.join(userDir, `${STORY_UPLOAD_TMP_PREFIX}ref.mp4`);
    fs.writeFileSync(oldTmp, "x");
    fs.writeFileSync(freshTmp, "y");
    fs.writeFileSync(promoted, "z");
    fs.writeFileSync(referencedTmp, "r");

    const oldTime = Date.now() - 48 * 60 * 60 * 1000;
    fs.utimesSync(oldTmp, new Date(oldTime), new Date(oldTime));
    fs.utimesSync(referencedTmp, new Date(oldTime), new Date(oldTime));

    const refKey = `${LOCAL_STORY_KEY_PREFIX}9/2026/09/${STORY_UPLOAD_TMP_PREFIX}ref.mp4`;
    const result = await cleanupOrphanStoryUploads({
      referencedKeys: new Set([refKey]),
      maxAgeHours: 24
    });

    expect(result.scanned).toBeGreaterThanOrEqual(2);
    expect(result.deleted).toBe(1);
    expect(fs.existsSync(oldTmp)).toBe(false);
    expect(fs.existsSync(freshTmp)).toBe(true);
    expect(fs.existsSync(promoted)).toBe(true);
    expect(fs.existsSync(referencedTmp)).toBe(true);
  });
});
