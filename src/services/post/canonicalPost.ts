import { Post } from "../../models";
import { resolveOriginalPostId } from "./originalPostId";
export { resolveOriginalPostId } from "./originalPostId";

/**
 * Instagram-style: likes/comments/saves belong to the original post,
 * never the wrapper row created for feed distribution.
 */
export async function resolveCanonicalPost(post: Post): Promise<Post> {
  if (!post.originalPostId) return post;
  const root = await Post.findByPk(resolveOriginalPostId(post));
  if (!root) {
    const err = new Error("Original post not found");
    (err as any).status = 404;
    (err as any).code = "ORIGINAL_POST_NOT_FOUND";
    throw err;
  }
  return root;
}
