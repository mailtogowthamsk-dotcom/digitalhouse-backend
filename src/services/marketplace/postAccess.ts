import { Post } from "../../models";

export async function findMarketplacePost(postId: number): Promise<Post> {
  const post = await Post.findByPk(postId, {
    include: [
      {
        association: "User",
        attributes: ["id", "fullName", "email", "mobile", "community", "district", "status", "profilePhoto"],
        required: true
      }
    ]
  });
  if (!post || post.postType !== "MARKETPLACE") {
    throw Object.assign(new Error("Marketplace listing not found"), { status: 404 });
  }
  return post;
}
