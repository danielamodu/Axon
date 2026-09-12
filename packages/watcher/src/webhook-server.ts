import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { PrismaClient } from '@prisma/client'
import { RegistryWriter, type RegistryEntry } from './registry-writer'
import { WEBHOOK_SERVER_PORT, SKY_CHIEF_ADDRESS } from './constants'
import { logger } from './logger'

const SIM_SCORE_MAP: Record<string, 0 | 1 | 2> = {
  RED: 0,
  YELLOW: 1,
  GREEN: 2,
}

interface ExecutionWebhookBody {
  spellAddress: string
  txHash: string
  gasUsed?: string | number
  simulationScore?: string    // 'RED' | 'YELLOW' | 'GREEN'
  executedAt?: string         // ISO 8601
  protocol?: string
  executor?: string
}

interface KeeperHubStageBody {
  workflowId: string
  executionId: string
  stage: string        // "started" | "node_complete" | "completed" | "failed"
  nodeId?: number | string
  nodeName?: string
  timestamp?: string
  output?: any
}

interface HatChangeBody {
  protocolId: string
  newHat: string
  previousHat?: string
  detectedAt?: string
  timelockDelay?: number  // seconds; defaults to 48h GSM delay
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk.toString() })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json),
  })
  res.end(json)
}

export class WebhookServer {
  private writer: RegistryWriter
  private prisma: PrismaClient | null
  private server: ReturnType<typeof createServer>
  private port: number

  constructor(writer?: RegistryWriter, port?: number, prisma?: PrismaClient) {
    this.writer = writer ?? new RegistryWriter()
    this.port = port ?? WEBHOOK_SERVER_PORT
    this.prisma = prisma ?? null
    this.server = createServer(this.handleRequest.bind(this))
  }

  /** DB access for sync endpoints. Null when running registry-only. */
  private db(): PrismaClient | null {
    if (!this.prisma) {
      try {
        this.prisma = new PrismaClient()
      } catch {
        return null
      }
    }
    return this.prisma
  }

