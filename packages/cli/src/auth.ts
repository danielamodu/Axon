import crypto from 'node:crypto'
import { PrismaClient, type Organisation } from '@prisma/client'

let prismaInstance: PrismaClient | null = null

function getPrisma(): PrismaClient {
  if (!prismaInstance) {
    prismaInstance = new PrismaClient()
  }
  return prismaInstance
}

export async function validateApiKey(
  key: string,
  prisma?: PrismaClient
): Promise<Organisation | null> {
  if (!key || typeof key !== 'string' || key.trim() === '') {
    return null
  }
  const db = prisma ?? getPrisma()
  try {
    return await db.organisation.findUnique({
      where: { apiKey: key.trim() },
    })
  } catch {
    return null
  }
}

export async function generateApiKey(
  orgName: string,
  email?: string | null,
  prisma?: PrismaClient
): Promise<{ org: Organisation; apiKey: string }> {
  if (!orgName || orgName.trim().length === 0) {
    throw new Error('Organisation name is required.')
  }
  const db = prisma ?? getPrisma()
  const randomSuffix = crypto.randomBytes(16).toString('hex')
  const apiKey = `axon_live_${randomSuffix}`

  const org = await db.organisation.create({
    data: {
      name: orgName.trim(),
      apiKey,
      email: email ? email.trim() : null,
    },
  })

  return { org, apiKey }
}

export async function rotateApiKey(
  orgId: string,
  prisma?: PrismaClient
): Promise<{ org: Organisation; apiKey: string }> {
  const db = prisma ?? getPrisma()
  const randomSuffix = crypto.randomBytes(16).toString('hex')
  const apiKey = `axon_live_${randomSuffix}`

  const org = await db.organisation.update({
    where: { id: orgId },
    data: { apiKey },
  })

  return { org, apiKey }
}
