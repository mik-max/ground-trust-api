import { toFile } from "groq-sdk";
import { getGroqClient } from "../config/groq";
import { audioPlaybackUrl } from "../config/cloudinary";

export async function transcribeAudio(originalAudioRef: string): Promise<string | null> {
  const client = getGroqClient();
  if (!client) {
    console.warn(`[stt] Skipping ${originalAudioRef} — GROQ_API_KEY is not set.`);
    return null;
  }

  const url = audioPlaybackUrl(originalAudioRef);
  if (!url) {
    console.error(`[stt] Not a stored recording reference: ${originalAudioRef}`);
    return null;
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`[stt] Couldn't fetch ${originalAudioRef} from Cloudinary: HTTP ${response.status}`);
      return null;
    }
    const format = originalAudioRef.slice(originalAudioRef.lastIndexOf(".") + 1);
    const file = await toFile(Buffer.from(await response.arrayBuffer()), `recording.${format}`);
    const transcription = await client.audio.transcriptions.create({
      file,
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
