import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  extractParameterFingerprint,
  extractSelector,
  extractStructuralFingerprint,
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

    it('does NOT trigger on bare words without governance context', () => {
      expect(extractParameterFingerprint('Keep everything in line for launch').has('debt_ceiling')).toBe(false)
      expect(extractParameterFingerprint('Deploy the yoga mat contract').has('collateral_ratio')).toBe(false)
      expect(extractParameterFingerprint('Team is off duty this week').has('stability_fee')).toBe(false)
    })

    it('indexes action targets without treating them as parameter overlap', () => {
      const fpA = extractParameterFingerprint('noop', [
        { target: '0x1111111111111111111111111111111111111111', signature: 'cast()', description: 'noop' },
      ])
      const fpB = extractParameterFingerprint('noop', [
        { target: '0x2222222222222222222222222222222222222222', signature: 'cast()', description: 'noop' },
      ])
      expect(fpA.has('target:0x1111111111111111111111111111111111111111')).toBe(true)
      // Same sig/target shape alone must not count as overlap — verified in detectConflicts
      expect([...fpA].filter((p) => !p.startsWith('target:') && !p.startsWith('sig:') && fpB.has(p)).length).toBe(0)
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
    it('does NOT block on timing alone — disjoint params within 2h is WARNING only', () => {
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

      // Timing proximity alone must not deadlock the queue
      expect(result.hasConflict).toBe(false)
      const race = result.conflicts.find((c) => c.conflictType === 'RACE_CONDITION')
      expect(race).toBeDefined()
      expect(race?.severity).toBe('WARNING')
      expect(result.warnings.length).toBe(1)
    })

    it('escalates RACE to BLOCKING when the pair also shares parameters', () => {
      const spellA = createMockSpell({
        spellAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        actions: [{ target: '0x1', signature: 'cast()', calldata: '0x', description: 'Update USDS stability fee' }],
        nextExecutionWindow: new Date('2026-09-08T15:00:00.000Z'),
      })
      const spellB = createMockSpell({
        spellAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        actions: [{ target: '0x2', signature: 'cast()', calldata: '0x', description: 'Lower USDS stability fee' }],
        nextExecutionWindow: new Date('2026-09-08T15:45:00.000Z'),
      })

      const result = detectConflicts(spellA, [spellB])

      expect(result.hasConflict).toBe(true)
      const race = result.conflicts.find((c) => c.conflictType === 'RACE_CONDITION')
      expect(race?.severity).toBe('BLOCKING')
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

  describe('detectConflicts — STRUCTURAL overlap (decoded calldata)', () => {
    it('extracts selectors without throwing on garbage', () => {
      expect(extractSelector('0x12345678abcdef')).toBe('selector:0x12345678')
      expect(extractSelector('0x')).toBeNull()
      expect(extractSelector('not-hex')).toBeNull()
      expect(extractSelector(undefined)).toBeNull()
      expect(extractSelector(42 as any)).toBeNull()
    })

    it('fingerprints targets, selectors, and function names', () => {
      const fp = extractStructuralFingerprint('0xdeadbeef0011', [
        { target: '0x1111111111111111111111111111111111111111', signature: 'File(bytes32,bytes32,uint256)', calldata: '0x29ae81140001' },
      ])
      expect(fp.has('selector:0xdeadbeef')).toBe(true)
      expect(fp.has('target:0x1111111111111111111111111111111111111111')).toBe(true)
      expect(fp.has('selector:0x29ae8114')).toBe(true)
      expect(fp.has('fn:file')).toBe(true)
    })

    it('flags BLOCKING overlap when spells touch the same contract with unrelated descriptions', () => {
      const spellA = createMockSpell({
        spellAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        calldata: '0x12345678',
        actions: [{ target: '0x9999999999999999999999999999999999999999', signature: 'poke()', calldata: '0x', description: 'Routine maintenance task alpha' }],
        nextExecutionWindow: new Date('2026-09-08T14:00:00.000Z'),
      })
      const spellB = createMockSpell({
        spellAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        calldata: '0xabcdef99',
        actions: [{ target: '0x9999999999999999999999999999999999999999', signature: 'poke()', calldata: '0x', description: 'Entirely different quarterly review' }],
        nextExecutionWindow: new Date('2026-09-08T18:00:00.000Z'), // 4h apart: no race involved
      })

      const result = detectConflicts(spellA, [spellB])

      expect(result.hasConflict).toBe(true)
      const overlap = result.conflicts.find((c) => c.conflictType === 'PARAMETER_OVERLAP')
      expect(overlap).toBeDefined()
      expect(overlap?.severity).toBe('BLOCKING')
      expect(overlap?.details?.structuralOverlap).toContain('target:0x9999999999999999999999999999999999999999')
    })

    it('stays clear when targets, selectors, and params are all disjoint', () => {
      const spellA = createMockSpell({
        spellAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        calldata: '0x11111111',
        actions: [{ target: '0x1111111111111111111111111111111111111111', signature: 'aaa()', calldata: '0x', description: 'Update DAI savings rate (DSR)' }],
        nextExecutionWindow: new Date('2026-09-08T14:00:00.000Z'),
      })
      const spellB = createMockSpell({
        spellAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        calldata: '0x22222222',
        actions: [{ target: '0x2222222222222222222222222222222222222222', signature: 'bbb()', calldata: '0x', description: 'Configure token rewards distribution' }],
        nextExecutionWindow: new Date('2026-09-08T18:00:00.000Z'),
      })

      const result = detectConflicts(spellA, [spellB])

      expect(result.hasConflict).toBe(false)
      expect(result.conflicts.length).toBe(0)
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
