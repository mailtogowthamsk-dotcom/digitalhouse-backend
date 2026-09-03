/** Jobs / Marketplace / Helping Hands / saved / mine / popular stay chronological. */
export function isPersonalizedHomeRequest(params: {
  mine?: boolean;
  saved?: boolean;
  postType?: string;
  q?: string;
  sort?: string;
}): boolean {
  if (params.mine || params.saved) return false;
  if (params.postType) return false;
  if (params.q?.trim()) return false;
  if (params.sort === "popular") return false;
  return true;
}
