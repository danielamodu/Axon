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
 * Validates an Axon API key.
 * Looks up Organisation by apiKey. Returns the Organisation record or null if not found.
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
    where: { apiKey: key.trim() },
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
 * Returns the created Organisation and the generated API key.
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
      apiKey,
      email: email ? email.trim() : null,
    },
  })

  return { org, apiKey }
}

/**
 * Rotates an API key for an existing Organisation by ID.
 * Returns the updated Organisation and the new API key.
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
    data: { apiKey },
  })

  return { org, apiKey }
}
