import crypto from "crypto";
import { v2 as cloudinary } from "cloudinary";

// Voice recordings live in Cloudinary as *authenticated* (non-public) files,
// so they survive redeploys and are never reachable by a plain URL. The
// database stores only a reference ("cloudinary:<public_id>.<format>"); a
// short-lived signed link is generated each time an authorised viewer
// (government authority or administrator) needs to play one.
const AUDIO_FOLDER = process.env.CLOUDINARY_AUDIO_FOLDER ?? "groundtrust/audio";
const PLAYBACK_LINK_SECONDS = 60 * 60;
const REF_PREFIX = "cloudinary:";

let configured = false;
function client() {
  if (!configured) {
    const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
    if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
      throw new Error("Cloudinary is not configured (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET)");
    }
    cloudinary.config({ cloud_name: CLOUDINARY_CLOUD_NAME, api_key: CLOUDINARY_API_KEY, api_secret: CLOUDINARY_API_SECRET, secure: true });
    configured = true;
  }
  return cloudinary;
}

// Matches references produced by uploadAudioToCloudinary below.
export const AUDIO_REF_PATTERN = /^cloudinary:[\w/-]+\.\w+$/;

function parseRef(ref: string): { publicId: string; format: string } | null {
  if (!AUDIO_REF_PATTERN.test(ref)) return null;
  const body = ref.slice(REF_PREFIX.length);
  const dot = body.lastIndexOf(".");
  return { publicId: body.slice(0, dot), format: body.slice(dot + 1) };
}

export function uploadAudioToCloudinary(buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const stream = client().uploader.upload_stream(
      // Cloudinary treats audio as the "video" resource type.
      { resource_type: "video", type: "authenticated", folder: AUDIO_FOLDER, public_id: crypto.randomUUID() },
      (err, result) => {
        if (err || !result) return reject(err ?? new Error("Cloudinary upload returned no result"));
        resolve(`${REF_PREFIX}${result.public_id}.${result.format}`);
      }
    );
    stream.end(buffer);
  });
}

// A signed link that stops working after an hour, or null for a reference
// that isn't a Cloudinary one.
export function audioPlaybackUrl(ref: string | null): string | null {
  if (!ref) return null;
  const parsed = parseRef(ref);
  if (!parsed) return null;
  return client().utils.private_download_url(parsed.publicId, parsed.format, {
    resource_type: "video",
    type: "authenticated",
    expires_at: Math.floor(Date.now() / 1000) + PLAYBACK_LINK_SECONDS,
  });
}
