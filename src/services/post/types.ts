import type { PostType, JobStatus, JobEmploymentType, JobWorkMode } from "../../models";
import type {
  MarketplaceStatus,
  MarketplaceIntent,
  MarketplaceCondition
} from "../../constants/marketplace.constants";
import type { HelpStatus, HelpUrgency } from "../../constants/helpingHands.constants";
import type { PostMediaType } from "../../constants/postMedia.constants";
import type { PostVisibility } from "../../constants/postVisibility.constants";

export type PostAuthorDto = {
  id: number;
  name: string;
  profile_image: string | null;
  verified: boolean;
};

export type PostDetailDto = {
  id: number;
  user_id: number;
  post_type: string;
  title: string;
  description: string | null;
  media_url: string | null;
  media_type: PostMediaType;
  thumbnail_url: string | null;
  video_duration: number | null;
  mime_type: string | null;
  file_size: number | null;
  pinned: boolean;
  urgent: boolean;
  meetup_at: string | null;
  job_status: string | null;
  job_company: string | null;
  job_category?: string | null;
  job_location: string | null;
  /** Recruitment contact — JOB detail only; never on feed. */
  job_contact_phone?: string | null;
  job_employment_type: string | null;
  job_work_mode?: string | null;
  job_experience?: string | null;
  job_skills?: string[];
  job_salary_min: number | null;
  job_salary_max: number | null;
  job_vacancies?: number | null;
  job_application_deadline?: string | null;
  marketplace_status: string | null;
  marketplace_intent: string | null;
  marketplace_category: string | null;
  marketplace_condition: string | null;
  marketplace_price: number | null;
  marketplace_negotiable: boolean;
  marketplace_district: string | null;
  marketplace_admin_note: string | null;
  marketplace_expires_at: string | null;
  marketplace_gallery: string[];
  marketplace_featured: boolean;
  help_status: string | null;
  help_category: string | null;
  help_urgency: string | null;
  help_location: string | null;
  help_contact_phone: string | null;
  help_gallery: string[];
  help_expires_at?: string | null;
  help_extended_count?: number;
  help_resolved_at?: string | null;
  help_helper_count?: number;
  help_offered_by_me?: boolean;
  visibility: PostVisibility;
  visibility_label: string;
  created_at: string;
  updated_at: string;
  author: PostAuthorDto;
  like_count: number;
  comment_count: number;
  liked_by_me: boolean;
  saved_by_me: boolean;
  safety_decision?: string;
  safety_category?: string | null;
  job_interested_by_me?: boolean;
  job_interest_count?: number;
  job_can_message_poster?: boolean;
  /** Present when this row is a community repost. */
  is_repost?: boolean;
  original_post_id?: number | null;
  original_author?: PostAuthorDto | null;
};

export type CommentDto = {
  id: number;
  post_id: number;
  user_id: number;
  parent_id: number | null;
  body: string;
  created_at: string;
  updated_at: string;
  author: PostAuthorDto;
  is_mine: boolean;
  reply_count: number;
  replies?: CommentDto[];
};

export type CommentsResultDto = {
  items: CommentDto[];
  page: number;
  limit: number;
  total: number;
};

/** Public liker profile for likes lists (posts / reels / comments later). */
export type PostLikerDto = {
  userId: number;
  fullName: string;
  username: string | null;
  profilePhoto: string | null;
  isVerified: boolean;
  likedAt: string;
  isCurrentUser: boolean;
};

export type PostLikesResultDto = {
  items: PostLikerDto[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

export type CreatePostPayload = {
  post_type: PostType;
  title: string;
  description?: string | null;
  media_url?: string | null;
  media_type?: PostMediaType | null;
  thumbnail_url?: string | null;
  video_duration?: number | null;
  mime_type?: string | null;
  file_size?: number | null;
  pinned?: boolean;
  urgent?: boolean;
  meetup_at?: string | null;
  job_status?: JobStatus | null;
  job_company?: string | null;
  job_category?: string | null;
  job_location?: string | null;
  job_contact_phone?: string | null;
  job_employment_type?: JobEmploymentType | null;
  job_work_mode?: JobWorkMode | null;
  job_experience?: string | null;
  job_skills?: string[];
  job_salary_min?: number | null;
  job_salary_max?: number | null;
  job_vacancies?: number | null;
  job_application_deadline?: string | null;
  marketplace_status?: MarketplaceStatus | null;
  marketplace_intent?: MarketplaceIntent | null;
  marketplace_category?: string | null;
  marketplace_condition?: MarketplaceCondition | null;
  marketplace_price?: number | null;
  marketplace_negotiable?: boolean;
  marketplace_district?: string | null;
  marketplace_gallery?: string[];
  help_status?: HelpStatus | null;
  help_category?: string | null;
  help_urgency?: HelpUrgency | null;
  help_location?: string | null;
  help_contact_phone?: string | null;
  help_gallery?: string[];
  /** Optional explicit hashtags (also parsed from title/description). */
  hashtags?: string[];
  /** PUBLIC = Community; CONNECTIONS = Connections Only */
  visibility?: PostVisibility;
};

export type UpdatePostPayload = Partial<Omit<CreatePostPayload, "post_type">>;
