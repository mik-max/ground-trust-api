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

// Area photos from residents: held in memory, then sent to Cloudinary,
// which resizes and re-encodes them (dropping location metadata).
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

export const uploadPhoto = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!PHOTO_TYPES.has(file.mimetype)) {
      return cb(new Error("Only JPEG, PNG, WebP or HEIC photos are accepted"));
    }
    cb(null, true);
  },
});
