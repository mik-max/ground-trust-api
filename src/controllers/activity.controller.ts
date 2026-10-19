import { Request, Response } from "express";
import prisma from "../config/prisma";
import { Prisma } from "../generated/prisma";
import { track } from "../services/activity.service";

// What the website may report about itself. Anything else is ignored.
const CLIENT_EVENTS = new Set(["page_view", "search", "share_opened", "share_whatsapp", "share_save_image", "share_copy_link"]);
const BOT = /bot|crawler|spider|crawling|facebookexternalhit|WhatsApp|Slackbot|TelegramBot|preview|Lighthouse|HeadlessChrome/i;
const ID = /^[A-Za-z0-9_-]{8,64}$/;

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : null);

// POST /api/activity { type, visitorId, path?, areaId?, query? }
// Always answers 204, so it reveals nothing and never shows an error to visitors.
export function recordClientEvent(req: Request, res: Response) {
  const { type, visitorId, path, areaId, query } = (req.body ?? {}) as Record<string, unknown>;
  const ua = req.headers["user-agent"] ?? "";
  if (typeof type === "string" && CLIENT_EVENTS.has(type) && !BOT.test(ua)) {
    track(type, {
      userId: req.auth?.userId ?? null,
      role: req.auth?.role ?? null,
      visitorId: typeof visitorId === "string" && ID.test(visitorId) ? visitorId : null,
      path: clip(path, 200),
      areaId: typeof areaId === "string" && /^[A-Za-z0-9_-]{1,120}$/.test(areaId) ? areaId : null,
      meta: type === "search" && typeof query === "string" ? { query: query.trim().slice(0, 80) } : null,
    });
  }
  res.status(204).end();
}

// ---------- Admin: GET /api/admin/activity?days=7 ----------

const n = (v: unknown) => Number(v ?? 0);
const TZ = "Africa/Lagos";

