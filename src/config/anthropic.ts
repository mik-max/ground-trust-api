import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

// Lazily constructed so a missing key doesn't crash the server at boot —
// the NLP pipeline just skips processing until ANTHROPIC_API_KEY is set
// (see services/nlp.service.ts).
export function getAnthropicClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic();
  return client;
}
