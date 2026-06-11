import type { NextFunction, Request, Response } from "express";

type SessionRole = "site" | "admin";

const SITE_COOKIE = "mj_site_session";
const ADMIN_COOKIE = "mj_admin_session";

function readSession(req: Request, cookieName: string, role: SessionRole) {
  const raw = req.signedCookies?.[cookieName];
  if (!raw || typeof raw !== "string") return false;
  try {
    const value = JSON.parse(raw) as { role?: SessionRole; exp?: number };
    return value.role === role && typeof value.exp === "number" && value.exp > Date.now();
  } catch {
    return false;
  }
}

export function hasSiteAccess(req: Request) {
  return readSession(req, SITE_COOKIE, "site") || readSession(req, ADMIN_COOKIE, "admin");
}

export function hasAdminAccess(req: Request) {
  return readSession(req, ADMIN_COOKIE, "admin");
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    signed: true,
    sameSite: "strict" as const,
    secure: process.env.SECURE_COOKIES === "true",
    maxAge,
    path: "/"
  };
}

export function createSiteSession(res: Response) {
  const maxAge = 30 * 24 * 60 * 60 * 1000;
  res.cookie(SITE_COOKIE, JSON.stringify({ role: "site", exp: Date.now() + maxAge }), cookieOptions(maxAge));
}

export function createAdminSession(res: Response) {
  const maxAge = 12 * 60 * 60 * 1000;
  res.cookie(ADMIN_COOKIE, JSON.stringify({ role: "admin", exp: Date.now() + maxAge }), cookieOptions(maxAge));
  createSiteSession(res);
}

export function clearSessions(res: Response) {
  res.clearCookie(SITE_COOKIE, { path: "/" });
  res.clearCookie(ADMIN_COOKIE, { path: "/" });
}

export function requireSite(req: Request, res: Response, next: NextFunction) {
  if (!hasSiteAccess(req)) return res.status(401).json({ error: "请先解锁我们的纪念册" });
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!hasAdminAccess(req)) return res.status(401).json({ error: "需要管理员登录" });
  next();
}
