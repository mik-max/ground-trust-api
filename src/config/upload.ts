import multer from "multer";

// Audio is held in memory just long enough to be sent to Cloudinary (see
// config/cloudinary.ts); nothing is written to the server's disk, which
// Render wipes on every deploy.
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

export const uploadAudio = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AUDIO_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("audio/")) {
      return cb(new Error("Only audio uploads are accepted"));
    }
    cb(null, true);
  },
});
