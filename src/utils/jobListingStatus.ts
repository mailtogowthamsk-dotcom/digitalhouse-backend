import type { Post } from "../models";

/** Derived listing status for UI — DB enum remains OPEN | CLOSED only. */
export type JobListingStatus = "OPEN" | "CLOSED" | "EXPIRED";

export function isJobDeadlinePassed(
  deadline: Date | string | null | undefined,
  now: Date = new Date()
): boolean {
  if (deadline == null) return false;
  const d = deadline instanceof Date ? deadline : new Date(deadline);
  if (Number.isNaN(d.getTime())) return false;
  return d.getTime() <= now.getTime();
}

export function deriveJobListingStatus(
  post: Pick<Post, "jobStatus" | "jobApplicationDeadline">,
  now: Date = new Date()
): JobListingStatus {
  if (post.jobStatus === "CLOSED") return "CLOSED";
  if (isJobDeadlinePassed(post.jobApplicationDeadline, now)) return "EXPIRED";
  return "OPEN";
}

export function isJobAcceptingApplications(
  post: Pick<Post, "jobStatus" | "jobApplicationDeadline">,
  now: Date = new Date()
): boolean {
  return deriveJobListingStatus(post, now) === "OPEN";
}
