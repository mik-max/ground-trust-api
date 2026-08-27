import { getOpenAiClient } from "../config/openai";

// files/ADDENDUM.md §3 — automated pass on translated English review text,
// before it's eligible to go public. Only ever returns "approved" or
// "pending" — "rejected" is exclusively a human admin decision (see
// admin.controller.ts's moderateReview), never set automatically. No key,
// or an API error, defaults to "approved" — the same permissive posture
// the schema already defaults to, so a missing key degrades to "no check
// runs" rather than blocking review visibility.
export async function moderateText(text: string): Promise<"approved" | "pending"> {
  const client = getOpenAiClient();
  if (!client) {
    console.warn("[moderation] Skipping check — OPENAI_API_KEY is not set.");
    return "approved";
  }

  try {
    const response = await client.moderations.create({
      input: text,
      model: "omni-moderation-latest",
    });
    return response.results[0]?.flagged ? "pending" : "approved";
  } catch (err) {
    console.error("[moderation] Check failed, defaulting to approved:", err);
    return "approved";
  }
}
