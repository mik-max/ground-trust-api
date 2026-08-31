import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { Role } from "../generated/prisma";

export interface AuthPayload {
  userId: string;
  role: Role;
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

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET as string) as AuthPayload;
    req.auth = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// For endpoints that are publicly readable but render differently for a
// logged-in role (e.g. review audio is government-only — see
// getAreaReviews) — decodes the token if one is present and valid, but
// never rejects the request either way.
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;

  if (token) {
    try {
      req.auth = jwt.verify(token, process.env.JWT_SECRET as string) as AuthPayload;
    } catch {
      // Invalid/expired token on an optional-auth route just means "treat as
      // anonymous" — unlike requireAuth, this is not an error.
    }
  }
  next();
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
