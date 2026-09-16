import crypto from 'node:crypto'
import { PrismaClient, type Organisation } from '@prisma/client'

// Shared or default PrismaClient instance
let defaultPrisma: PrismaClient | null = null

function getPrisma(client?: PrismaClient): PrismaClient {
  if (client) return client
  if (!defaultPrisma) {
    defaultPrisma = new PrismaClient()
  }
  return defaultPrisma
}

/**
 * API keys are never stored in plaintext. `hashApiKey` is deterministic so
 * lookups stay a single indexed `findUnique`; the plaintext is returned once
 * at creation/rotation and never persisted.
 */
export function hashApiKey(key: string): string {
  const digest = crypto.createHash('sha256').update(key.trim(), 'utf8').digest('hex')
  return `axon_live_${digest.slice(0, 32)}`
}

/**
 * Validates an Axon API key.
 * v2 (hashed) rows match by hash only — the stored value is never accepted
 * as bearer, so a DB leak alone grants nothing. The v1 legacy fallback was
 * removed after all rows migrated (v1 count hit zero 2026-09-17).
 */
export async function validateApiKey(
  key: string,
  prismaClient?: PrismaClient
): Promise<Organisation | null> {
  if (!key || typeof key !== 'string' || key.trim() === '') {
    return null
  }

  const prisma = getPrisma(prismaClient)
  const org = await prisma.organisation.findUnique({
    where: { apiKey: hashApiKey(key.trim()) },
  })
  return org
}

/**
 * Requires a valid Axon API key.
 * Throws an Error if the key is missing or invalid; returns Organisation on success.
 */
export async function requireAuth(
  key: string,
  prismaClient?: PrismaClient
): Promise<Organisation> {
  const org = await validateApiKey(key, prismaClient)
  if (!org) {
    throw new Error('Unauthorized. Invalid or missing Axon API key.')
  }
  return org
}

/**
 * Generates a new unique API key and creates an Organisation record.
 * Stores only the hash; returns the plaintext once for the operator to save.
 */
export async function generateApiKey(
  orgName: string,
  email?: string | null,
  prismaClient?: PrismaClient
): Promise<{ org: Organisation; apiKey: string }> {
  if (!orgName || orgName.trim().length === 0) {
    throw new Error('Organisation name is required to generate an API key.')
  }

  const prisma = getPrisma(prismaClient)
  const randomSuffix = crypto.randomBytes(16).toString('hex')
  const apiKey = `axon_live_${randomSuffix}`

  const org = await prisma.organisation.create({
    data: {
      name: orgName.trim(),
      apiKey: hashApiKey(apiKey),
      apiKeyVersion: 2,
      email: email ? email.trim() : null,
    },
  })

  return { org, apiKey }
}

/**
 * Rotates an API key for an existing Organisation by ID.
 * Stores only the hash; returns the plaintext once.
 */
export async function rotateApiKey(
  orgId: string,
  prismaClient?: PrismaClient
): Promise<{ org: Organisation; apiKey: string }> {
  const prisma = getPrisma(prismaClient)
  const randomSuffix = crypto.randomBytes(16).toString('hex')
  const apiKey = `axon_live_${randomSuffix}`

  const org = await prisma.organisation.update({
    where: { id: orgId },
    data: { apiKey: hashApiKey(apiKey), apiKeyVersion: 2 },
  })

  return { org, apiKey }
}
