import { Request } from "express";
import { ipKeyGenerator, rateLimit, type Options } from "express-rate-limit";

// Requests reach the API through Vercel's /api proxy and Render's load
// balancer. Vercel sets X-Forwarded-For to the real visitor's address (and
// doesn't let the visitor override it), so its first entry identifies the
// visitor. Requests made straight to Render could forge that header, which
// is why the sensitive limits below also count per account or per email.
export function clientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
  return ipKeyGenerator(first || req.ip || "unknown");
}

const MESSAGE = "Too many requests. Please wait a few minutes and try again.";

function limiter(windowMs: number, limit: number, key: (req: Request) => string, extra: Partial<Options> = {}) {
  return rateLimit({
    windowMs,
    limit,
    keyGenerator: key,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: MESSAGE },
    // We read X-Forwarded-For ourselves (see clientIp).
    validate: { xForwardedForHeader: false, trustProxy: false },
    ...extra,
  });
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const byIp = (req: Request) => clientIp(req);
const byUser = (req: Request) => req.auth?.userId ?? clientIp(req);
const byEmail = (req: Request) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  return email ? `email:${email}` : clientIp(req);
};

// A ceiling on everything under /api, generous enough for normal browsing.
export const apiLimiter = limiter(15 * MIN, 600, byIp);

// Signing in and up.
export const authLimiter = limiter(15 * MIN, 30, byIp);
// Wrong passwords for one account, from anywhere (correct logins don't count).
export const loginAccountLimiter = limiter(15 * MIN, 8, byEmail, { skipSuccessfulRequests: true });

// Reset emails: per network and per address, so nobody can flood an inbox.
export const forgotIpLimiter = limiter(HOUR, 10, byIp);
export const forgotEmailLimiter = limiter(HOUR, 3, byEmail);
export const resetLimiter = limiter(15 * MIN, 10, byIp);

// Contributions, counted per signed-in account.
export const reviewLimiter = limiter(HOUR, 10, byUser);
export const reportLimiter = limiter(HOUR, 20, byUser);
export const uploadLimiter = limiter(HOUR, 20, byUser);
export const areaProposalLimiter = limiter(24 * HOUR, 10, byUser);

// The place search passes through to OpenStreetMap's Nominatim, which asks
// for light use.
export const geocodeLimiter = limiter(MIN, 30, byIp);
