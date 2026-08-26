import fs from "fs";
import { getGroqClient } from "../config/groq";
import { audioRefToFilePath } from "../config/upload";

// files/HANDOFF.md §3 — speech-to-text step of the NLP pipeline (the piece
// still missing when the translate/classify half shipped — see BACKLOG.md).
// Whisper-family per HANDOFF's own suggestion, via Groq rather than OpenAI:
// same whisper-large-v3 model, genuinely free tier at this project's scale
// (see BACKLOG.md's cost notes). Returns null — never throws — on any
// failure so a transcription problem can't block review submission, mirroring
// nlp.service.ts's graceful-degradation pattern for the same reason.
export async function transcribeAudio(originalAudioRef: string): Promise<string | null> {
  const client = getGroqClient();
  if (!client) {
    console.warn(`[stt] Skipping ${originalAudioRef} — GROQ_API_KEY is not set.`);
    return null;
  }

  const filePath = audioRefToFilePath(originalAudioRef);
  if (!fs.existsSync(filePath)) {
    console.error(`[stt] Audio file not found on disk: ${filePath}`);
    return null;
  }

  try {
    const transcription = await client.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: "whisper-large-v3-turbo",
      response_format: "json",
    });
    const text = transcription.text.trim();
    return text.length > 0 ? text : null;
  } catch (err) {
    console.error(`[stt] Transcription failed for ${originalAudioRef}:`, err);
    return null;
  }
}
