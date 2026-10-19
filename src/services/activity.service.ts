import { NextFunction, Request, Response } from "express";
import prisma from "../config/prisma";
import { Prisma, Role } from "../generated/prisma";

// Activity tracking for the admin Activity page. Recording must never slow
// down or break the request it describes, so every write here is
// fire-and-forget and its errors are only logged.

const RETENTION_DAYS = 180;

export interface ActivityInput {
  userId?: string | null;
  role?: Role | null;
  visitorId?: string | null;
  areaId?: string | null;
  path?: string | null;
  meta?: Record<string, unknown> | null;
}

export function track(type: string, input: ActivityInput = {}): void {
  prisma.activityEvent
    .create({
      data: {
        type,
        userId: input.userId ?? null,
        role: input.role ?? null,
        visitorId: input.visitorId ?? null,
        areaId: input.areaId ?? null,
        path: input.path ?? null,
        meta: (input.meta ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    })
    .catch((err) => console.error("[activity] couldn't record", type, err?.message ?? err));
}

// Shorthand for an event caused by the signed-in user of this request.
export const trackReq = (req: Request, type: string, input: Omit<ActivityInput, "userId" | "role"> = {}) =>
  track(type, { ...input, userId: req.auth?.userId ?? null, role: req.auth?.role ?? null });

// ---------- API request stats, counted per hour, endpoint and status class ----------

type Bucket = { hour: Date; method: string; route: string; statusClass: string; count: number; totalMs: number; maxMs: number };
const buckets = new Map<string, Bucket>();

// The matched route pattern ("/api/areas/:id"), not the raw URL, so one
// area's page doesn't become its own row.
function routeOf(req: Request): string {
  if (req.route?.path) return `${req.baseUrl}${req.route.path === "/" ? "" : req.route.path}`;
  return "(no matching route)";
}

export function requestStats(req: Request, res: Response, next: NextFunction) {
  if (!req.originalUrl.startsWith("/api") || req.originalUrl.startsWith("/api/docs")) return next();
  const started = process.hrtime.bigint();
  res.on("finish", () => {
    const ms = Number((process.hrtime.bigint() - started) / 1_000_000n);
    const hour = new Date(); hour.setMinutes(0, 0, 0);
    const statusClass = `${Math.floor(res.statusCode / 100)}xx`;
    const route = routeOf(req);
    const key = `${hour.toISOString()}|${req.method}|${route}|${statusClass}`;
    const b = buckets.get(key) ?? { hour, method: req.method, route, statusClass, count: 0, totalMs: 0, maxMs: 0 };
    b.count += 1; b.totalMs += ms; b.maxMs = Math.max(b.maxMs, ms);
    buckets.set(key, b);
  });
  next();
}

let lastCleanup = 0;

export async function flushRequestStats(): Promise<void> {
  const batch = [...buckets.values()];
  buckets.clear();
  for (const b of batch) {
    try {
      await prisma.$executeRaw`
        INSERT INTO "ApiRequestStat" ("id", "hour", "method", "route", "statusClass", "count", "totalMs", "maxMs")
        VALUES (${`s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`}, ${b.hour}, ${b.method}, ${b.route}, ${b.statusClass}, ${b.count}, ${b.totalMs}, ${b.maxMs})
        ON CONFLICT ("hour", "method", "route", "statusClass") DO UPDATE SET
          "count" = "ApiRequestStat"."count" + EXCLUDED."count",
          "totalMs" = "ApiRequestStat"."totalMs" + EXCLUDED."totalMs",
          "maxMs" = GREATEST("ApiRequestStat"."maxMs", EXCLUDED."maxMs")`;
    } catch (err) {
      console.error("[activity] couldn't save request stats:", (err as Error).message);
    }
  }
  // Once a day, drop anything older than the retention period.
  if (Date.now() - lastCleanup > 24 * 60 * 60 * 1000) {
    lastCleanup = Date.now();
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    try {
      await prisma.activityEvent.deleteMany({ where: { createdAt: { lt: cutoff } } });
      await prisma.apiRequestStat.deleteMany({ where: { hour: { lt: cutoff } } });
    } catch (err) {
      console.error("[activity] cleanup failed:", (err as Error).message);
    }
  }
}

export function startActivityFlushing() {
  const timer = setInterval(() => void flushRequestStats(), 60_000);
  timer.unref();
  const onExit = () => void flushRequestStats().finally(() => process.exit(0));
  process.once("SIGTERM", onExit);
  process.once("SIGINT", onExit);
}
