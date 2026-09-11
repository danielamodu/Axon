import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ExecutionEngine } from '../executor.js'
import { NotificationDispatcher } from '../notifications.js'
import { RegistryWriter } from '../registry-writer.js'
import type { SpellRecord } from '@prisma/client'

describe('Phase 8 — KeeperHub Execution Depth & Verification', () => {
  let mockPrisma: any
  let mockPublicClient: any
  let mockNotify: any
  let mockRegistry: any

  const dummySpell: SpellRecord = {
    id: 'spell-uuid-8888',
    protocol: 'sky',
    spellAddress: '0x900c952c676595DdB392FA6349aD5f0674a67Eeb',
    proposalId: 'prop-88',
    status: 'READY',
    simulationScore: 'GREEN',
    conflictStatus: 'CLEAR',
    officeHoursActive: false,
    nextExecutionWindow: null,
    calledAt: new Date(),
    executedAt: null,
    txHash: null,
    gasUsed: null,
    actions: [],
    conflictDetail: null,
    keeperHubExecutionId: null,
    keeperHubWorkflowId: null,
    keeperHubAuditLog: null,
    keeperHubStatus: null,
    x402PaymentTxHash: null,
    x402AmountUsdc: null,
    x402SettledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  beforeEach(() => {
    mockPrisma = {
      spellRecord: {
        findUnique: vi.fn().mockResolvedValue(dummySpell),
        findFirst: vi.fn().mockResolvedValue(dummySpell),
        update: vi.fn().mockResolvedValue(dummySpell),
      },
      executionPayment: {
        create: vi.fn().mockResolvedValue({ id: 'pay-1' }),
        findUnique: vi.fn(),
      },
      organisation: {
        update: vi.fn().mockResolvedValue({ id: 'org-1' }),
      },
    }
    mockPublicClient = {
      readContract: vi.fn().mockResolvedValue('0x900c952c676595DdB392FA6349aD5f0674a67Eeb'),
      simulateContract: vi.fn().mockResolvedValue({ request: {} }),
    }
    mockNotify = {
      notifyExecutionStarted: vi.fn().mockResolvedValue(undefined),
      notifyExecutionSucceeded: vi.fn().mockResolvedValue(undefined),
      notifyExecutionFailed: vi.fn().mockResolvedValue(undefined),
      notifySimulationFailed: vi.fn().mockResolvedValue(undefined),
    }
    mockRegistry = {
      log: vi.fn().mockResolvedValue({ txHash: '0xregistrytx', blockNumber: 100n, simulated: true }),
    }
  })

  it('getExecution returns structured execution record for local/sentinel executions', async () => {
    const engine = new ExecutionEngine(mockPublicClient, mockPrisma, mockNotify, undefined, mockRegistry)
    const result = await engine.getExecution('local-exec-1234')

    expect(result).toBeDefined()
    expect(result.executionId).toBe('local-exec-1234')
    expect(result.status).toBe('completed')
    expect(result.auditLog).toBeInstanceOf(Array)
    expect(result.auditLog.length).toBeGreaterThanOrEqual(4)
  })

  it('getExecution handles gateway-exec sentinels with audit entries', async () => {
    const engine = new ExecutionEngine(mockPublicClient, mockPrisma, mockNotify, undefined, mockRegistry)
    const result = await engine.getExecution('gateway-exec-5678')

    expect(result.status).toBe('completed')
    expect(result.txHash).toBeDefined()
    const nodeNames = result.auditLog.map((l: any) => l.node)
    expect(nodeNames).toContain('read-hat')
    expect(nodeNames).toContain('execute-cast')
    expect(nodeNames).toContain('notify-discord-success')
  })

  it('buildAndRegisterWorkflow constructs workflow with notification nodes 4a and 8', async () => {
    const mockKhClient: any = {
      createWorkflow: vi.fn().mockResolvedValue({ id: 'wf-mock-id' }),
      rawRequest: vi.fn().mockResolvedValue({ ok: true, result: { valid: true } }),
    }
    const engine = new ExecutionEngine(mockPublicClient, mockPrisma, mockNotify, mockKhClient, mockRegistry)

    const wfId = await engine.buildAndRegisterWorkflow(dummySpell)
    expect(wfId).toBe('wf-mock-id')
    expect(mockKhClient.createWorkflow).toHaveBeenCalledOnce()

    const createCall = mockKhClient.createWorkflow.mock.calls[0][0]
    const nodeIds = createCall.nodes.map((n: any) => n.id)

    expect(nodeIds).toContain('notify-discord-sim-failure')
    expect(nodeIds).toContain('notify-discord-success')
    expect(nodeIds.length).toBe(10) // 10 nodes including trigger and failure branch
  })

  it('buildAndRegisterWorkflow routes check-simulation false branch to discord failure node', async () => {
    const mockKhClient: any = {
      createWorkflow: vi.fn().mockResolvedValue({ id: 'wf-branch-id' }),
      rawRequest: vi.fn().mockResolvedValue({ ok: true, result: { valid: true } }),
    }
    const engine = new ExecutionEngine(mockPublicClient, mockPrisma, mockNotify, mockKhClient, mockRegistry)
    await engine.buildAndRegisterWorkflow(dummySpell)

    const createCall = mockKhClient.createWorkflow.mock.calls[0][0]
    const failureEdge = createCall.edges.find((e: any) => e.target === 'notify-discord-sim-failure')

    expect(failureEdge).toBeDefined()
    expect(failureEdge.source).toBe('check-simulation')
    expect(failureEdge.sourceHandle).toBe('false')
  })

  it('publishWorkflow records keeperHubWorkflowId to database and logs announcement', async () => {
    const engine = new ExecutionEngine(mockPublicClient, mockPrisma, mockNotify, undefined, mockRegistry)
    await engine.publishWorkflow('wf-pub-test', dummySpell)

    expect(mockPrisma.spellRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: dummySpell.id },
        data: { keeperHubWorkflowId: 'wf-pub-test' },
      })
    )
  })

  it('executeSpell stores keeperHubExecutionId and auditLog on SpellRecord', async () => {
    const engine = new ExecutionEngine(mockPublicClient, mockPrisma, mockNotify, undefined, mockRegistry)
    const result = await engine.executeSpell(dummySpell)

    expect(result.status).toBe('EXECUTED')
    expect(result.keeperHubExecutionId).toBeDefined()

    expect(mockPrisma.spellRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          keeperHubExecutionId: expect.any(String),
          keeperHubStatus: 'completed',
        }),
      })
    )
  })

  it('executeSpell skips Base RegistryWriter in dry-run mode (no forged proofs)', async () => {
    const engine = new ExecutionEngine(mockPublicClient, mockPrisma, mockNotify, undefined, mockRegistry)
    const result = await engine.executeSpell(dummySpell)

    expect(result.status).toBe('EXECUTED')
    expect(result.dryRun).toBe(true)
    expect(mockRegistry.log).not.toHaveBeenCalled()
  })

  it('executeSpell passes keeperHubExecutionId to Base RegistryWriter in live mode', async () => {    const mockKhClient: any = {
      createWorkflow: vi.fn().mockResolvedValue({ id: 'wf-live' }),
      rawRequest: vi.fn().mockResolvedValue({ ok: true, result: { valid: true } }),
      executeWorkflow: vi.fn().mockResolvedValue({ executionId: 'kh-exec-live-1' }),
      getExecutionStatus: vi.fn().mockResolvedValue({ status: 'success' }),
      getExecutionLogs: vi.fn().mockResolvedValue({
        data: [{ output: { transactionHash: '0xlive-tx-hash', gasUsed: '21000' } }],
      }),
    }
    const engine = new ExecutionEngine(mockPublicClient, mockPrisma, mockNotify, mockKhClient, mockRegistry)
    const result = await engine.executeSpell(dummySpell)

    expect(result.status).toBe('EXECUTED')
    expect(result.dryRun).toBe(false)
    expect(mockRegistry.log).toHaveBeenCalledWith(
      expect.objectContaining({
        keeperHubExecutionId: expect.stringMatching(/^(kh-exec-|gateway-exec-|local-exec-)/),
      })
    )
  }, 30000)

  it('RegistryWriter logs no-op when unconfigured or invalid address', async () => {
    const rw = new RegistryWriter(undefined, undefined, undefined)
    const result = await rw.log({
      protocol: '0x0a3f6849f78076aefaDf113F5BED87720274dDC0',
      spellAddress: '0x900c952c676595DdB392FA6349aD5f0674a67Eeb',
      actionType: 'GOVERNANCE_CAST',
      txHash: '0x1111222233334444555566667777888899990000111122223333444455556666',
      executedAt: new Date(),
      gasUsed: 150000n,
      executor: '0x0a3f6849f78076aefaDf113F5BED87720274dDC0',
      simulationScore: 2,
      keeperHubExecutionId: 'exec_kh_live_12345',
    })

    expect(result).toBeNull()
  })

  it('NotificationDispatcher formats payment settled Discord embed', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, text: async () => '' } as any)
    const dispatcher = new NotificationDispatcher('https://discord.example.com/webhook')
    const origFetch = global.fetch
    ;(global as any).fetch = fetchSpy

    await dispatcher.notifyPaymentSettled({
      spellAddress: '0x900c952c676595DdB392FA6349aD5f0674a67Eeb',
      feeUsdc: 0.05,
      txHash: '0xpaymenttx1234',
      settledAt: new Date(),
    })

    ;(global as any).fetch = origFetch

    expect(fetchSpy).toHaveBeenCalledOnce()
    const [, opts] = fetchSpy.mock.calls[0]
    const body = JSON.parse(opts.body)
    expect(body.embeds[0].title).toContain('Payment Settled')
    expect(body.embeds[0].fields.some((f: any) => f.value.includes('0.05 USDC'))).toBe(true)
  })

  it('NotificationDispatcher formats low balance alert Discord embed', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, text: async () => '' } as any)
    const dispatcher = new NotificationDispatcher('https://discord.example.com/webhook')
    const origFetch = global.fetch
    ;(global as any).fetch = fetchSpy

    await dispatcher.notifyLowBalance({
      orgName: 'Sky Operations',
      balanceUsdc: 0.02,
    })

    ;(global as any).fetch = origFetch

    expect(fetchSpy).toHaveBeenCalledOnce()
    const [, opts] = fetchSpy.mock.calls[0]
    const body = JSON.parse(opts.body)
    expect(body.embeds[0].title).toContain('Low USDC Balance')
    expect(body.embeds[0].color).toBe(0xf1c40f)
  })
})

