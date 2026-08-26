import { Request, Response } from "express";

// Returns a relative URL, not an absolute one — served statically at
// /uploads (see app.ts), same origin as the API behind the frontend's dev
// proxy, so this stays portable across environments.
export function handleAudioUpload(req: Request, res: Response) {
  if (!req.file) {
    return res.status(400).json({ error: "No audio file uploaded" });
  }
  return res.status(201).json({ url: `/uploads/audio/${req.file.filename}` });
}
