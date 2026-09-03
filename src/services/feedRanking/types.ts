export type CandidateSource =
  | "connection"
  | "interest"
  | "fresh"
  | "discovery"
  | "exploration"
  | "fallback";

export type FeedCandidate = {
  postId: number;
  authorId: number;
  createdAt: Date;
  likeCount: number;
  commentCount: number;
  postType: string;
  sources: CandidateSource[];
};

export type ScoredCandidate = FeedCandidate & {
  interest: number;
  connection: number;
  freshness: number;
  engagement: number;
  quality: number;
  interestContribution: number;
  connectionContribution: number;
  freshnessContribution: number;
  engagementContribution: number;
  qualityContribution: number;
  exposurePenalty: number;
  diversityPenalty: number;
  stage1Score: number;
  finalScore: number;
};

export type ExposureRow = {
  postId: number;
  impressionCount: number;
  lastSeenAt: Date;
};

export type ViewerAffinity = {
  connectionIds: Set<number>;
  hashtagIds: Set<number>;
  likeCount: number;
  commentCount: number;
  connectionCount: number;
};

export type FeedSessionContext = {
  rankingVersion: number;
  sessionId: string;
  seed: number;
};

export type DecodedFeedCursor = FeedSessionContext & {
  score: number;
  tieBreaker: number;
  postId: number;
  phase: "ranked" | "tail";
};

export type PersonalizedFeedMetrics = {
  mode: "personalized" | "chronological" | "fallback";
  ms: number;
  queryCount: number;
  candidateCount: number;
  eligibleCount: number;
  stage1Count: number;
  stage2Count: number;
  resultCount: number;
  fallback?: string;
};
