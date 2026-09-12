import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { WebhookServer } from '../webhook-server'
import { withNodeTags, AXON_NODE_TAGS } from '../executor'

function mockPrisma() {
  return {
    spellRecord: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn().mockImplementation(async (args: any) => ({ id: 's1', status: args.data.status ?? 'EXECUTING', spellAddress: '0xspell' })),
      create: vi.fn().mockImplementation(async (args: any) => ({ id: 'new-1', ...args.data })),
    },
  }
}

async function startServer(prisma: any, writer?: any): Promise<{ ws: WebhookServer; base: string }> {
  const ws = new WebhookServer(
    writer ?? { log: vi.fn().mockResolvedValue('0xbase'), isConfigured: false },
    0,
    prisma
  )
  await ws.start()
  const port = (ws as any).server.address().port
  return { ws, base: `http://127.0.0.1:${port}` }
}

describe('WebhookServer KeeperHub sync (F2)', () => {
  let prisma: any
  let ws: WebhookServer | null = null
  let base = ''
  const oldSecret = process.env.AXON_WEBHOOK_SECRET

  beforeEach(async () => {
    delete process.env.AXON_WEBHOOK_SECRET
    prisma = mockPrisma()
    const started = await startServer(prisma)
    ws = started.ws
    base = started.base
  })

  afterEach(async () => {
    if (oldSecret !== undefined) process.env.AXON_WEBHOOK_SECRET = oldSecret
    else delete process.env.AXON_WEBHOOK_SECRET
    if (ws) await ws.stop()
    ws = null
  })

  const post = (path: string, body: any, headers: Record<string, string> = {}) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })

  it('maps workflow started → EXECUTING', async () => {
    prisma.spellRecord.findFirst.mockResolvedValue({ id: 's1', spellAddress: '0xspell', status: 'READY' })
    const res = await post('/webhook/keeperhub', {
      workflowId: 'wf-1',
      executionId: 'ex-1',
      stage: 'started',
    })
    expect(res.status).toBe(200)
    expect(prisma.spellRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'EXECUTING' }) })
    )
  })

  it('stores txHash on cast node_complete without changing state away from EXECUTING', async () => {
    prisma.spellRecord.findFirst.mockResolvedValue({ id: 's1', spellAddress: '0xspell', status: 'EXECUTING' })
    const res = await post('/webhook/keeperhub', {
      workflowId: 'wf-1',
      executionId: 'ex-1',
      stage: 'node_complete',
      nodeId: 5,
      nodeName: 'axon:governance-execution',
      output: { transactionHash: '0xcasttx' },
    })
    expect(res.status).toBe(200)
    expect(prisma.spellRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ txHash: '0xcasttx' }) })
    )
  })

  it('maps workflow completed → EXECUTED', async () => {
    prisma.spellRecord.findFirst.mockResolvedValue({ id: 's1', spellAddress: '0xspell', status: 'EXECUTING' })
    const res = await post('/webhook/keeperhub', {
      workflowId: 'wf-1',
      executionId: 'ex-1',
      stage: 'completed',
      timestamp: new Date().toISOString(),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('EXECUTED')
  })

  it('maps workflow failed → FAILED', async () => {
    prisma.spellRecord.findFirst.mockResolvedValue({ id: 's1', spellAddress: '0xspell', status: 'EXECUTING' })
    const res = await post('/webhook/keeperhub', {
      workflowId: 'wf-1',
      executionId: 'ex-1',
      stage: 'failed',
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('FAILED')
  })

  it('rejects unknown stages and unknown workflows', async () => {
    prisma.spellRecord.findFirst.mockResolvedValue({ id: 's1', spellAddress: '0xspell', status: 'READY' })
    const bad = await post('/webhook/keeperhub', { workflowId: 'wf-1', executionId: 'ex-1', stage: 'nope' })
    expect(bad.status).toBe(400)

    prisma.spellRecord.findFirst.mockResolvedValue(null)
    const missing = await post('/webhook/keeperhub', { workflowId: 'wf-x', executionId: 'ex-1', stage: 'started' })
    expect(missing.status).toBe(404)
  })

  it('creates a QUEUED spell on first scheduler detection', async () => {
    prisma.spellRecord.findUnique.mockResolvedValue(null)
    const res = await post('/webhook/hat-change', {
      protocolId: 'sky',
      newHat: '0xnewhat000000000000000000000000000000000001',
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.deduplicated).toBe(false)
    expect(prisma.spellRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'QUEUED',
          detectionSource: 'keeperhub-scheduler',
        }),
      })
    )
  })

  it('deduplicates when the watcher already recorded the hat', async () => {
    prisma.spellRecord.findUnique.mockResolvedValue({ id: 's9', detectionSource: 'watcher' })
    const res = await post('/webhook/hat-change', {
      protocolId: 'sky',
      newHat: '0xexistinghat00000000000000000000000000000002',
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.deduplicated).toBe(true)
    expect(body.detectionSource).toBe('both')
    expect(prisma.spellRecord.create).not.toHaveBeenCalled()
  })

  it('enforces the shared secret when configured', async () => {
    process.env.AXON_WEBHOOK_SECRET = 's3cret'
    const denied = await post('/webhook/keeperhub', { workflowId: 'wf-1', stage: 'started' })
    expect(denied.status).toBe(401)
    const allowed = await post(
      '/webhook/keeperhub',
      { workflowId: 'wf-1', executionId: 'ex-1', stage: 'started' },
      { 'x-webhook-secret': 's3cret' }
    )
    prisma.spellRecord.findFirst.mockResolvedValue({ id: 's1', spellAddress: '0xspell', status: 'READY' })
    expect([200, 404]).toContain(allowed.status)
  })
})

describe('KeeperHub node tags (F2)', () => {
  it('attaches human-readable axon: tags to every pipeline node', () => {
    const nodes = withNodeTags([
      { id: 'trigger', type: 'trigger', data: { label: 't', type: 'manual', config: {} }, position: { x: 0, y: 0 } },
      { id: 'execute-cast', type: 'action', data: { label: 'e', type: 'web3/write-contract', config: {} }, position: { x: 0, y: 0 } },
      { id: 'notify-discord-success', type: 'action', data: { label: 'n', type: 'notification/discord', config: {} }, position: { x: 0, y: 0 } },
    ])
    expect((nodes[0].data as any).tags).toEqual(['axon:workflow-trigger'])
    expect((nodes[1].data as any).tags).toEqual(['axon:governance-execution'])
    expect((nodes[2].data as any).tags).toEqual(['axon:notify-success'])
  })

  it('covers the full pipeline tag map', () => {
    expect(Object.keys(AXON_NODE_TAGS)).toHaveLength(11)
    expect(AXON_NODE_TAGS['read-hat']).toBe('axon:hat-guard')
    expect(AXON_NODE_TAGS['notify-discord-sim-failure']).toBe('axon:notify-failure')
    expect(AXON_NODE_TAGS['notify-registry']).toBe('axon:registry-write')
    expect(AXON_NODE_TAGS['x402-payment-verify']).toBe('axon:x402-payment')
  })
})
