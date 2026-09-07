import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  extractParameterFingerprint,
  detectConflicts,
  ConflictDetector,
} from '../conflict-detector'
import type { SpellRecord } from '@prisma/client'

function createMockSpell(overrides: Partial<SpellRecord> = {}): SpellRecord {
  return {
    id: 'spell-' + Math.random().toString(36).slice(2, 9),
    spellAddress: '0x' + Math.random().toString(16).slice(2, 42).padStart(40, '0'),
    calledAt: new Date(),
    earliestExecution: new Date(),
    latestExecution: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    officeHoursActive: true,
    nextExecutionWindow: new Date('2026-09-08T15:00:00.000Z'),
    calldata: '0x',
    actions: [
      {
        target: '0x1111111111111111111111111111111111111111',
        signature: 'cast()',
        calldata: '0x',
        description: 'Update USDS stability fee and debt ceiling',
      },
    ],
    status: 'READY',
    simulationScore: 'GREEN',
    conflictStatus: null,
    conflictDetail: null,
    executedAt: null,
    txHash: null,
    gasUsed: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

describe('ConflictDetector', () => {
  describe('extractParameterFingerprint', () => {
    it('extracts stability_fee, debt_ceiling, and token_usds keywords', () => {
      const desc = 'Increase USDS stability fee and adjust debt ceiling line'
      const fp = extractParameterFingerprint(desc)

      expect(fp.has('stability_fee')).toBe(true)
      expect(fp.has('debt_ceiling')).toBe(true)
      expect(fp.has('token_usds')).toBe(true)
    })

    it('extracts savings_rate and token_dai from DSR descriptions', () => {
      const desc = 'Update DAI savings rate (DSR) to 6.5%'
      const fp = extractParameterFingerprint(desc)

      expect(fp.has('savings_rate')).toBe(true)
      expect(fp.has('token_dai')).toBe(true)
    })

    it('extracts reward_distribution from incentive text', () => {
      const desc = 'Configure Sky farming reward and incentive distribution'
      const fp = extractParameterFingerprint(desc)

      expect(fp.has('reward_distribution')).toBe(true)
    })

    it('extracts specific collateral ilk identifiers', () => {
      const desc = 'Adjust ETH-A duty and WBTC-A debt ceiling'
      const fp = extractParameterFingerprint(desc)

      expect(fp.has('ilk:eth-a')).toBe(true)
      expect(fp.has('ilk:wbtc-a')).toBe(true)
      expect(fp.has('stability_fee')).toBe(true)
      expect(fp.has('debt_ceiling')).toBe(true)
    })
  })

  describe('detectConflicts — PARAMETER_OVERLAP', () => {
    it('flags PARAMETER_OVERLAP when two spells modify the same parameter', () => {
      const spellA = createMockSpell({
        spellAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        actions: [{ target: '0x1', signature: 'cast()', calldata: '0x', description: 'Update USDS stability fee' }],
      })
      const spellB = createMockSpell({
        spellAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        actions: [{ target: '0x2', signature: 'cast()', calldata: '0x', description: 'Lower USDS stability fee on ETH-A' }],
      })

      const result = detectConflicts(spellA, [spellB])

      expect(result.hasConflict).toBe(true)
      const overlap = result.conflicts.find((c) => c.conflictType === 'PARAMETER_OVERLAP')
      expect(overlap).toBeDefined()
      expect(overlap?.conflictingSpellAddress).toBe(spellB.spellAddress)
      expect(overlap?.reason).toContain('stability_fee')
    })

    it('returns clear when two spells modify completely disjoint parameters', () => {
      const spellA = createMockSpell({
        spellAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        actions: [{ target: '0x1', signature: 'cast()', calldata: '0x', description: 'Update DAI savings rate (DSR)' }],
        nextExecutionWindow: new Date('2026-09-08T14:00:00.000Z'),
      })
      const spellB = createMockSpell({
        spellAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        actions: [{ target: '0x2', signature: 'cast()', calldata: '0x', description: 'Configure token rewards distribution' }],
        nextExecutionWindow: new Date('2026-09-08T18:00:00.000Z'), // 4 hours later
      })

      const result = detectConflicts(spellA, [spellB])

      expect(result.hasConflict).toBe(false)
      expect(result.conflicts.length).toBe(0)
    })
  })

  describe('detectConflicts — ORDERING_DEPENDENCY', () => {
    it('flags ORDERING_DEPENDENCY when spell B references spell A address', () => {
      const spellA = createMockSpell({
        spellAddress: '0x1111222233334444555566667777888899990000',
        actions: [{ target: '0x1', signature: 'cast()', calldata: '0x', description: 'Deploy new module' }],
        nextExecutionWindow: new Date('2026-09-08T14:00:00.000Z'),
      })
      const spellB = createMockSpell({
        spellAddress: '0xaaaabbbbccccddddeeeeffff0000111122223333',
        actions: [
          {
            target: '0x2',
            signature: 'cast()',
            calldata: '0x',
            description: 'Initialize module deployed by 0x1111222233334444555566667777888899990000',
          },
        ],
        nextExecutionWindow: new Date('2026-09-08T18:00:00.000Z'),
      })

      const result = detectConflicts(spellB, [spellA])

      expect(result.hasConflict).toBe(true)
      const dep = result.conflicts.find((c) => c.conflictType === 'ORDERING_DEPENDENCY')
      expect(dep).toBeDefined()
      expect(dep?.conflictingSpellAddress).toBe(spellA.spellAddress)
    })
  })

  describe('detectConflicts — RACE_CONDITION', () => {
    it('flags RACE_CONDITION when two READY spells execute within 2 hours of each other', () => {
      const spellA = createMockSpell({
        spellAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        actions: [{ target: '0x1', signature: 'cast()', calldata: '0x', description: 'DAI savings rate' }],
        nextExecutionWindow: new Date('2026-09-08T15:00:00.000Z'),
      })
      const spellB = createMockSpell({
        spellAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        actions: [{ target: '0x2', signature: 'cast()', calldata: '0x', description: 'Reward incentive rate' }],
        nextExecutionWindow: new Date('2026-09-08T15:45:00.000Z'), // 45 minutes apart
      })

      const result = detectConflicts(spellA, [spellB])

      expect(result.hasConflict).toBe(true)
      const race = result.conflicts.find((c) => c.conflictType === 'RACE_CONDITION')
      expect(race).toBeDefined()
      expect(race?.reason).toContain('within 2 hours')
    })

    it('does NOT flag RACE_CONDITION when execution windows are spaced > 2 hours apart', () => {
      const spellA = createMockSpell({
        spellAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        actions: [{ target: '0x1', signature: 'cast()', calldata: '0x', description: 'DAI savings rate' }],
        nextExecutionWindow: new Date('2026-09-08T14:00:00.000Z'),
      })
      const spellB = createMockSpell({
        spellAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        actions: [{ target: '0x2', signature: 'cast()', calldata: '0x', description: 'Reward incentive rate' }],
        nextExecutionWindow: new Date('2026-09-08T17:00:00.000Z'), // 3 hours apart
      })

      const result = detectConflicts(spellA, [spellB])

      const race = result.conflicts.find((c) => c.conflictType === 'RACE_CONDITION')
      expect(race).toBeUndefined()
    })

    it('does NOT flag RACE_CONDITION against an EXECUTED spell', () => {
      const spellA = createMockSpell({
        spellAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        status: 'READY',
        actions: [{ target: '0x1', signature: 'cast()', calldata: '0x', description: 'DAI savings rate' }],
        nextExecutionWindow: new Date('2026-09-08T15:00:00.000Z'),
      })
      const spellB = createMockSpell({
        spellAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        status: 'EXECUTED',
        actions: [{ target: '0x2', signature: 'cast()', calldata: '0x', description: 'Reward incentive rate' }],
        nextExecutionWindow: new Date('2026-09-08T15:10:00.000Z'),
      })

      const result = detectConflicts(spellA, [spellB])
      const race = result.conflicts.find((c) => c.conflictType === 'RACE_CONDITION')
      expect(race).toBeUndefined()
    })
  })

  describe('ConflictDetector service polling and database updates', () => {
    let mockPrisma: any
    let detector: ConflictDetector

    beforeEach(() => {
      mockPrisma = {
        spellRecord: {
          findMany: vi.fn(),
          findUnique: vi.fn(),
          update: vi.fn().mockResolvedValue({}),
        },
      }
      detector = new ConflictDetector(mockPrisma)
    })

    it('updates status to CONFLICT when conflict exists', async () => {
      const candidate = createMockSpell({
        id: 'candidate-1',
        spellAddress: '0x1111111111111111111111111111111111111111',
        actions: [{ target: '0x1', signature: 'cast()', calldata: '0x', description: 'USDS debt ceiling' }],
      })
      const conflicting = createMockSpell({
        id: 'conflicting-2',
        spellAddress: '0x2222222222222222222222222222222222222222',
        actions: [{ target: '0x1', signature: 'cast()', calldata: '0x', description: 'USDS debt ceiling' }],
      })

      mockPrisma.spellRecord.findUnique.mockResolvedValue(candidate)
      mockPrisma.spellRecord.findMany.mockResolvedValue([conflicting])

      await detector.checkSpell('candidate-1')

      expect(mockPrisma.spellRecord.update).toHaveBeenCalledWith({
        where: { id: 'candidate-1' },
        data: expect.objectContaining({
          status: 'CONFLICT',
          conflictStatus: 'CONFLICT',
        }),
      })
    })

    it('sets conflictStatus to CLEAR and keeps status READY when no conflict exists', async () => {
      const candidate = createMockSpell({
        id: 'candidate-1',
        spellAddress: '0x1111111111111111111111111111111111111111',
        actions: [{ target: '0x1', signature: 'cast()', calldata: '0x', description: 'DAI savings rate' }],
        nextExecutionWindow: new Date('2026-09-08T14:00:00.000Z'),
      })
      const other = createMockSpell({
        id: 'other-2',
        spellAddress: '0x2222222222222222222222222222222222222222',
        actions: [{ target: '0x2', signature: 'cast()', calldata: '0x', description: 'Reward distribution' }],
        nextExecutionWindow: new Date('2026-09-08T18:00:00.000Z'),
      })

      mockPrisma.spellRecord.findUnique.mockResolvedValue(candidate)
      mockPrisma.spellRecord.findMany.mockResolvedValue([other])

      await detector.checkSpell('candidate-1')

      expect(mockPrisma.spellRecord.update).toHaveBeenCalledWith({
        where: { id: 'candidate-1' },
        data: expect.objectContaining({
          conflictStatus: 'CLEAR',
        }),
      })
    })
  })
})
