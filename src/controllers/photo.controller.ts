import { Request, Response } from "express";
import prisma from "../config/prisma";
import { areaPhotoUrls, deleteAreaPhoto, uploadAreaPhoto } from "../config/cloudinary";

// A resident can send a few photos a day; each waits for an admin.
const MAX_UPLOADS_PER_DAY = 5;

// POST /api/areas/:id/photos (resident) — a photo of the area, held as
// pending until an admin approves it. The resident must confirm they took
// it and agree to it being shown (`agree: "true"` in the form).
export async function addAreaPhoto(req: Request, res: Response) {
  const { id } = req.params;
  const userId = req.auth!.userId;
  if (!req.file) return res.status(400).json({ error: "Choose a photo to upload" });
  if (req.body?.agree !== "true") {
    return res.status(400).json({ error: "Please confirm you took this photo and agree to it being shown" });
  }

  const area = await prisma.area.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!area || area.status !== "approved") return res.status(404).json({ error: "Area not found" });

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = await prisma.areaPhoto.count({ where: { uploadedByUserId: userId, createdAt: { gte: since } } });
  if (recent >= MAX_UPLOADS_PER_DAY) {
    return res.status(429).json({ error: "You've added the most photos allowed for today. Please try again tomorrow." });
  }

  try {
    const uploaded = await uploadAreaPhoto(req.file.buffer);
    const photo = await prisma.areaPhoto.create({
      data: {
        areaId: area.id,
        publicId: uploaded.publicId,
        width: uploaded.width,
        height: uploaded.height,
        source: "resident",
        status: "pending",
        uploadedByUserId: userId,
      },
      select: { id: true, status: true },
    });
    return res.status(201).json({ photo });
  } catch (err) {
    console.error("[photos] upload failed:", err);
    return res.status(502).json({ error: "Couldn't upload the photo. Please try again." });
  }
}

// GET /api/admin/photos/pending — residents' photos waiting for a decision.
export async function listPendingPhotos(_req: Request, res: Response) {
  const rows = await prisma.areaPhoto.findMany({
    where: { status: "pending" },
    orderBy: { createdAt: "asc" },
    include: {
      area: { select: { id: true, name: true, lga: true, city: true } },
      uploadedBy: { select: { fullName: true } },
    },
  });
  const coverCounts = await prisma.areaPhoto.groupBy({
    by: ["areaId"],
    where: { areaId: { in: rows.map((r) => r.areaId) }, status: "approved" },
    _count: true,
  });
  const hasPhoto = new Set(coverCounts.map((c) => c.areaId));
  return res.json({
    photos: rows.map((r) => ({
      id: r.id,
      area: r.area,
      url: areaPhotoUrls(r.publicId).card,
      fullUrl: areaPhotoUrls(r.publicId).banner,
      uploadedBy: r.uploadedBy?.fullName ?? null,
      createdAt: r.createdAt,
      areaHasPhoto: hasPhoto.has(r.areaId),
    })),
  });
}

// POST /api/admin/photos/:id/moderate { decision: "approved" | "rejected", cover?: boolean }
// Approving makes it the cover when asked, or when the area has no photo
// yet. Rejecting deletes the image from storage altogether.
export async function moderatePhoto(req: Request, res: Response) {
  const { id } = req.params;
  const { decision, cover } = req.body as { decision?: string; cover?: boolean };
  if (decision !== "approved" && decision !== "rejected") {
    return res.status(400).json({ error: "decision must be 'approved' or 'rejected'" });
  }
  const photo = await prisma.areaPhoto.findUnique({ where: { id } });
  if (!photo) return res.status(404).json({ error: "Photo not found" });
  if (photo.status !== "pending") return res.status(409).json({ error: "This photo has already been moderated" });

  if (decision === "rejected") {
    try {
      await deleteAreaPhoto(photo.publicId);
    } catch (err) {
      console.error("[photos] couldn't delete rejected photo from storage:", err);
    }
    await prisma.areaPhoto.delete({ where: { id } });
    return res.json({ photo: { id, status: "rejected" } });
  }

  const existing = await prisma.areaPhoto.count({ where: { areaId: photo.areaId, status: "approved" } });
  const makeCover = Boolean(cover) || existing === 0;
  const updated = await prisma.$transaction(async (tx) => {
    if (makeCover) await tx.areaPhoto.updateMany({ where: { areaId: photo.areaId, isCover: true }, data: { isCover: false } });
    return tx.areaPhoto.update({
      where: { id },
      data: { status: "approved", reviewedAt: new Date(), isCover: makeCover },
      select: { id: true, status: true, isCover: true },
    });
  });
  return res.json({ photo: updated });
}
