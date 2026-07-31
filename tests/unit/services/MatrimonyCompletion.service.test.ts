import { describe, it, expect } from "vitest";
import { computeMatrimonyCompletion } from "../../../src/services/MatrimonyCompletion.service";
import { buildCompleteMatrimonySection } from "../../helpers/factories";
import { MATRIMONY_REQUIRED_KEYS } from "../../../src/constants/matrimony.constants";

describe("MatrimonyCompletion.service", () => {
  it("returns near-0% when both sections are empty (active flag is forced true)", () => {
    const { percentage, missing } = computeMatrimonyCompletion(null, null, null);
    // Implementation always merges matrimonyProfileActive: true for completion checks.
    expect(missing).not.toContain("matrimonyProfileActive");
    expect(missing).toContain("candidatePhotoUrl");
    expect(missing).toContain("aboutMe");
    expect(missing.length).toBe(MATRIMONY_REQUIRED_KEYS.length - 1);
    expect(percentage).toBe(
      Math.round((100 * 1) / MATRIMONY_REQUIRED_KEYS.length)
    );
  });

  it("merges draft over approved when computing completion", () => {
    const approved = buildCompleteMatrimonySection({ aboutMe: "old" });
    const draft = { aboutMe: "  " }; // blank aboutMe should count as missing
    const { missing } = computeMatrimonyCompletion(approved as any, draft as any, null);
    expect(missing).toContain("aboutMe");
  });

  it("reports 100% when all required fields are filled", () => {
    const section = buildCompleteMatrimonySection();
    const { percentage, missing } = computeMatrimonyCompletion(section as any, null, null);
    expect(missing).toEqual([]);
    expect(percentage).toBe(100);
  });

  it("allows SELF profiles to satisfy photo via account photo when flagged", () => {
    const section = buildCompleteMatrimonySection({
      lookingFor: "SELF",
      useAccountProfilePhoto: true,
      candidatePhotoUrl: null,
      profilePhotoUrl: null,
      candidatePhotos: undefined
    });
    const withAccount = computeMatrimonyCompletion(section as any, null, "users/1/avatar.jpg");
    expect(withAccount.missing).not.toContain("candidatePhotoUrl");

    const withoutAccount = computeMatrimonyCompletion(section as any, null, null);
    expect(withoutAccount.missing).toContain("candidatePhotoUrl");
  });

  it("limits missing fields to requestedFieldsOnly when provided", () => {
    const { missing, percentage } = computeMatrimonyCompletion(null, null, null, [
      "aboutMe",
      "height"
    ]);
    expect(missing.sort()).toEqual(["aboutMe", "height"].sort());
    expect(percentage).toBe(0);

    const partial = computeMatrimonyCompletion(
      { aboutMe: "hello", height: "5'8\"" } as any,
      null,
      null,
      ["aboutMe", "height"]
    );
    expect(partial.missing).toEqual([]);
    expect(partial.percentage).toBe(100);
  });
});
