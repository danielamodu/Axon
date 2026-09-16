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
 * Find an org by bearer token. Accepts:
 *  1. plaintext keys (hashed then matched — current scheme),
 *  2. legacy plaintext rows (direct match, migration window),
 *  3. stored hashes presented as bearer (direct match — e.g. after
 *     email+password login returns the stored value).
 */
export async function findOrgByToken(db: any, token: string) {
  const trimmed = token.trim();
  if (!trimmed) return null;
  const hashed = hashApiKey(trimmed);
  try {
    const byHash = await db.organisation.findUnique({ where: { apiKey: hashed } });
    if (byHash) return byHash;
  } catch {
    // fall through to direct match
  }
  if (trimmed !== hashed) {
    try {
      return await db.organisation.findUnique({ where: { apiKey: trimmed } });
    } catch {
      return null;
    }
  }
  return null;
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
    const org = await findOrgByToken(getAuthPrisma(), token);
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
