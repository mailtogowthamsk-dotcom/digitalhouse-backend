import { describe, expect, it } from "vitest";
import {
  displayRegistrationStatus,
  reassignmentMailCopy,
  registrationNotifyKey,
  sanitizeSupportNote
} from "../../../src/services/registrationDesk/registrationDesk.logic";

describe("registration desk status", () => {
  it("keeps approval status ahead of assignment", () => {
    expect(
      displayRegistrationStatus({
        userStatus: "APPROVED",
        workflowStatus: "IN_PROGRESS",
        assignedMemberId: 4
      })
    ).toBe("APPROVED");
    expect(
      displayRegistrationStatus({
        userStatus: "REJECTED",
        workflowStatus: "ASSIGNED",
        assignedMemberId: 4
      })
    ).toBe("REJECTED");
  });

  it("shows assignment only while the user is still waiting", () => {
    expect(
      displayRegistrationStatus({
        userStatus: "PENDING",
        workflowStatus: "NEW",
        assignedMemberId: null
      })
    ).toBe("NEW");
    expect(
      displayRegistrationStatus({
        userStatus: "PENDING",
        workflowStatus: "ASSIGNED",
        assignedMemberId: 2
      })
    ).toBe("ASSIGNED");
    expect(
      displayRegistrationStatus({
        userStatus: "PENDING_REVIEW",
        workflowStatus: "IN_PROGRESS",
        assignedMemberId: 2
      })
    ).toBe("IN_PROGRESS");
    expect(
      displayRegistrationStatus({
        userStatus: "CHANGES_REQUESTED",
        workflowStatus: "ASSIGNED",
        assignedMemberId: 2
      })
    ).toBe("CHANGES_REQUESTED");
  });
});

describe("registration notification idempotency", () => {
  it("uses one key per request and recipient for the first email", () => {
    expect(registrationNotifyKey("REGISTRATION_RECEIVED", 11, " Team@Example.com ")).toBe(
      "REGISTRATION_RECEIVED:11:team@example.com"
    );
    expect(registrationNotifyKey("ASSIGNED", 11, "a@b.co", 9)).toBe("ASSIGNED:11:9:a@b.co");
    expect(registrationNotifyKey("REGISTRATION_RESUBMITTED", 11, "a@b.co", 1700000000000)).toBe(
      "REGISTRATION_RESUBMITTED:11:1700000000000:a@b.co"
    );
  });
});

describe("reassignment mail copy", () => {
  it("tells the new assignee the request is theirs", () => {
    expect(
      reassignmentMailCopy({ kind: "to_you", requestId: 9, toName: "Suresh Kumar" }).subject
    ).toBe("[DigitalHouse] Registration Request #9 reassigned to you");
  });

  it("tells the previous assignee who has it now", () => {
    expect(
      reassignmentMailCopy({ kind: "away", requestId: 9, toName: "Suresh Kumar" }).intro
    ).toContain("reassigned to Suresh Kumar");
  });

  it("tells other admins both names", () => {
    expect(
      reassignmentMailCopy({
        kind: "notice",
        requestId: 9,
        toName: "Suresh Kumar",
        fromName: "Gowtham"
      }).intro
    ).toBe("This registration request was reassigned from Gowtham to Suresh Kumar.");
  });
});

describe("support notes", () => {
  it("strips markup and keeps the text", () => {
    expect(sanitizeSupportNote("  hello <script>x</script>  ")).toBe("hello scriptx/script");
  });
});
