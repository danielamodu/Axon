import { describe, it, expect, vi, beforeEach } from 'vitest'
import { validateApiKey, requireAuth, generateApiKey, rotateApiKey } from '../auth'
import type { PrismaClient } from '@prisma/client'

describe('Auth Layer', () => {
  let mockPrisma: any

  beforeEach(() => {
    mockPrisma = {
      organisation: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
    }
  })

  describe('validateApiKey', () => {
    it('returns null for empty or invalid input', async () => {
      expect(await validateApiKey('', mockPrisma as unknown as PrismaClient)).toBeNull()
      expect(await validateApiKey('   ', mockPrisma as unknown as PrismaClient)).toBeNull()
      expect(await validateApiKey(null as any, mockPrisma as unknown as PrismaClient)).toBeNull()
    })

    it('returns null if organisation is not found in database', async () => {
      mockPrisma.organisation.findUnique.mockResolvedValue(null)
      const result = await validateApiKey('axon_live_invalid', mockPrisma as unknown as PrismaClient)
      expect(result).toBeNull()
      expect(mockPrisma.organisation.findUnique).toHaveBeenCalledWith({
        where: { apiKey: 'axon_live_invalid' },
      })
    })

    it('returns organisation if valid key exists in database', async () => {
      const mockOrg = {
        id: 'org_123',
        name: 'Sky Ecosystem',
        apiKey: 'axon_live_valid123',
        email: 'ops@sky.money',
        discordWebhook: null,
        createdAt: new Date(),
      }
      mockPrisma.organisation.findUnique.mockResolvedValue(mockOrg)

      const result = await validateApiKey('axon_live_valid123', mockPrisma as unknown as PrismaClient)
      expect(result).toEqual(mockOrg)
    })
  })

  describe('requireAuth', () => {
    it('throws error if key is invalid', async () => {
      mockPrisma.organisation.findUnique.mockResolvedValue(null)
      await expect(
        requireAuth('axon_live_bad', mockPrisma as unknown as PrismaClient)
      ).rejects.toThrow('Unauthorized. Invalid or missing Axon API key.')
    })

    it('returns organisation if key is valid', async () => {
      const mockOrg = {
        id: 'org_abc',
        name: 'MakerDAO Foundation',
        apiKey: 'axon_live_abc',
        email: null,
        discordWebhook: null,
        createdAt: new Date(),
      }
      mockPrisma.organisation.findUnique.mockResolvedValue(mockOrg)

      const result = await requireAuth('axon_live_abc', mockPrisma as unknown as PrismaClient)
      expect(result).toEqual(mockOrg)
    })
  })

  describe('generateApiKey', () => {
    it('creates an organisation with a valid axon_live_ key', async () => {
      mockPrisma.organisation.create.mockImplementation(async ({ data }: any) => ({
        id: 'org_created_1',
        ...data,
        createdAt: new Date(),
      }))

      const result = await generateApiKey(
        'Aave Governance',
        'admin@aave.com',
        mockPrisma as unknown as PrismaClient
      )

      expect(result.apiKey).toMatch(/^axon_live_[a-f0-9]{32}$/)
      expect(result.org.name).toBe('Aave Governance')
      expect(result.org.email).toBe('admin@aave.com')
      expect(mockPrisma.organisation.create).toHaveBeenCalledWith({
        data: {
          name: 'Aave Governance',
          apiKey: result.apiKey,
          email: 'admin@aave.com',
        },
      })
    })

    it('throws if organisation name is empty', async () => {
      await expect(
        generateApiKey('', undefined, mockPrisma as unknown as PrismaClient)
      ).rejects.toThrow('Organisation name is required')
    })
  })

  describe('rotateApiKey', () => {
    it('updates organisation with a new key', async () => {
      mockPrisma.organisation.update.mockImplementation(async ({ where, data }: any) => ({
        id: where.id,
        name: 'Uniswap Labs',
        apiKey: data.apiKey,
        email: null,
        discordWebhook: null,
        createdAt: new Date(),
      }))

      const result = await rotateApiKey('org_uni', mockPrisma as unknown as PrismaClient)
      expect(result.apiKey).toMatch(/^axon_live_[a-f0-9]{32}$/)
      expect(result.org.id).toBe('org_uni')
      expect(mockPrisma.organisation.update).toHaveBeenCalledWith({
        where: { id: 'org_uni' },
        data: { apiKey: result.apiKey },
      })
    })
  })
})