  /** Optional shared-secret gate for KeeperHub webhooks. */
  private authorized(req: IncomingMessage): boolean {
    const secret = process.env.AXON_WEBHOOK_SECRET
    if (!secret) return true
    const header = req.headers['x-webhook-secret']
    return header === secret
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        logger.info({ port: this.port }, `🌐 Webhook server listening on port ${this.port}`)
        resolve()
      })
    })
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const { method, url } = req

    // Health check
    if (method === 'GET' && url === '/health') {
      send(res, 200, { ok: true, service: 'axon-webhook', registryConfigured: this.writer.isConfigured })
      return
    }

    // POST /webhook/execution — KeeperHub workflow Node 7 or direct executor call
    if (method === 'POST' && url === '/webhook/execution') {
      await this.handleExecutionWebhook(req, res)
      return
    }

    // POST /webhook/keeperhub — KeeperHub workflow stage-change sync (Phase 9 F2)
    if (method === 'POST' && url === '/webhook/keeperhub') {
      await this.handleKeeperHubSync(req, res)
      return
    }

    // POST /webhook/hat-change — KeeperHub scheduler detection (Phase 9 F3)
    if (method === 'POST' && url === '/webhook/hat-change') {
      await this.handleHatChange(req, res)
      return
    }

    send(res, 404, { error: 'Not found' })
  }

  private async handleExecutionWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let body: ExecutionWebhookBody

    try {
      const raw = await readBody(req)
      if (!raw) {
        send(res, 400, { error: 'Empty body' })
        return
      }
      body = JSON.parse(raw)
    } catch {
      send(res, 400, { error: 'Invalid JSON' })
      return
    }

    if (!body.spellAddress || !body.txHash) {
      send(res, 400, { error: 'Missing required fields: spellAddress, txHash' })
      return
    }

    logger.info(
      { spellAddress: body.spellAddress, txHash: body.txHash },
      '📩 Received execution webhook'
    )

    const scoreKey = (body.simulationScore ?? 'GREEN').toUpperCase()
    const simulationScore: 0 | 1 | 2 = (SIM_SCORE_MAP[scoreKey] ?? 2)

    const entry: RegistryEntry = {
      protocol:        (body.protocol ?? SKY_CHIEF_ADDRESS) as `0x${string}`,
      spellAddress:    body.spellAddress as `0x${string}`,
      actionType:      'GOVERNANCE_CAST',
      txHash:          body.txHash,
      executedAt:      body.executedAt ? new Date(body.executedAt) : new Date(),
      gasUsed:         body.gasUsed ? BigInt(body.gasUsed) : 0n,
      executor:        (body.executor ?? '0x0000000000000000000000000000000000000000') as `0x${string}`,
      simulationScore,
    }

    try {
      const baseTxHash = await this.writer.log(entry)
      send(res, 200, {
        ok: true,
        spellAddress: body.spellAddress,
        baseTxHash: baseTxHash ?? null,
        registryConfigured: this.writer.isConfigured,
      })
    } catch (err: any) {
      logger.error({ err: err.message }, 'Webhook handler: registry write threw')
      send(res, 500, { error: 'Registry write failed', detail: err.message })
    }
  }

  /**
   * Phase 9 F2 — bidirectional state sync. Maps KeeperHub workflow stages
   * onto Axon SpellStatus so the full lifecycle is visible on both sides.
   */
  async handleKeeperHubSync(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.authorized(req)) {
      send(res, 401, { error: 'Unauthorized' })
      return
    }

    let body: KeeperHubStageBody
    try {
      const raw = await readBody(req)
      if (!raw) {
        send(res, 400, { error: 'Empty body' })
        return
      }
      body = JSON.parse(raw)
    } catch {
      send(res, 400, { error: 'Invalid JSON' })
      return
    }

    if (!body.workflowId || !body.stage) {
      send(res, 400, { error: 'Missing required fields: workflowId, stage' })
      return
    }

    const db = this.db()
    if (!db) {
      send(res, 503, { error: 'Database unavailable — sync deferred' })
      return
    }

    const spell = await db.spellRecord.findFirst({
      where: { keeperHubWorkflowId: body.workflowId },
    })
    if (!spell) {
      send(res, 404, { error: 'No SpellRecord for workflowId' })
      return
    }

    const nodeRef = `${body.nodeId ?? ''} ${body.nodeName ?? ''}`.toLowerCase()
    const isCastNode =
      nodeRef.includes('execute-cast') ||
      nodeRef.includes('axon:governance-execution') ||
      nodeRef.includes(' 5 ') ||
      nodeRef === '5'

    let nextStatus: string | null = null
    const data: Record<string, unknown> = {}

    switch (body.stage) {
      case 'started':
        nextStatus = 'EXECUTING'
        break
      case 'node_complete':
        if (isCastNode) {
          const tx = body.output?.transactionHash ?? body.output?.txHash
          if (typeof tx === 'string' && tx) {
            data['txHash'] = tx
          }
          nextStatus = 'EXECUTING'
        }
        break
      case 'completed':
        nextStatus = 'EXECUTED'
        data['executedAt'] = body.timestamp ? new Date(body.timestamp) : new Date()
        break
      case 'failed':
        nextStatus = 'FAILED'
        break
      default:
        send(res, 400, { error: `Unknown stage: ${body.stage}` })
        return
    }

    if (nextStatus) {
      const updated = await db.spellRecord.update({
        where: { id: spell.id },
        data: { status: nextStatus as any, ...data },
      })
      logger.info(
        { workflowId: body.workflowId, stage: body.stage, spell: spell.spellAddress },
        `🔄 KeeperHub sync: ${body.stage} → ${updated.status}`
      )
      send(res, 200, { ok: true, spellAddress: spell.spellAddress, status: updated.status })
    } else {
      // node_complete for a non-cast node: acknowledge, no state change
      logger.debug({ workflowId: body.workflowId, node: body.nodeName }, 'KeeperHub node sync (no state change)')
      send(res, 200, { ok: true, spellAddress: spell.spellAddress, status: spell.status })
    }
  }

  /**
   * Phase 9 F3 — scheduler detection ingress. First detector wins: if the
   * polling watcher already recorded the hat, mark both sources and skip.
   */
  async handleHatChange(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.authorized(req)) {
      send(res, 401, { error: 'Unauthorized' })
      return
    }

    let body: HatChangeBody
    try {
      const raw = await readBody(req)
      if (!raw) {
        send(res, 400, { error: 'Empty body' })
        return
      }
      body = JSON.parse(raw)
    } catch {
      send(res, 400, { error: 'Invalid JSON' })
      return
    }

    if (!body.protocolId || !body.newHat) {
      send(res, 400, { error: 'Missing required fields: protocolId, newHat' })
      return
    }

    const db = this.db()
    if (!db) {
      send(res, 503, { error: 'Database unavailable — detection deferred' })
      return
    }

    const existing = await db.spellRecord.findUnique({
      where: { spellAddress: body.newHat },
    })
    if (existing) {
      // Watcher got here first — record dual detection, skip creation.
      const source =
        existing.detectionSource === 'watcher' ? 'both' : (existing.detectionSource ?? 'keeperhub-scheduler')
      await db.spellRecord.update({
        where: { id: existing.id },
        data: { detectionSource: source },
      })
      logger.info(
        { protocolId: body.protocolId, hat: body.newHat },
        '🔍 KeeperHub scheduler detection deduplicated — watcher already recorded hat'
      )
      send(res, 200, { ok: true, deduplicated: true, detectionSource: source })
      return
    }

    const now = new Date()
    const delaySeconds = body.timelockDelay ?? 48 * 60 * 60
    const created = await db.spellRecord.create({
      data: {
        protocolId: body.protocolId,
        spellAddress: body.newHat,
        calledAt: now,
        earliestExecution: new Date(now.getTime() + delaySeconds * 1000),
        latestExecution: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        officeHoursActive: false,
        nextExecutionWindow: new Date(now.getTime() + delaySeconds * 1000),
        calldata: '0x',
        actions: [],
        status: 'QUEUED',
        detectionSource: 'keeperhub-scheduler',
      },
    })
    logger.info(
      { protocolId: body.protocolId, hat: body.newHat },
      '🔍 KeeperHub scheduler detected new hat'
    )
    send(res, 201, { ok: true, deduplicated: false, spellId: created.id })
  }
}
