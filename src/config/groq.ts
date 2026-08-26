import Groq from "groq-sdk";

let client: Groq | null = null;

// Lazily constructed, same pattern as config/anthropic.ts — a missing key
// just means the STT step is skipped (see services/stt.service.ts), not a
// server crash. Groq's free tier covers this project's expected volume
// comfortably (see BACKLOG.md).
export function getGroqClient(): Groq | null {
  if (!process.env.GROQ_API_KEY) return null;
  if (!client) client = new Groq();
  return client;
}
