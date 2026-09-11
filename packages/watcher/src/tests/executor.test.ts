import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ExecutionEngine } from '../executor'
import { NotificationDispatcher } from '../notifications'
import type { PublicClient } from 'viem'
import type { PrismaClient, SpellRecord } from '@prisma/client'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockSpell(overrides: Partial<SpellRecord> = {}): SpellRecord {
  const now = new Date()
  const windowOpen = new Date(now.getTime() - 5 * 60_000) // 5 minutes ago — window is open
  return {
    id: 'spell-' + Math.random().toString(36).slice(2, 9),
    spellAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    calledAt: now,
    earliestExecution: windowOpen,
    latestExecution: new Date(now.getTime() + 29 * 24 * 3600_000),
    officeHoursActive: false, // disable for unit tests so we can control timing
    nextExecutionWindow: windowOpen,
    calldata: '0x',
    actions: [{ target: '0x1', signature: 'cast()', calldata: '0x', description: 'Test governance action' }],
    status: 'READY',
    simulationScore: 'GREEN',
    conflictStatus: 'CLEAR',
    conflictDetail: null,
    executedAt: null,
    txHash: null,
    gasUsed: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMocks() {
  const mockClient: any = {
    readContract: vi.fn().mockResolvedValue('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
    simulateContract: vi.fn().mockResolvedValue({ result: undefined }),
  }

  const mockPrisma: any = {
    spellRecord: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
  }

  const mockNotify = {
    notifyExecutionStarted: vi.fn().mockResolvedValue(undefined),
    notifyExecutionSucceeded: vi.fn().mockResolvedValue(undefined),
    notifyExecutionFailed: vi.fn().mockResolvedValue(undefined),
    notifySimulationFailed: vi.fn().mockResolvedValue(undefined),
    notifyConflictDetected: vi.fn().mockResolvedValue(undefined),
    notifyTimeoutWarning: vi.fn().mockResolvedValue(undefined),
  } as unknown as NotificationDispatcher

  return { mockClient, mockPrisma, mockNotify }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ExecutionEngine', () => {
  let mockClient: any
  let mockPrisma: any
  let mockNotify: NotificationDispatcher
  let engine: ExecutionEngine

  beforeEach(() => {
    const mocks = createMocks()
    mockClient = mocks.mockClient
    mockPrisma = mocks.mockPrisma
    mockNotify = mocks.mockNotify

    // No KeeperHub API key — dry-run mode
    engine = new ExecutionEngine(
      mockClient as unknown as PublicClient,
      mockPrisma as unknown as PrismaClient,
      mockNotify,
      undefined // no API key → dry-run
    )
  })

  describe('poll — spell selection', () => {
    it('returns null when no READY+CLEAR spells have open windows', async () => {
      mockPrisma.spellRecord.findFirst.mockResolvedValue(null)

      const result = await engine.poll()
      expect(result).toBeNull()
    })

    it('picks the oldest READY+CLEAR spell with an open window', async () => {
      const spell = createMockSpell()
      mockPrisma.spellRecord.findFirst.mockResolvedValue(spell)

      // Spy on executeSpell to avoid running the full pipeline
      vi.spyOn(engine, 'executeSpell').mockResolvedValue({
        spellAddress: spell.spellAddress,
        workflowId: 'test-wf',
        executionId: 'test-exec',
        status: 'EXECUTED',
        retryCount: 0,
      })

      const result = await engine.poll()
      expect(result).toEqual(spell)
      expect(engine.executeSpell).toHaveBeenCalledWith(spell, 0)
    })

    it('does NOT execute when officeHoursActive=true and current time is outside window', async () => {
      // Force a spell with officeHoursActive = true. The test runs outside Mon-Fri 14:00-21:00 UTC
      // in most CI environments, so we can rely on that, OR we override time.
      // Here we check the guard returns null by using a Saturday.
      const spell = createMockSpell({ officeHoursActive: true })
      mockPrisma.spellRecord.findFirst.mockResolvedValue(spell)

      // Spy on isWithinOfficeHours by mocking Date to a Sunday at noon
      const SundayNoon = new Date('2026-09-06T12:00:00.000Z') // Sunday
      const dateSpy = vi.spyOn(global, 'Date').mockImplementation((arg?: any) => {
        if (arg === undefined) return SundayNoon as any
        return new (Function.prototype.bind.apply(Date, [null, arg]))() as any
      })

      const executeSpy = vi.spyOn(engine, 'executeSpell')
      const result = await engine.poll()

      dateSpy.mockRestore()

      // On Sunday at noon, office hours are NOT active — expect null, no execution
      expect(result).toBeNull()
      expect(executeSpy).not.toHaveBeenCalled()
    })
  })

  describe('runPreflightSimulation', () => {
    it('returns success=true when viem simulateContract does not throw', async () => {
      mockClient.simulateContract.mockResolvedValue({ result: undefined })

      const result = await engine.runPreflightSimulation('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')

      expect(result.success).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('returns success=false when viem simulateContract throws a revert', async () => {
      mockClient.simulateContract.mockRejectedValue(
        Object.assign(new Error('execution reverted'), { shortMessage: 'ds-pause-delay-not-expired' })
      )

      const result = await engine.runPreflightSimulation('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')

      expect(result.success).toBe(false)
      expect(result.error).toContain('ds-pause-delay-not-expired')
    })
  })

  describe('guardCheckHat', () => {
    it('returns true when Chief.hat() matches the spell address', async () => {
      const addr = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      mockClient.readContract.mockResolvedValue(addr)

      const result = await engine.guardCheckHat(addr)
      expect(result).toBe(true)
    })

    it('returns false when Chief.hat() is a different address', async () => {
      mockClient.readContract.mockResolvedValue('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')

      const result = await engine.guardCheckHat('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
      expect(result).toBe(false)
    })

    it('returns false and does not throw when readContract fails', async () => {
      mockClient.readContract.mockRejectedValue(new Error('RPC unavailable'))

      const result = await engine.guardCheckHat('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
      expect(result).toBe(false)
    })

    it('is case-insensitive when comparing addresses', async () => {
      // Exact same address but returned in uppercase by readContract (some RPCs do this)
      mockClient.readContract.mockResolvedValue('0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
      const result = await engine.guardCheckHat('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
      expect(result).toBe(true)
    })
  })

  describe('executeSpell — full pipeline', () => {
    it('transitions EXECUTING -> EXECUTED on successful dry-run', async () => {
      const spell = createMockSpell()
      mockPrisma.spellRecord.findUnique.mockResolvedValue(spell)

      // Hat check — confirms spell is hat
      mockClient.readContract.mockResolvedValue(spell.spellAddress)
      // Simulation passes
      mockClient.simulateContract.mockResolvedValue({ result: undefined })

      const report = await engine.executeSpell(spell, 0)

      expect(report.status).toBe('EXECUTED')
      expect(report.retryCount).toBe(0)
      expect(report.txHash).toMatch(/^0xdryrun/)

      // Confirm EXECUTING was written
      expect(mockPrisma.spellRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'EXECUTING' }) })
      )
      // Confirm EXECUTED was written
      expect(mockPrisma.spellRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'EXECUTED' }) })
      )
    })

    it('marks dry-run reports and never writes registry proofs for them', async () => {
      const spell = createMockSpell()
      mockPrisma.spellRecord.findUnique.mockResolvedValue(spell)
      mockClient.readContract.mockResolvedValue(spell.spellAddress)
      mockClient.simulateContract.mockResolvedValue({ result: undefined })

      const mockRegistryWriter = { log: vi.fn().mockResolvedValue(null) }
      const dryEngine = new ExecutionEngine(
        mockClient as unknown as PublicClient,
        mockPrisma as unknown as PrismaClient,
        mockNotify,
        undefined, // no API key → dry-run
        mockRegistryWriter as unknown as import('../registry-writer').RegistryWriter
      )

      const report = await dryEngine.executeSpell(spell, 0)

      expect(report.status).toBe('EXECUTED')
      expect(report.dryRun).toBe(true)
      // A dry-run must never forge an onchain proof
      expect(mockRegistryWriter.log).not.toHaveBeenCalled()
    })

    it('transitions to HELD and notifies when pre-flight simulation fails', async () => {
      const spell = createMockSpell()

      mockClient.simulateContract.mockRejectedValue(
        Object.assign(new Error('revert'), { shortMessage: 'ds-spell-already-cast' })
      )

      const report = await engine.executeSpell(spell, 0)

      expect(report.status).toBe('FAILED')
      expect(mockPrisma.spellRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'HELD' }) })
      )
      expect(mockNotify.notifySimulationFailed).toHaveBeenCalledWith(
        expect.objectContaining({ spellAddress: spell.spellAddress, phase: 'pre-execution' })
      )
    })

    it('marks EXECUTED and does not cast when guard check finds spell is not the hat', async () => {
      const spell = createMockSpell()

      // Simulation passes
      mockClient.simulateContract.mockResolvedValue({})
      // Hat is different address
      mockClient.readContract.mockResolvedValue('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')

      const report = await engine.executeSpell(spell, 0)

      expect(report.status).toBe('EXECUTED')
      // Should have set EXECUTED (superseded) immediately — NOT gone through EXECUTING
      const lastUpdate = (mockPrisma.spellRecord.update as ReturnType<typeof vi.fn>).mock.calls.at(-1)
      expect(lastUpdate[0].data).toMatchObject({ status: 'EXECUTED' })
    })

    it('notifies execution started once workflow is created', async () => {
      const spell = createMockSpell()
      mockClient.readContract.mockResolvedValue(spell.spellAddress)
      mockClient.simulateContract.mockResolvedValue({})

      await engine.executeSpell(spell, 0)

      expect(mockNotify.notifyExecutionStarted).toHaveBeenCalledWith(
        expect.objectContaining({ spellAddress: spell.spellAddress })
      )
    })

    it('notifies execution succeeded with txHash on dry-run success', async () => {
      const spell = createMockSpell()
      mockClient.readContract.mockResolvedValue(spell.spellAddress)
      mockClient.simulateContract.mockResolvedValue({})

      await engine.executeSpell(spell, 0)

      expect(mockNotify.notifyExecutionSucceeded).toHaveBeenCalledWith(
        expect.objectContaining({ spellAddress: spell.spellAddress })
      )
    })
  })

  describe('buildAndRegisterWorkflow — dry-run mode', () => {
    it('returns a local-workflow sentinel ID when no KeeperHub key is set', async () => {
      const spell = createMockSpell()
      const id = await engine.buildAndRegisterWorkflow(spell)
      expect(id).toMatch(/^local-workflow-/)
    })
  })

  describe('pollForConfirmation — dry-run mode', () => {
    it('returns EXECUTED with a dry-run txHash in dry-run mode', async () => {
      const result = await engine.pollForConfirmation(
        '0xaabbcc',
        'local-workflow-1234',
        'local-exec-12345'
      )
      expect(result.status).toBe('EXECUTED')
      expect(result.txHash).toMatch(/^0xdryrun/)
    })
  })
})

