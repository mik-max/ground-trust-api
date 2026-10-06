import prisma from "../config/prisma";
import { areaPhotoUrls } from "../config/cloudinary";

// What the public API returns for an area's cover photo.
export interface PublicAreaPhoto {
  card: string;
  banner: string;
  share: string;
  source: "curated" | "resident";
  credit: string | null;
  creditUrl: string | null;
  license: string | null;
  licenseUrl: string | null;
}

type PhotoRow = {
  publicId: string;
  source: "curated" | "resident";
  credit: string | null;
  creditUrl: string | null;
  license: string | null;
  licenseUrl: string | null;
};

export function toPublicPhoto(row: PhotoRow): PublicAreaPhoto {
  return {
    ...areaPhotoUrls(row.publicId),
    source: row.source,
    // Resident photos are credited to "a resident", never by name.
    credit: row.source === "resident" ? "Photo by a resident" : row.credit,
    creditUrl: row.source === "resident" ? null : row.creditUrl,
    license: row.license,
    licenseUrl: row.licenseUrl,
  };
}

// Each area's cover: the approved photo marked as cover, otherwise the most
// recently approved one. One query for any number of areas.
export async function coverPhotos(areaIds: string[]): Promise<Map<string, PublicAreaPhoto>> {
  if (areaIds.length === 0) return new Map();
  const rows = await prisma.areaPhoto.findMany({
    where: { areaId: { in: areaIds }, status: "approved" },
    orderBy: [{ isCover: "desc" }, { reviewedAt: "desc" }, { createdAt: "desc" }],
  });
  const covers = new Map<string, PublicAreaPhoto>();
  for (const row of rows) if (!covers.has(row.areaId)) covers.set(row.areaId, toPublicPhoto(row));
  return covers;
}
