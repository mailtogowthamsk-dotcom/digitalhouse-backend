import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockResponse, createMockUser } from "../helpers/http";

const { createPost, getPost } = vi.hoisted(() => ({
  createPost: vi.fn(),
  getPost: vi.fn()
}));

vi.mock("../../src/services/Post.service", () => ({
  postService: {
    createPost,
    getPost,
    updatePost: vi.fn(),
    deletePost: vi.fn(),
    likePost: vi.fn(),
    addComment: vi.fn(),
    getComments: vi.fn(),
    getPostLikes: vi.fn(),
    updateComment: vi.fn(),
    deleteComment: vi.fn(),
    savePost: vi.fn(),
    unsavePost: vi.fn(),
    reportPost: vi.fn(),
    trackFeedEvent: vi.fn(),
    getApprovedUserIdsInCommunity: vi.fn()
  }
}));

import { createPost as createPostController, getPost as getPostController } from "../../src/controllers/Post.controller";

describe("Post.controller", () => {
  beforeEach(() => {
    createPost.mockReset();
    getPost.mockReset();
  });

  it("returns 401 when createPost is called without an authenticated user", async () => {
    const res = createMockResponse();
    await createPostController({ body: {} } as any, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.body).toMatchObject({ ok: false, message: "Unauthorized" });
    expect(createPost).not.toHaveBeenCalled();
  });

  it("delegates to postService.createPost and returns 201", async () => {
    const user = createMockUser({ id: 11 });
    const dto = { id: 99, title: "Hello", post_type: "ANNOUNCEMENT" };
    createPost.mockResolvedValueOnce(dto);

    const res = createMockResponse();
    await createPostController(
      {
        user,
        body: {
          post_type: "ANNOUNCEMENT",
          title: "Hello",
          description: "World"
        }
      } as any,
      res
    );

    expect(createPost).toHaveBeenCalledWith(
      11,
      expect.objectContaining({
        post_type: "ANNOUNCEMENT",
        title: "Hello",
        description: "World"
      })
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.body).toMatchObject({ ok: true, id: 99, title: "Hello" });
  });

  it("maps service 400 errors to HTTP 400", async () => {
    createPost.mockRejectedValueOnce(
      Object.assign(new Error("You already have 3 active job postings."), {
        status: 400,
        code: "JOB_ACTIVE_LIMIT"
      })
    );

    const res = createMockResponse();
    await createPostController(
      {
        user: createMockUser(),
        body: {
          post_type: "ANNOUNCEMENT",
          title: "Another post",
          description: "ok"
        }
      } as any,
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.body).toMatchObject({
      ok: false,
      message: "You already have 3 active job postings."
    });
  });

  it("returns 400 for invalid postId on getPost", async () => {
    const res = createMockResponse();
    await getPostController(
      { user: createMockUser(), params: { postId: "abc" } } as any,
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(getPost).not.toHaveBeenCalled();
  });
});