describe('NotificationDispatcher', () => {
  it('logs notifications without throwing when Discord webhook is not configured', async () => {
    const dispatcher = new NotificationDispatcher(undefined)

    // None of these should throw
    await expect(
      dispatcher.notifyExecutionStarted({
        spellAddress: '0xaaa',
        description: 'Test spell',
        executionWindow: new Date(),
        workflowId: 'wf-test',
      })
    ).resolves.toBeUndefined()

    await expect(
      dispatcher.notifyExecutionSucceeded({
        spellAddress: '0xaaa',
        txHash: '0xtxhash',
        gasUsed: '150000',
        executedAt: new Date(),
      })
    ).resolves.toBeUndefined()

    await expect(
      dispatcher.notifyExecutionFailed({
        spellAddress: '0xaaa',
        error: 'Test error',
        retryCount: 1,
      })
    ).resolves.toBeUndefined()
  })

  it('sends a correctly formatted Discord embed on failure notification', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, text: async () => '' } as any)
    const dispatcher = new NotificationDispatcher('https://discord.example.com/webhook')
    // Override global fetch for this test
    const origFetch = global.fetch
    ;(global as any).fetch = fetchSpy

    await dispatcher.notifyExecutionFailed({
      spellAddress: '0xaaaa',
      error: 'Simulated revert',
      retryCount: 1,
    })

    ;(global as any).fetch = origFetch

    expect(fetchSpy).toHaveBeenCalledOnce()
    const [url, opts] = fetchSpy.mock.calls[0]
    expect(url).toBe('https://discord.example.com/webhook')
    const body = JSON.parse(opts.body)
    expect(body.embeds).toHaveLength(1)
    expect(body.embeds[0].title).toContain('❌ Execution Failed')
    expect(body.embeds[0].color).toBe(0xe74c3c)
  })

  it('skips direct Discord embed on success notification (handled by KeeperHub node 8)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, text: async () => '' } as any)
    const dispatcher = new NotificationDispatcher('https://discord.example.com/webhook')
    const origFetch = global.fetch
    ;(global as any).fetch = fetchSpy

    await dispatcher.notifyExecutionSucceeded({
      spellAddress: '0xaaaa',
      txHash: '0xtx1234',
      gasUsed: '200000',
      executedAt: new Date(),
    })

    ;(global as any).fetch = origFetch

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('suppresses Discord delivery failure without throwing', async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error('Network error'))
    const dispatcher = new NotificationDispatcher('https://discord.example.com/webhook')
    const origFetch = global.fetch
    ;(global as any).fetch = fetchSpy

    await expect(
      dispatcher.send({
        title: 'Test',
        description: 'Should not throw',
        color: 'red',
      })
    ).resolves.toBeUndefined()

    ;(global as any).fetch = origFetch
  })
})
