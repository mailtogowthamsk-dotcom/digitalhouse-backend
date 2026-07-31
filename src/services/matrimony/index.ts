/** Re-export for existing importers; implementation lives in MatrimonyCompletion.service. */
export { computeMatrimonyCompletion } from "../MatrimonyCompletion.service";

export type { MatrimonyHubStatus, MatrimonyHubResponse } from "./matrimony.types";

export {
  signMatrimonySection,
  queueMatrimonyReReviewIfNeeded
} from "./matrimony.persistence.service";

export {
  getMatrimonyHub,
  resolveMatrimonyCanBrowse,
  assertMatrimonyBrowseAllowed,
  matrimonyBrowseBlockedMessage
} from "./matrimony.hub.service";

export {
  saveMatrimonyDraft,
  submitMatrimonyProfile,
  onUserProfilePhotoUpdated
} from "./matrimony.application.service";

export {
  pauseMatrimonyProfile,
  resumeMatrimonyProfile,
  closeMatrimonyProfile,
  reactivateMatrimonyProfile,
  withdrawMatrimonyProfile
} from "./matrimony.lifecycle.service";
