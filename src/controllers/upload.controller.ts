import { Request, Response } from "express";
import { uploadAudioToCloudinary } from "../config/cloudinary";

// Returns a storage reference (not a public URL) for the review form to send
// back as originalAudioRef; the key stays "url" for the existing frontend.
export async function handleAudioUpload(req: Request, res: Response) {
  if (!req.file) {
    return res.status(400).json({ error: "No audio file uploaded" });
  }
  try {
    const ref = await uploadAudioToCloudinary(req.file.buffer);
    return res.status(201).json({ url: ref });
  } catch (err) {
    console.error("[upload] Cloudinary upload failed:", err);
    return res.status(502).json({ error: "Couldn't store the recording — please try again." });
  }
}
