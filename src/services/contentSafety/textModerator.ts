import type { SafetyCategory } from "../../constants/contentSafety.constants";
import type { TextModerationResult } from "./types";

/**
 * Local caption/text check. Not multilingual-perfect and not a substitute for
 * image/video moderation. Fail closed: clearly prohibited → BLOCK, slang/ambiguous → REVIEW.
 */

const BLOCK_PATTERNS: Array<{ re: RegExp; category: SafetyCategory }> = [
  { re: /\b(child\s*porn|csam|cp\s*video|underage\s*sex|loli)\b/i, category: "OTHER_PROHIBITED" },
  { re: /\b(onlyfans|porn|porno|xxx|sex\s*tape|nude\s*pic|nudes?\b|boobs?\b|penis\b|vagina\b|blowjob|handjob|cumshot)\b/i, category: "SEXUAL_EXPLICIT" },
  { re: /\b(rape\s*video|beheading|gore\s*porn)\b/i, category: "EXTREME_VIOLENCE" }
];

const REVIEW_PATTERNS: Array<{ re: RegExp; category: SafetyCategory }> = [
  { re: /\b(sexy\s*pic|send\s*nudes|hot\s*pics?|undress|lingerie\s*show)\b/i, category: "SEXUALIZED_CONTENT" },
  { re: /\b(kill\s*you|i\s*will\s*murder|gore\b|bloodbath)\b/i, category: "GRAPHIC_VIOLENCE" }
];

export function moderateText(text: string | null | undefined): TextModerationResult {
  const body = (text ?? "").trim();
  if (!body) {
    return { verdict: "SAFE", category: "SAFE", reason: "EMPTY_TEXT" };
  }

  for (const rule of BLOCK_PATTERNS) {
    if (rule.re.test(body)) {
      return { verdict: "BLOCK", category: rule.category, reason: "TEXT_PROHIBITED" };
    }
  }
  for (const rule of REVIEW_PATTERNS) {
    if (rule.re.test(body)) {
      return { verdict: "REVIEW", category: rule.category, reason: "TEXT_AMBIGUOUS" };
    }
  }
  return { verdict: "SAFE", category: "SAFE", reason: "TEXT_PASS" };
}

export function isSevereSafetyReportReason(reason: string | null | undefined): boolean {
  const body = (reason ?? "").toLowerCase();
  if (!body) return false;
  return (
    /nudity|porn|sexual|child|minor|csam|gore|violence|kill|rape/.test(body)
  );
}
