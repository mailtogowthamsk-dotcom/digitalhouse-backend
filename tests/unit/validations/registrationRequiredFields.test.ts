import { describe, expect, it } from "vitest";
import { completeGoogleProfileSchema, registerSchema } from "../../../src/validations/auth.validation";

const manual = {
  fullName: "Test User",
  username: "testuser",
  email: "test@example.com",
  mobile: "9876543210",
  fatherName: "Rajan",
  address: "12 Main Street",
  location: "Coimbatore",
  kulam: "Kongu"
};

const google = {
  username: "testuser",
  gender: "Male",
  dob: "1995-01-01",
  district: "Coimbatore",
  kulam: "Kongu",
  mobile: "+91 98765 43210",
  fatherName: "Rajan",
  address: "12 Main Street"
};

describe("registration required fields", () => {
  it("accepts manual registration when mobile, father name, and address are present", () => {
    const parsed = registerSchema.parse(manual);
    expect(parsed.mobile).toBe("9876543210");
    expect(parsed.fatherName).toBe("Rajan");
    expect(parsed.address).toBe("12 Main Street");
  });

  it("rejects manual registration when father name or address is missing", () => {
    expect(registerSchema.safeParse({ ...manual, fatherName: "  " }).success).toBe(false);
    expect(registerSchema.safeParse({ ...manual, address: null }).success).toBe(false);
    expect(registerSchema.safeParse({ ...manual, mobile: "" }).success).toBe(false);
  });

  it("accepts Google completion and stores a 10-digit mobile", () => {
    const parsed = completeGoogleProfileSchema.parse(google);
    expect(parsed.mobile).toBe("9876543210");
    expect(parsed.fatherName).toBe("Rajan");
    expect(parsed.address).toBe("12 Main Street");
  });

  it("rejects Google completion when father name or address is missing", () => {
    expect(completeGoogleProfileSchema.safeParse({ ...google, fatherName: "" }).success).toBe(false);
    expect(completeGoogleProfileSchema.safeParse({ ...google, address: null }).success).toBe(false);
    expect(completeGoogleProfileSchema.safeParse({ ...google, mobile: "12345" }).success).toBe(false);
  });
});
