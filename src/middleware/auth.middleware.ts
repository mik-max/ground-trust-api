import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { Role } from "../generated/prisma";
import prisma from "../config/prisma";

export interface AuthPayload {
  userId: string;
  role: Role;
  iat?: number;
}

// A token stops working once its account's password has been reset after
// it was issued (or the account is gone). The lookup is cached briefly so
// signed-in requests don't each hit the database; a reset clears the entry.
const CACHE_MS = 60_000;
const changedAtCache = new Map<string, { changedAt: number | null; exists: boolean; at: number }>();

export function forgetPasswordChange(userId: string) {
  changedAtCache.delete(userId);
}

async function isCurrent(payload: AuthPayload): Promise<boolean> {
  let entry = changedAtCache.get(payload.userId);
  if (!entry || Date.now() - entry.at > CACHE_MS) {
    const user = await prisma.user.findUnique({ where: { id: payload.userId }, select: { passwordChangedAt: true } });
    entry = { changedAt: user?.passwordChangedAt?.getTime() ?? null, exists: Boolean(user), at: Date.now() };
    changedAtCache.set(payload.userId, entry);
  }
  if (!entry.exists) return false;
  return entry.changedAt === null || (payload.iat ?? 0) * 1000 >= entry.changedAt;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;

  if (!token) {
    return res.status(401).json({ error: "Missing bearer token" });
  }

  let payload: AuthPayload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET as string) as AuthPayload;
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
  isCurrent(payload)
    .then((current) => {
      if (!current) return res.status(401).json({ error: "Your session has ended. Please log in again." });
      req.auth = payload;
      next();
    })
    .catch(next);
}

// For endpoints that are publicly readable but render differently for a
// logged-in role (e.g. review audio is government-only — see
// getAreaReviews) — decodes the token if one is present and valid, but
// never rejects the request either way.
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;

  if (!token) return next();
  let payload: AuthPayload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET as string) as AuthPayload;
  } catch {
    // Invalid/expired token on an optional-auth route just means "treat as
    // anonymous" — unlike requireAuth, this is not an error.
    return next();
  }
  isCurrent(payload)
    .then((current) => {
      if (current) req.auth = payload;
      next();
    })
    .catch(next);
}

// Structurally separates resident/government/admin endpoints
// (files/HANDOFF.md §5) — a role not in `roles` is rejected outright.
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      return res.status(403).json({ error: "Forbidden for this role" });
    }
    next();
  };
}