export async function activitySummary(req: Request, res: Response) {
  const days = [1, 7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 7;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [counts, visitors, daily, topAreas, topPages, searches, api, apiTotals, recent] = await Promise.all([
    prisma.activityEvent.groupBy({ by: ["type"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.$queryRaw<{ v: bigint }[]>`SELECT COUNT(DISTINCT "visitorId") AS v FROM "ActivityEvent" WHERE "type" = 'page_view' AND "createdAt" >= ${since}`,
    prisma.$queryRaw<{ day: string; visitors: bigint; views: bigint; signups: bigint; reviews: bigint }[]>`
      SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS day,
             COUNT(DISTINCT "visitorId") FILTER (WHERE "type" = 'page_view') AS visitors,
             COUNT(*) FILTER (WHERE "type" = 'page_view') AS views,
             COUNT(*) FILTER (WHERE "type" = 'signup') AS signups,
             COUNT(*) FILTER (WHERE "type" = 'review_submitted') AS reviews
      FROM "ActivityEvent" WHERE "createdAt" >= ${since} GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<{ areaId: string; name: string | null; views: bigint; visitors: bigint }[]>`
      SELECT e."areaId", a."name", COUNT(*) AS views, COUNT(DISTINCT e."visitorId") AS visitors
      FROM "ActivityEvent" e LEFT JOIN "Area" a ON a."id" = e."areaId"
      WHERE e."type" = 'page_view' AND e."areaId" IS NOT NULL AND e."createdAt" >= ${since}
      GROUP BY 1, 2 ORDER BY views DESC LIMIT 10`,
    prisma.$queryRaw<{ page: string; views: bigint }[]>`
      SELECT regexp_replace(regexp_replace(COALESCE("path", '/'), '/areas/[^/?]+', '/areas/:area'), '\\?.*$', '') AS page, COUNT(*) AS views
      FROM "ActivityEvent" WHERE "type" = 'page_view' AND "createdAt" >= ${since}
      GROUP BY 1 ORDER BY views DESC LIMIT 10`,
    prisma.$queryRaw<{ query: string; times: bigint }[]>`
      SELECT lower("meta"->>'query') AS query, COUNT(*) AS times FROM "ActivityEvent"
      WHERE "type" = 'search' AND "createdAt" >= ${since} AND "meta"->>'query' IS NOT NULL
      GROUP BY 1 ORDER BY times DESC LIMIT 10`,
    prisma.$queryRaw<{ method: string; route: string; requests: bigint; client_errors: bigint; server_errors: bigint; total_ms: bigint; max_ms: number }[]>`
      SELECT "method", "route", SUM("count") AS requests,
             SUM("count") FILTER (WHERE "statusClass" = '4xx') AS client_errors,
             SUM("count") FILTER (WHERE "statusClass" = '5xx') AS server_errors,
             SUM("totalMs") AS total_ms, MAX("maxMs") AS max_ms
      FROM "ApiRequestStat" WHERE "hour" >= ${since} GROUP BY 1, 2 ORDER BY requests DESC LIMIT 15`,
    prisma.$queryRaw<{ requests: bigint; server_errors: bigint; total_ms: bigint }[]>`
      SELECT COALESCE(SUM("count"), 0) AS requests, COALESCE(SUM("count") FILTER (WHERE "statusClass" = '5xx'), 0) AS server_errors,
             COALESCE(SUM("totalMs"), 0) AS total_ms FROM "ApiRequestStat" WHERE "hour" >= ${since}`,
    prisma.activityEvent.findMany({
      where: { createdAt: { gte: since }, type: { notIn: ["page_view"] } },
      orderBy: { createdAt: "desc" },
      take: 40,
    }),
  ]);

  const byType = Object.fromEntries(counts.map((c) => [c.type, c._count._all]));
  const sum = (...types: string[]) => types.reduce((t, k) => t + (byType[k] ?? 0), 0);

  // Names for the feed: accounts and areas mentioned in it.
  const userIds = [...new Set(recent.map((r) => r.userId).filter((x): x is string => Boolean(x)))];
  const areaIds = [...new Set(recent.map((r) => r.areaId).filter((x): x is string => Boolean(x)))];
  const [users, areas] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } }),
    prisma.area.findMany({ where: { id: { in: areaIds } }, select: { id: true, name: true } }),
  ]);
  const userName = new Map(users.map((u) => [u.id, u.fullName]));
  const areaName = new Map(areas.map((a) => [a.id, a.name]));
  const t = apiTotals[0];

  return res.json({
    days,
    totals: {
      visitors: n(visitors[0]?.v),
      pageViews: sum("page_view"),
      signups: sum("signup"),
      logins: sum("login"),
      failedLogins: sum("login_failed"),
      reviews: sum("review_submitted"),
      photos: sum("photo_uploaded"),
      reports: sum("review_reported"),
      shares: sum("share_opened"),
      shareActions: sum("share_whatsapp", "share_save_image", "share_copy_link"),
      searches: sum("search"),
      passwordResets: sum("password_reset_requested"),
      apiRequests: n(t?.requests),
      apiServerErrors: n(t?.server_errors),
      apiAvgMs: n(t?.requests) ? Math.round(n(t?.total_ms) / n(t?.requests)) : 0,
    },
    daily: daily.map((d) => ({ day: d.day, visitors: n(d.visitors), pageViews: n(d.views), signups: n(d.signups), reviews: n(d.reviews) })),
    topAreas: topAreas.map((a) => ({ areaId: a.areaId, name: a.name ?? a.areaId, views: n(a.views), visitors: n(a.visitors) })),
    topPages: topPages.map((p) => ({ page: p.page, views: n(p.views) })),
    topSearches: searches.map((s) => ({ query: s.query, times: n(s.times) })),
    api: api.map((r) => ({
      method: r.method,
      route: r.route,
      requests: n(r.requests),
      clientErrors: n(r.client_errors),
      serverErrors: n(r.server_errors),
      avgMs: n(r.requests) ? Math.round(n(r.total_ms) / n(r.requests)) : 0,
      maxMs: n(r.max_ms),
    })),
    recent: recent.map((r) => ({
      id: r.id,
      type: r.type,
      at: r.createdAt,
      role: r.role,
      user: r.userId ? userName.get(r.userId) ?? "deleted account" : null,
      area: r.areaId ? areaName.get(r.areaId) ?? r.areaId : null,
      meta: r.meta as Prisma.JsonObject | null,
    })),
  });
}
