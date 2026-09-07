import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
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
  private server: ReturnType<typeof createServer>
  private port: number

  constructor(writer?: RegistryWriter, port?: number) {
    this.writer = writer ?? new RegistryWriter()
    this.port = port ?? WEBHOOK_SERVER_PORT
    this.server = createServer(this.handleRequest.bind(this))
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
}
