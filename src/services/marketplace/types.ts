/** Grouped COUNT() rows come back raw, outside the model's attribute types. */
export type CountByPostRow = { postId: number; cnt: number };

export function asCountRows(rows: unknown): CountByPostRow[] {
  return (rows ?? []) as CountByPostRow[];
}

export type AdminMarketplaceListItem = {
  id: number;
  title: string;
  description: string | null;
  marketplaceStatus: string;
  marketplaceIntent: string | null;
  marketplaceCategory: string | null;
  marketplaceCondition: string | null;
  marketplacePrice: number | null;
  marketplaceNegotiable: boolean;
  marketplaceDistrict: string | null;
  marketplaceAdminNote: string | null;
  marketplaceExpiresAt: string | null;
  marketplaceGallery: string[];
  marketplaceFeatured: boolean;
  mediaUrl: string | null;
  pendingReportCount: number;
  totalReportCount: number;
  viewCount: number;
  favoriteCount: number;
  createdAt: string;
  updatedAt: string;
  author: {
    id: number;
    fullName: string;
    email: string;
    mobile: string | null;
  };
};

export type AdminMarketplaceListResult = {
  listings: AdminMarketplaceListItem[];
  total: number;
  page: number;
  limit: number;
  counts: {
    pending: number;
    changes: number;
    live: number;
    rejected: number;
    sold: number;
    hidden: number;
    expired: number;
    archived: number;
    reported: number;
    all: number;
  };
};

export type MarketplaceOverviewResult = {
  cards: {
    pending: number;
    live: number;
    rejected: number;
    changes: number;
    hidden: number;
    sold: number;
    expired: number;
    reported: number;
    todaysListings: number;
    featured: number;
    archived: number;
    expiringSoon: number;
  };
  topCategories: Array<{ category: string; count: number }>;
  topDistricts: Array<{ district: string; count: number }>;
  recentListings: Array<{
    id: number;
    title: string;
    category: string | null;
    status: string;
    createdAt: string;
  }>;
  featuredListings: Array<{
    id: number;
    title: string;
    category: string | null;
    featuredAt: string | null;
  }>;
  analytics: {
    createdLast7Days: number;
    createdLast30Days: number;
    approvedLast30Days: number;
    soldLast30Days: number;
    reportRatePercent: number;
    sellThroughPercent: number;
    mostViewed: Array<{ id: number; title: string; views: number }>;
    expiringSoon: Array<{ id: number; title: string; expiresAt: string }>;
  };
};

export type AdminMarketplaceDetailResult = {
  listing: AdminMarketplaceListItem & {
    moderationStatus: string;
    moderationReason: string | null;
    moderationNotes: string | null;
    moderatedBy: string | null;
    moderatedAt: string | null;
    deletedAt: string | null;
    marketplaceFeaturedAt: string | null;
  };
  seller: {
    id: number;
    fullName: string;
    email: string;
    mobile: string | null;
    community: string | null;
    district: string | null;
    status: string;
    profilePhoto: string | null;
    liveListingCount: number;
    totalListingCount: number;
  };
  stats: {
    views: number;
    favorites: number;
    pendingReports: number;
    totalReports: number;
  };
  reports: Array<{
    id: number;
    reporterId: number;
    reporterName: string | null;
    reason: string;
    status: string;
    adminRemarks: string | null;
    reviewedBy: string | null;
    reviewedAt: string | null;
    createdAt: string;
  }>;
  sellerListings: Array<{
    id: number;
    title: string;
    marketplaceStatus: string;
    marketplacePrice: number | null;
    createdAt: string;
  }>;
  timeline: Array<{
    id: string;
    action: string;
    actor: string;
    note: string | null;
    createdAt: string;
  }>;
};

export const STATUS_FILTER_MAP = {
  pending: "PENDING_REVIEW",
  changes: "CHANGES_REQUESTED",
  live: "LIVE",
  rejected: "REJECTED",
  sold: "SOLD",
  hidden: "HIDDEN",
  expired: "EXPIRED",
  archived: "ARCHIVED"
} as const;

export type MarketplaceAdminStatusFilter =
  | keyof typeof STATUS_FILTER_MAP
  | "reported"
  | "all";
