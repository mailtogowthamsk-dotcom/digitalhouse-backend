/** Wrapper rows store originalPostId; originals are their own id. */
export function resolveOriginalPostId(post: { id: number; originalPostId?: number | null }): number {
  return post.originalPostId ?? post.id;
}
