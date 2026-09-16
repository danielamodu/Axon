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
 * Looks up Organisation by hashed key first, falling back to a legacy
 * plaintext row (migration window for pre-hash deployments).
 */
export async function validateApiKey(
  key: string,
  prismaClient?: PrismaClient
): Promise<Organisation | null> {
  if (!key || typeof key !== 'string' || key.trim() === '') {
    return null
  }

  const prisma = getPrisma(prismaClient)
  const trimmed = key.trim()
  const hashed = hashApiKey(trimmed)
  const org = await prisma.organisation.findUnique({
    where: { apiKey: hashed },
  })
  if (org) return org

  // Legacy fallback: rows created before hashing. Remove after migration.
  if (trimmed !== hashed) {
    const legacy = await prisma.organisation.findUnique({
      where: { apiKey: trimmed },
    })
    if (legacy) return legacy
  }

  return null
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
    data: { apiKey: hashApiKey(apiKey) },
  })

  return { org, apiKey }
}
