import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import type { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

let prisma: PrismaClient | null = null;
export function getAuthPrisma(): PrismaClient {
  if (!prisma) prisma = new PrismaClient();
  return prisma;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function validateEmail(email: unknown): email is string {
  return typeof email === "string" && EMAIL_RE.test(email.trim());
}

export function validatePassword(password: unknown): { valid: boolean; error?: string } {
  if (typeof password !== "string" || password.length < 8) {
    return { valid: false, error: "Password must be at least 8 characters" };
  }
  return { valid: true };
}

export function isValidAddress(addr: unknown): addr is string {
  return typeof addr === "string" && ADDRESS_RE.test(addr.trim());
}

export function maskApiKey(key: string): string {
  if (!key || key.length < 8) return "axon_live_...";
  return `axon_live_...${key.slice(-4)}`;
}

export function generateApiKeyValue(): string {
  return `axon_live_${crypto.randomBytes(16).toString("hex")}`;
}

/**
 * Hash an API key for storage. Deterministic (sha256) so lookups stay a
 * single indexed query. Must match packages/watcher/src/auth.ts.
 * Plaintext is returned once at creation; only the hash is persisted.
 */
export function hashApiKey(key: string): string {
  const digest = crypto.createHash("sha256").update(key.trim(), "utf8").digest("hex");
  return `axon_live_${digest.slice(0, 32)}`;
}

/**
 * Find an org by bearer token. v2 (hashed) rows match by hash only — the
 * stored value is never valid bearer. The v1 legacy fallback was removed
 * after all rows migrated (v1 count hit zero 2026-09-17).
 */
export async function findOrgByToken(db: any, token: string) {
  const trimmed = token.trim();
  if (!trimmed) return null;
  try {
    return await db.organisation.findUnique({ where: { apiKey: hashApiKey(trimmed) } });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Web session tokens (stateless, HMAC-signed).
//
// Password login issues one of these instead of rotating the org's API key —
// so logging in on the web no longer silently invalidates the CLI/MCP key,
// which is the same long-lived `axon_live_...` credential. Sessions are a
// separate, expiring bearer that `requireOrg` accepts alongside API keys.
//
// Stateless by design: no schema change, no session store. Signed with
// AXON_SESSION_SECRET; if that is unset we fall back to a per-process random
// secret (sessions then survive until the next restart, which is acceptable —
// users simply re-login, exactly like any session expiry).
// ---------------------------------------------------------------------------
const SESSION_PREFIX = "axon_sess_";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const SESSION_SECRET =
  process.env.AXON_SESSION_SECRET && process.env.AXON_SESSION_SECRET.length >= 16
    ? process.env.AXON_SESSION_SECRET
    : crypto.randomBytes(32).toString("hex");

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function signSessionBody(body: string): string {
  return b64url(crypto.createHmac("sha256", SESSION_SECRET).update(body).digest());
}

/** Mint a signed session token for an org. Opaque bearer for the web client. */
export function createSessionToken(orgId: string, ttlMs: number = SESSION_TTL_MS): string {
  const body = b64url(JSON.stringify({ orgId, exp: Date.now() + ttlMs }));
  return `${SESSION_PREFIX}${body}.${signSessionBody(body)}`;
}

/** Verify a session token: signature + expiry. Returns null on any failure. */
export function verifySessionToken(token: string): { orgId: string } | null {
  if (!token || !token.startsWith(SESSION_PREFIX)) return null;
  const raw = token.slice(SESSION_PREFIX.length);
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);

  try {
    const provided = Buffer.from(sig);
    const expected = Buffer.from(signSessionBody(body));
    if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
      return null;
    }
  } catch {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!parsed || typeof parsed.orgId !== "string" || parsed.orgId.length === 0) return null;
    if (typeof parsed.exp !== "number" || parsed.exp < Date.now()) return null;
    return { orgId: parsed.orgId };
  } catch {
    return null;
  }
}

/**
 * Resolve an org from a bearer token that may be either a web session token
 * or a long-lived API key. Session tokens are checked first (by prefix); a
 * non-session value falls through to the API-key hash lookup unchanged.
 */
export async function resolveOrgFromToken(db: any, token: string) {
  const trimmed = (token || "").trim();
  if (!trimmed) return null;
  const session = verifySessionToken(trimmed);
  if (session) {
    try {
      return await db.organisation.findUnique({ where: { id: session.orgId } });
    } catch {
      return null;
    }
  }
  return findOrgByToken(db, trimmed);
}

export function buildProtocolId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return (slug || "protocol").slice(0, 32);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}

export function getBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const token = header.replace(/^Bearer\s+/i, "").trim();
  return token || null;
}

/**
 * Strict auth: valid apiKey required, no fallbacks.
 * Sends 401 and returns null when unauthorized.
 */
export async function requireOrg(req: Request, res: Response) {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Unauthorized. Missing API key." });
    return null;
  }
  try {
    // Accept either a web session token or a long-lived API key.
    const org = await resolveOrgFromToken(getAuthPrisma(), token);
    if (!org) {
      res.status(401).json({ error: "Unauthorized. Invalid API key." });
      return null;
    }
    return org;
  } catch (err: any) {
    res.status(500).json({ error: err.message });
    return null;
  }
}
