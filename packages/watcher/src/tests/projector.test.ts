import { describe, it, expect, vi, beforeEach } from 'vitest'
import { StateProjector, type ProjectedChainState, type SimulationResult } from '../projector'
import type { PublicClient } from 'viem'
import type { PrismaClient, SpellRecord } from '@prisma/client'

describe('StateProjector', () => {
  let mockClient: any
  let mockPrisma: any
  let projector: StateProjector

  const defaultMockState: ProjectedChainState = {
    projectedAt: new Date('2026-09-08T14:00:00.000Z'),
    gasTrend: {
      averageGwei: 25.0,
      stddevGwei: 5.0,
      recentBlocks: [25, 26, 24, 25, 27, 23, 25, 24, 26, 25],
      slopeGweiPerBlock: 0.05,
    },
    usdsTotalSupply: 6_000_000_000,
    vatHeadroomUsds: 500_000_000,
    ethPriceUsd: 2500,
    oracleAgeSeconds: 300,
  }

  beforeEach(() => {
    mockClient = {
      getBlockNumber: vi.fn().mockResolvedValue(20000000n),
      getBlock: vi.fn().mockResolvedValue({ baseFeePerGas: 25000000000n }),
      readContract: vi.fn(),
      simulateContract: vi.fn().mockResolvedValue({}),
    }

    mockPrisma = {
      spellRecord: {
        findFirst: vi.fn(),
        update: vi.fn().mockResolvedValue({}),
      },
      projectorSnapshot: {
        create: vi.fn().mockResolvedValue({}),
        deleteMany: vi.fn().mockResolvedValue({}),
        findMany: vi.fn().mockResolvedValue([]),
      },
    }

    projector = new StateProjector(
      mockClient as unknown as PublicClient,
      mockPrisma as unknown as PrismaClient
    )
  })

  describe('scoreSpell', () => {
    it('scores GREEN when all conditions are healthy and simulation passes', () => {
      const sim: SimulationResult = { success: true, simulatedVia: 'viem' }
      const assessment = projector.scoreSpell(defaultMockState, sim)

      expect(assessment.score).toBe('GREEN')
      expect(assessment.reasons[0]).toContain('Clean simulation')
    })

    it('scores RED when simulation fails / reverts', () => {
      const sim: SimulationResult = {
        success: false,
        error: 'Execution reverted: ds-pause-delay-not-expired',
        simulatedVia: 'viem',
      }
      const assessment = projector.scoreSpell(defaultMockState, sim)

      expect(assessment.score).toBe('RED')
      expect(assessment.reasons[0]).toContain('Simulation reverted or failed')
    })

    it('scores RED when Vat debt ceiling headroom is exhausted (<= 0)', () => {
      const state: ProjectedChainState = {
        ...defaultMockState,
        vatHeadroomUsds: 0,
      }
      const sim: SimulationResult = { success: true, simulatedVia: 'viem' }
      const assessment = projector.scoreSpell(state, sim)

      expect(assessment.score).toBe('RED')
      expect(assessment.reasons.some((r) => r.includes('exhausted'))).toBe(true)
    })

    it('scores RED when oracle price is zero or negative', () => {
      const state: ProjectedChainState = {
        ...defaultMockState,
        ethPriceUsd: 0,
      }
      const sim: SimulationResult = { success: true, simulatedVia: 'viem' }
      const assessment = projector.scoreSpell(state, sim)

      expect(assessment.score).toBe('RED')
      expect(assessment.reasons.some((r) => r.includes('oracle'))).toBe(true)
    })

    it('scores YELLOW when average gas is elevated (> 100 gwei)', () => {
      const state: ProjectedChainState = {
        ...defaultMockState,
        gasTrend: {
          averageGwei: 125,
          stddevGwei: 10,
          recentBlocks: [120, 130],
          slopeGweiPerBlock: 0,
        },
      }
      const sim: SimulationResult = { success: true, simulatedVia: 'viem' }
      const assessment = projector.scoreSpell(state, sim)

      expect(assessment.score).toBe('YELLOW')
      expect(assessment.reasons.some((r) => r.includes('High average gas price'))).toBe(true)
    })

    it('scores YELLOW when gas volatility is high (stddev > 30 gwei)', () => {
      const state: ProjectedChainState = {
        ...defaultMockState,
        gasTrend: {
          averageGwei: 40,
          stddevGwei: 35,
          recentBlocks: [10, 75],
          slopeGweiPerBlock: 0,
        },
      }
      const sim: SimulationResult = { success: true, simulatedVia: 'viem' }
      const assessment = projector.scoreSpell(state, sim)

      expect(assessment.score).toBe('YELLOW')
      expect(assessment.reasons.some((r) => r.includes('High gas price volatility'))).toBe(true)
    })

    it('scores YELLOW when Vat debt headroom is low (< 100M USDS)', () => {
      const state: ProjectedChainState = {
        ...defaultMockState,
        vatHeadroomUsds: 45_000_000,
      }
      const sim: SimulationResult = { success: true, simulatedVia: 'viem' }
      const assessment = projector.scoreSpell(state, sim)

      expect(assessment.score).toBe('YELLOW')
      expect(assessment.reasons.some((r) => r.includes('Low Vat debt ceiling headroom'))).toBe(true)
    })

    it('scores YELLOW when oracle price is stale (> 3 hours)', () => {
      const state: ProjectedChainState = {
        ...defaultMockState,
        oracleAgeSeconds: 4 * 3600,
      }
      const sim: SimulationResult = { success: true, simulatedVia: 'viem' }
      const assessment = projector.scoreSpell(state, sim)

      expect(assessment.score).toBe('YELLOW')
      expect(assessment.reasons.some((r) => r.includes('stale'))).toBe(true)
    })

    it('scores YELLOW on rising gas trend even when average is moderate', async () => {
      const { computeSlope, resolveThresholds } = await import('../projector')
      expect(computeSlope([10, 20, 30, 40])).toBeGreaterThan(5)
      expect(computeSlope([50, 50, 50, 50])).toBeCloseTo(0, 5)
      const state: ProjectedChainState = {
        ...defaultMockState,
        gasTrend: { averageGwei: 60, stddevGwei: 5, recentBlocks: [40, 50, 60, 70, 80], slopeGweiPerBlock: 10 },
      }
      const assessment = projector.scoreSpell(state, { success: true, simulatedVia: 'viem' })
      expect(assessment.score).toBe('YELLOW')
      expect(assessment.reasons.some((r) => r.includes('Rising gas trend'))).toBe(true)
      // Per-protocol overrides apply without code changes
      expect(resolveThresholds('aave').minVatHeadroomUsds).toBe(50_000_000)
    })
  })

  describe('trend extrapolation to the execution window', () => {
    it('extrapolates a linear series to the target time', async () => {
      const { extrapolateTrend } = await import('../projector')
      const t0 = Date.now() - 4 * 3600_000
      const points = [0, 1, 2, 3, 4].map((h) => ({ tMs: t0 + h * 3600_000, v: 100 + h * 10 }))
      const out = extrapolateTrend(points, t0 + 6 * 3600_000)
      expect(out).not.toBeNull()
      expect(out!.value).toBeCloseTo(160, 0)
      expect(out!.slopePerHour).toBeCloseTo(10, 5)
      expect(out!.samples).toBe(5)
    })

    it('refuses trends with too few points or too short a span', async () => {
      const { extrapolateTrend } = await import('../projector')
      expect(extrapolateTrend([], Date.now())).toBeNull()
      expect(extrapolateTrend([{ tMs: Date.now(), v: 1 }], Date.now())).toBeNull()
      const t = Date.now()
      expect(
        extrapolateTrend(
          [{ tMs: t, v: 1 }, { tMs: t + 10 * 60_000, v: 2 }],
          t + 3600_000
        )
      ).toBeNull()
    })

    it('projectToWindow falls back when history is empty', async () => {
      mockPrisma.projectorSnapshot.findMany.mockResolvedValue([])
      const proj = await projector.projectToWindow(new Date(Date.now() + 48 * 3600_000))
      expect(proj.trendAvailable).toBe(false)
      expect(proj.usdsTotalSupply).toBeNull()
    })

    it('projectToWindow extrapolates Vat exhaustion before the window', async () => {
      const t0 = Date.now() - 6 * 3600_000
      mockPrisma.projectorSnapshot.findMany.mockResolvedValue(
        [0, 1, 2, 3, 4, 5, 6].map((h) => ({
          recordedAt: new Date(t0 + h * 3600_000),
          usdsTotalSupply: 6_000_000_000,
          vatHeadroomUsds: 300_000_000 - h * 100_000_000, // draining 100M/h
          gasAvgGwei: 25,
          gasStddevGwei: 5,
          ethPriceUsd: 2500,
        }))
      )
      const proj = await projector.projectToWindow(new Date(t0 + 10 * 3600_000))
      expect(proj.trendAvailable).toBe(true)
      expect(proj.vatHeadroomUsds!).toBeLessThan(0) // exhausted before window → RED
      expect(proj.vatSlopePerHour!).toBeCloseTo(-100_000_000, -6)
    })

    it('processSpell scores RED when the trend exhausts headroom before the window', async () => {
      const t0 = Date.now() - 6 * 3600_000
      mockPrisma.projectorSnapshot.findMany.mockResolvedValue(
        [0, 1, 2, 3, 4, 5, 6].map((h) => ({
          recordedAt: new Date(t0 + h * 3600_000),
          usdsTotalSupply: 6_000_000_000,
          vatHeadroomUsds: 300_000_000 - h * 100_000_000,
          gasAvgGwei: 25,
          gasStddevGwei: 5,
          ethPriceUsd: 2500,
        }))
      )
      const mockSpell: any = {
        id: 'spell-trend',
        spellAddress: '0x1234567890123456789012345678901234567890',
        nextExecutionWindow: new Date(t0 + 10 * 3600_000),
        protocolId: 'sky',
      }
      vi.spyOn(projector, 'projectChainState').mockResolvedValue({
        ...defaultMockState,
        vatHeadroomUsds: 50_000_000, // current looks merely low…
      })
      vi.spyOn(projector, 'simulateContractCall').mockResolvedValue({ success: true, simulatedVia: 'viem' })

      const assessment = await projector.processSpell(mockSpell)

      // …but the trend says exhausted → RED/HELD instead of YELLOW/READY
      expect(assessment.score).toBe('RED')
      expect(mockPrisma.spellRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'HELD', simulationScore: 'RED' }),
        })
      )
      expect(mockPrisma.projectorSnapshot.create).toHaveBeenCalled()
    })
  })

  describe('gas price trend computation', () => {
    it('calculates mean and standard deviation correctly across 10 blocks', async () => {
      const fees = [10n, 20n, 30n, 40n, 50n, 60n, 70n, 80n, 90n, 100n].map(
        (v) => v * 1_000_000_000n
      )

      mockClient.getBlockNumber.mockResolvedValue(100n)
      mockClient.getBlock.mockImplementation(({ blockNumber }: { blockNumber: bigint }) => {
        const idx = Number(100n - blockNumber)
        return Promise.resolve({ baseFeePerGas: fees[idx] })
      })

      const trend = await projector.getGasPriceTrend()

      // Mean of 10..100 is 55
      expect(trend.averageGwei).toBeCloseTo(55, 1)
      // Population stddev of 10..100 is ~28.72
      expect(trend.stddevGwei).toBeCloseTo(28.72, 1)
      expect(trend.recentBlocks.length).toBe(10)
    })
  })

  describe('poll and processSpell lifecycle', () => {
    it('processes QUEUED spell, transitions to SIMULATING, and saves READY on GREEN', async () => {
      const mockSpell: SpellRecord = {
        id: 'spell-123',
        spellAddress: '0x900c952c676595DdB392FA6349aD5f0674a67Eeb',
        calledAt: new Date(),
        earliestExecution: new Date(),
        latestExecution: new Date(),
        officeHoursActive: true,
        nextExecutionWindow: new Date(),
        calldata: '0x',
        actions: [],
        status: 'QUEUED',
        simulationScore: null,
        conflictStatus: null,
        conflictDetail: null,
        executedAt: null,
        txHash: null,
        gasUsed: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      mockPrisma.spellRecord.findFirst.mockResolvedValue(mockSpell)

      // Mock chain state responses
      vi.spyOn(projector, 'projectChainState').mockResolvedValue(defaultMockState)
      vi.spyOn(projector, 'simulateContractCall').mockResolvedValue({
        success: true,
        simulatedVia: 'viem',
      })

      const processed = await projector.poll()

      expect(processed).not.toBeNull()
      // First update: SIMULATING
      expect(mockPrisma.spellRecord.update).toHaveBeenNthCalledWith(1, {
        where: { id: 'spell-123' },
        data: { status: 'SIMULATING' },
      })
      // Second update: READY with GREEN score
      expect(mockPrisma.spellRecord.update).toHaveBeenNthCalledWith(2, {
        where: { id: 'spell-123' },
        data: expect.objectContaining({
          status: 'READY',
          simulationScore: 'GREEN',
          conflictStatus: null,
        }),
      })
    })

  describe('keeperHub oracle fallback', () => {
    it('marks status as HELD when score is RED', async () => {
      const mockSpell: SpellRecord = {
        id: 'spell-456',
        spellAddress: '0x1234567890123456789012345678901234567890',
        calledAt: new Date(),
        earliestExecution: new Date(),
        latestExecution: new Date(),
        officeHoursActive: true,
        nextExecutionWindow: new Date(),
        calldata: '0x',
        actions: [],
        status: 'QUEUED',
        simulationScore: null,
        conflictStatus: null,
        conflictDetail: null,
        executedAt: null,
        txHash: null,
        gasUsed: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      mockPrisma.spellRecord.findFirst.mockResolvedValue(mockSpell)

      vi.spyOn(projector, 'projectChainState').mockResolvedValue(defaultMockState)
      vi.spyOn(projector, 'simulateContractCall').mockResolvedValue({
        success: false,
        error: 'ds-pause-delay-not-expired',
        simulatedVia: 'viem',
      })

      await projector.poll()

      expect(mockPrisma.spellRecord.update).toHaveBeenNthCalledWith(2, {
        where: { id: 'spell-456' },
        data: expect.objectContaining({
          status: 'HELD',
          simulationScore: 'RED',
          conflictStatus: null,
        }),
      })
    })

    it('reports viem-fallback mode when no KeeperHub key is configured', () => {
      expect(projector.oracleMode).toBe('viem-fallback')
    })

    it('reads USDS supply via viem when the oracle is unconfigured', async () => {
      mockClient.readContract.mockResolvedValue(6_000_000_000n * 10n ** 18n)
      const out = await projector.getUsdsTotalSupplyWithSource()
      expect(out.value).toBeCloseTo(6_000_000_000, 0)
      expect(out.viaKeeperHub).toBe(false)
    })

    it('reads Vat headroom via viem when the oracle is unconfigured', async () => {
      mockClient.readContract
        .mockResolvedValueOnce(600_000_000n * 10n ** 45n)
        .mockResolvedValueOnce(100_000_000n * 10n ** 45n)
      const out = await projector.getVatDebtHeadroomWithSource()
      expect(out.value).toBeCloseTo(500_000_000, 0)
      expect(out.viaKeeperHub).toBe(false)
    })

    it('reads Chainlink price via viem when the oracle is unconfigured', async () => {
      const updatedAt = Math.floor(Date.now() / 1000) - 60
      mockClient.readContract.mockResolvedValue([1n, 250000000000n, 1n, BigInt(updatedAt), 1n])
      const out = await projector.getChainlinkEthPriceWithSource()
      expect(out.value.price).toBeCloseTo(2500, 0)
      expect(out.viaKeeperHub).toBe(false)
    })
  })
})
})
