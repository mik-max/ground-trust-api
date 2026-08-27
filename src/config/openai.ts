import OpenAI from "openai";

let client: OpenAI | null = null;

// Lazily constructed, same pattern as config/anthropic.ts and
// config/groq.ts — a missing key means the moderation check is skipped
// (see services/moderation.service.ts), not a server crash. The moderation
// endpoint itself is free per OpenAI (files/ADDENDUM.md §3 / BACKLOG.md's
// cost notes) — the account/key is still a separate thing to set up.
export function getOpenAiClient(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!client) client = new OpenAI();
  return client;
}
