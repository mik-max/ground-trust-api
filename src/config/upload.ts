import crypto from "crypto";
import fs from "fs";
import path from "path";
import multer from "multer";

export const UPLOADS_DIR = path.join(__dirname, "..", "..", "uploads");
export const AUDIO_DIR = path.join(UPLOADS_DIR, "audio");

fs.mkdirSync(AUDIO_DIR, { recursive: true });

// Voice reviews only, per files/HANDOFF.md §2.4 — recorded review audio,
// not arbitrary file upload. 10MB comfortably covers a few minutes at
// typical browser-recorded bitrates.
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

const EXT_BY_MIME: Record<string, string> = {
  "audio/webm": ".webm",
  "audio/ogg": ".ogg",
  "audio/mp4": ".m4a",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, AUDIO_DIR),
  filename: (_req, file, cb) => {
    const ext = EXT_BY_MIME[file.mimetype] ?? ".webm";
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

export const uploadAudio = multer({
  storage,
  limits: { fileSize: MAX_AUDIO_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("audio/")) {
      return cb(new Error("Only audio uploads are accepted"));
    }
    cb(null, true);
  },
});

// Maps a stored originalAudioRef (e.g. "/uploads/audio/<uuid>.webm") back to
// the file on disk, for the STT step to read. area.controller.ts already
// validates refs match this exact shape before they're ever saved to a
// Review, so this only needs to strip the known-good prefix.
export function audioRefToFilePath(ref: string): string {
  return path.join(AUDIO_DIR, path.basename(ref));
}
