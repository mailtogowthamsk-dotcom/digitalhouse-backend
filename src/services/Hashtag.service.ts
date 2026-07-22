import { Op, literal } from "sequelize";
import { Hashtag, PostHashtag } from "../models";
import { mergeHashtags, extractHashtagsFromText, normalizeHashtagList } from "../utils/hashtagParser";

/**
 * Resolve hashtags for a post from description/title + optional explicit list,
 * then sync post_hashtags and usageCount.
 */
export async function syncPostHashtags(params: {
  postId: number;
  title?: string | null;
  description?: string | null;
  explicitHashtags?: string[] | null;
}): Promise<string[]> {
  const tags = mergeHashtags(
    extractHashtagsFromText(params.title),
    extractHashtagsFromText(params.description),
    normalizeHashtagList(params.explicitHashtags ?? [])
  );

  const existing = await PostHashtag.findAll({
    where: { postId: params.postId },
    attributes: ["id", "hashtagId"]
  });
  const existingHashtagIds = existing.map((r) => r.hashtagId);

  if (existingHashtagIds.length > 0) {
    await PostHashtag.destroy({ where: { postId: params.postId } });
    await Hashtag.update(
      { usageCount: literal("GREATEST(CAST(usageCount AS SIGNED) - 1, 0)") as any },
      { where: { id: { [Op.in]: existingHashtagIds } } }
    );
  }

  if (tags.length === 0) return [];

  const hashtagIds: number[] = [];
  for (const tag of tags) {
    const [row] = await Hashtag.findOrCreate({
      where: { tag },
      defaults: { tag, usageCount: 0 } as any
    });
    hashtagIds.push(row.id);
  }

  await PostHashtag.bulkCreate(
    hashtagIds.map((hashtagId) => ({
      postId: params.postId,
      hashtagId
    })) as any,
    { ignoreDuplicates: true }
  );

  await Hashtag.update(
    { usageCount: literal("usageCount + 1") as any },
    { where: { id: { [Op.in]: hashtagIds } } }
  );

  return tags;
}

export async function getTagsForPost(postId: number): Promise<string[]> {
  const rows = await PostHashtag.findAll({
    where: { postId },
    include: [{ model: Hashtag, attributes: ["tag"], required: true }],
    order: [["id", "ASC"]]
  });
  return rows.map((r) => ((r as any).Hashtag as Hashtag).tag).filter(Boolean);
}

/** Future-ready: top hashtags by usage. */
export async function getTrendingHashtags(limit = 12): Promise<Array<{ tag: string; usageCount: number }>> {
  const rows = await Hashtag.findAll({
    where: { usageCount: { [Op.gt]: 0 } },
    order: [
      ["usageCount", "DESC"],
      ["tag", "ASC"]
    ],
    limit: Math.min(Math.max(limit, 1), 30),
    attributes: ["tag", "usageCount"]
  });
  return rows.map((r) => ({ tag: r.tag, usageCount: r.usageCount }));
}

export async function findPostIdsByTagTokens(tokens: string[]): Promise<Map<string, number[]>> {
  const map = new Map<string, number[]>();
  if (tokens.length === 0) return map;

  const tags = await Hashtag.findAll({
    where: {
      [Op.or]: tokens.map((t) => ({ tag: { [Op.like]: `${t}%` } }))
    },
    attributes: ["id", "tag"]
  });
  if (tags.length === 0) return map;

  const tagIds = tags.map((t) => t.id);
  const links = await PostHashtag.findAll({
    where: { hashtagId: { [Op.in]: tagIds } },
    attributes: ["postId", "hashtagId"]
  });

  const tagById = new Map(tags.map((t) => [t.id, t.tag]));
  for (const token of tokens) {
    const matchingTagIds = new Set(
      tags.filter((t) => t.tag === token || t.tag.startsWith(token)).map((t) => t.id)
    );
    const postIds = [
      ...new Set(
        links.filter((l) => matchingTagIds.has(l.hashtagId)).map((l) => l.postId)
      )
    ];
    map.set(token, postIds);
  }

  return map;
}

export const hashtagService = {
  syncPostHashtags,
  getTagsForPost,
  getTrendingHashtags,
  findPostIdsByTagTokens
};
