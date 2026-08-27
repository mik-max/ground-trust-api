import type Anthropic from "@anthropic-ai/sdk";
import prisma from "../config/prisma";
import { getAnthropicClient } from "../config/anthropic";
import { transcribeAudio } from "./stt.service";
import { moderateText } from "./moderation.service";
import { recomputeReviewAspects } from "./scoring.service";
import { Aspect, Prisma } from "../generated/prisma";
import { ASPECTS } from "../config/constants";
const SENTIMENTS = ["positive", "neutral", "negative"] as const;
type Sentiment = (typeof SENTIMENTS)[number];

export interface NlpAspectResult {
  aspect: Aspect;
  sentiment: Sentiment;
  confidence: number;
}

interface NlpResponseShape {
  detectedLanguage?: unknown;
  translatedText?: unknown;
  aspects?: unknown;
}

const SYSTEM_PROMPT = `You are a text-processing step in a resident-review platform for Nigerian neighbourhoods. Given one resident's free-text comment about their local area, do all of the following:

1. Detect the language it's written in.
2. Translate it to natural English. If it is already in English, return it unchanged — do not paraphrase or "clean up" English text.
3. Identify which of these five fixed categories the comment discusses — a comment may discuss zero, one, or several: power, water, security, roads_flooding, accessibility. Do not invent categories outside this list.
4. For each category the comment actually discusses, classify the sentiment expressed toward it as positive, neutral, or negative, and give a confidence score from 0 to 1.

Respond with ONLY a JSON object, no other text, in exactly this shape:
{"detectedLanguage": "<language name>", "translatedText": "<English text>", "aspects": [{"aspect": "power", "sentiment": "negative", "confidence": 0.9}]}

If the comment doesn't clearly discuss any of the five categories, return an empty aspects array. Never assert the area's character as fact — you are only labeling what the reviewer said, not judging the area.`;

function parseResponse(raw: string): { detectedLanguage: string; translatedText: string; aspects: NlpAspectResult[] } | null {
  const jsonText = raw.trim().replace(/^```(?:json)?\n?/, "").replace(/```$/, "");
  let parsed: NlpResponseShape;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }

  if (typeof parsed.translatedText !== "string" || typeof parsed.detectedLanguage !== "string") {
    return null;
  }
  if (!Array.isArray(parsed.aspects)) {
    return null;
  }

  const aspects: NlpAspectResult[] = [];
  for (const item of parsed.aspects) {
    if (typeof item !== "object" || item === null) continue;
    const { aspect, sentiment, confidence } = item as Record<string, unknown>;
    if (typeof aspect !== "string" || !ASPECTS.includes(aspect as Aspect)) continue;
    if (typeof sentiment !== "string" || !SENTIMENTS.includes(sentiment as Sentiment)) continue;
    if (typeof confidence !== "number" || Number.isNaN(confidence)) continue;
    aspects.push({
      aspect: aspect as Aspect,
      sentiment: sentiment as Sentiment,
      confidence: Math.max(0, Math.min(1, confidence)),
    });
  }

  return { detectedLanguage: parsed.detectedLanguage, translatedText: parsed.translatedText, aspects };
}

// files/HANDOFF.md §3 — full pipeline: transcribe (if voice, per §3's
// speech-to-text step), moderate, then translate + classify. Moderation
// (files/ADDENDUM.md §3) is deliberately its own independent phase below,
// not nested inside the Claude translate/classify call: a review's public
// eligibility can't depend on an unrelated, optional pipeline step (ADDENDUM
// says to check the *translated* text, but if ANTHROPIC_API_KEY is unset —
// same "missing key = skip" pattern used everywhere else in this project —
// translation never runs, and gating moderation on its result would strand
// every text review in "pending" forever, with no key at fault for that at
// all). So moderation checks the original text and resolves independently
// of whether translation/classification ever succeeds.
export async function processReview(reviewId: string): Promise<void> {
  let review = await prisma.review.findUnique({ where: { id: reviewId } });
  if (!review) {
    return;
  }

  if (!review.originalText && review.originalAudioRef) {
    const transcript = await transcribeAudio(review.originalAudioRef);
    if (transcript) {
      review = await prisma.review.update({
        where: { id: reviewId },
        data: { originalText: transcript },
      });
    }
  }

  if (!review.originalText) {
    return;
  }
  const originalText = review.originalText;

  // Phase 1: moderation. Runs when moderationStatus is "pending" (the
  // normal case — set at creation for text reviews), or for a voice review
  // that's still at its default "approved" with nothing checked yet
  // (nlpAspects === null pins this to "never fully processed" — without it,
  // an admin manually re-triggering POST /internal/nlp/process on an
  // already-processed, already-human-approved voice review would look
  // identical to "first check" and could silently re-flag it).
  const voiceReviewNeedsFirstCheck =
    review.originalAudioRef && review.moderationStatus === "approved" && review.nlpAspects === null;
  if (review.moderationStatus === "pending" || voiceReviewNeedsFirstCheck) {
    const decision = await moderateText(originalText);
    if (decision !== review.moderationStatus) {
      review = await prisma.review.update({ where: { id: reviewId }, data: { moderationStatus: decision } });
      await recomputeReviewAspects(review);
    }
  }

  // Phase 2: translate + classify. Independent of phase 1's outcome —
  // nlpAspects is a secondary signal (files/HANDOFF.md §2.2) whether or not
  // the review is publicly visible yet.
  if (review.nlpAspects !== null) {
    return;
  }

  const client = getAnthropicClient();
  if (!client) {
    console.warn(`[nlp] Skipping review ${reviewId} — ANTHROPIC_API_KEY is not set.`);
    return;
  }

  try {
    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: originalText }],
    });

    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    if (!textBlock) {
      console.error(`[nlp] No text block in Claude response for review ${reviewId}`);
      return;
    }

    const result = parseResponse(textBlock.text);
    if (!result) {
      console.error(`[nlp] Couldn't parse Claude response for review ${reviewId}: ${textBlock.text.slice(0, 200)}`);
      return;
    }

    await prisma.review.update({
      where: { id: reviewId },
      data: {
        translatedText: result.translatedText,
        // Only fill in if the reviewer/frontend didn't already set a
        // language via the override chip (files/HANDOFF.md §2.4) — never
        // overwrite an explicit value with a detected one.
        originalLanguage: review.originalLanguage ?? result.detectedLanguage,
        nlpAspects: result.aspects as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    console.error(`[nlp] Failed to process review ${reviewId}:`, err);
  }
}
