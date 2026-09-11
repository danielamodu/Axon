import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { PrismaClient } from '@prisma/client'
import { z } from 'zod'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Resolve protocol configs dir reliably
function getConfigsDir(): string {
  const candidates = [
    path.resolve(__dirname, '../../watcher/src/protocols/configs'),
    path.resolve(process.cwd(), 'packages/watcher/src/protocols/configs'),
    path.resolve(process.cwd(), 'src/protocols/configs'),
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  return candidates[0]
}

export const prisma = new PrismaClient()

// Initialize MCP Server
export const server = new McpServer({
  name: 'axon-mcp-server',
  version: '0.1.0',
})

// Helper to serialize BigInt
export function sanitize(obj: any): any {
  return JSON.parse(
    JSON.stringify(obj, (_, v) => (typeof v === 'bigint' ? v.toString() : v))
  )
}

export interface SimulationStateView {
  spellAddress: string
  protocolId: string
  simulationScore: string
  status: string
  projectionAvailable: boolean
  projectedAt?: string
  avgGasGwei?: number
  gasVolatilityGwei?: number
  usdsTotalSupply?: number
  vatHeadroomUsds?: number
  ethPriceUsd?: number
  oracleAgeSeconds?: number
  reasons?: string[]
  simulatedVia?: string
  simulationSuccess?: boolean
  note?: string
}

/**
 * Builds the simulation-state view from a spell's stored projection.
 * The StateProjector persists its full assessment as JSON in
 * SpellRecord.conflictDetail — this reads that back. When no projection
 * has been stored yet it says so explicitly instead of inventing numbers.
 */
export function buildSimulationState(
  spellAddress: string,
  spell: {
    protocolId?: string | null
    status?: string | null
    simulationScore?: string | null
    conflictDetail?: string | null
  } | null
): SimulationStateView {
  const base: SimulationStateView = {
    spellAddress,
    protocolId: spell?.protocolId ?? 'unknown',
    status: spell?.status ?? 'UNKNOWN',
    simulationScore: spell?.simulationScore ?? 'PENDING',
    projectionAvailable: false,
  }

  if (!spell) {
    return { ...base, note: 'Spell not found in this workspace.' }
  }
  if (!spell.conflictDetail) {
    return { ...base, note: 'No projection stored yet — spell has not been simulated.' }
  }

  try {
    const d = JSON.parse(spell.conflictDetail)
    if (!d || !d.gasTrend) {
      return { ...base, note: 'Stored projection is incomplete — awaiting simulation.' }
    }
    return {
      ...base,
      projectionAvailable: true,
      projectedAt: d.projectedAt,
      avgGasGwei: d.gasTrend?.averageGwei,
      gasVolatilityGwei: d.gasTrend?.stddevGwei,
      usdsTotalSupply: d.usdsTotalSupply,
      vatHeadroomUsds: d.vatHeadroomUsds,
      ethPriceUsd: d.ethPriceUsd,
      oracleAgeSeconds: d.oracleAgeSeconds,
      reasons: Array.isArray(d.reasons) ? d.reasons : undefined,
      simulatedVia: d.simulation?.simulatedVia,
      simulationSuccess: d.simulation?.success,
    }
  } catch {
    return { ...base, note: 'Stored projection could not be parsed.' }
  }
}

// Helper to load protocol configs
export function loadAllConfigs(): any[] {
  const dir = getConfigsDir()
  if (!fs.existsSync(dir)) return []
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
  const configs: any[] = []
  for (const f of files) {
    try {
      const content = fs.readFileSync(path.join(dir, f), 'utf-8')
      configs.push(JSON.parse(content))
    } catch {
      // ignore parse errors
    }
  }
  return configs
}

// ---------------------------------------------------------------------------
// Authentication Helper
// ---------------------------------------------------------------------------
export interface AuthResult {
  authorized: boolean
  org?: { id: string; name: string; apiKey: string }
  error?: string
}

export async function authenticateMcp(reqApiKey?: string): Promise<AuthResult> {
  const apiKey = (reqApiKey ?? process.env.AXON_API_KEY)?.trim()
  if (!apiKey) {
    return {
      authorized: false,
      error: 'Unauthorized. Set AXON_API_KEY.',
    }
  }

  // Allow bypass in test mode with demo mock
  if (process.env.NODE_ENV === 'test' && apiKey === 'test-key') {
    return {
      authorized: true,
      org: { id: 'test_org_default', name: 'Test Organisation', apiKey: 'test-key' },
    }
  }

  try {
    const org = await prisma.organisation.findUnique({
      where: { apiKey },
    })

    if (!org) {
      return {
        authorized: false,
        error: 'Unauthorized. Invalid AXON_API_KEY.',
      }
    }

    return {
      authorized: true,
      org: { id: org.id, name: org.name, apiKey: org.apiKey },
    }
  } catch (err: any) {
    return {
      authorized: false,
      error: `Database authentication error: ${err.message}`,
    }
  }
}

// ---------------------------------------------------------------------------
// Tool 1: get_queue
// ---------------------------------------------------------------------------
server.tool(
  'get_queue',
  'Get all spells currently in the Axon execution queue for the authenticated organisation',
  {
    protocolId: z.string().optional().describe('Filter by protocol ID (e.g. "sky", "aave")'),
    status: z.enum([
      'QUEUED',
      'SIMULATING',
      'CONFLICT',
      'READY',
      'EXECUTING',
      'EXECUTED',
      'FAILED',
      'EXPIRED',
      'HELD',
    ]).optional().describe('Filter by spell status'),
  },
  async ({ protocolId, status }) => {
    const auth = await authenticateMcp()
    if (!auth.authorized || !auth.org) {
      return {
        isError: true,
        content: [{ type: 'text', text: auth.error ?? 'Unauthorized. Set AXON_API_KEY.' }],
      }
    }

    // Scoping to this organisation's registered protocols
    const orgProtocols = await prisma.protocol.findMany({
      where: { orgId: auth.org.id },
    })
    const orgProtoIds = orgProtocols.map((p) => p.id)

    const where: any = {}
    if (protocolId) where.protocolId = protocolId
    if (status) {
      where.status = status
    } else {
      where.status = { in: ['QUEUED', 'SIMULATING', 'CONFLICT', 'READY', 'EXECUTING', 'HELD'] }
    }

    // Include spells owned by this org or protocols owned by this org
    if (orgProtoIds.length > 0) {
      where.OR = [
        { orgId: auth.org.id },
        { protocolId: { in: orgProtoIds } },
      ]
    } else {
      // Sky/default backwards-compatibility if no protocols yet registered
      where.OR = [
        { orgId: auth.org.id },
        { orgId: null },
      ]
    }

    const spells = await prisma.spellRecord.findMany({
      where,
      orderBy: { nextExecutionWindow: 'asc' },
    })

    const formatted = spells.map((s) => ({
      id: s.id,
      protocolId: s.protocolId,
      spellAddress: s.spellAddress,
      status: s.status,
      simulationScore: s.simulationScore,
      executionWindow: s.nextExecutionWindow,
      earliestExecution: s.earliestExecution,
      latestExecution: s.latestExecution,
      conflictStatus: s.conflictStatus,
    }))

    return {
      content: [{ type: 'text', text: JSON.stringify(sanitize(formatted), null, 2) }],
    }
  }
)

// ---------------------------------------------------------------------------
// Tool 2: get_execution_history
// ---------------------------------------------------------------------------
server.tool(
  'get_execution_history',
  'Get execution history for the authenticated organisation',
  {
    protocolId: z.string().optional().describe('Filter by protocol ID (e.g. "sky")'),
    limit: z.number().int().positive().optional().describe('Max records to return (default 20)'),
  },
  async ({ protocolId, limit = 20 }) => {
    const auth = await authenticateMcp()
    if (!auth.authorized || !auth.org) {
      return {
        isError: true,
        content: [{ type: 'text', text: auth.error ?? 'Unauthorized. Set AXON_API_KEY.' }],
      }
    }

    const orgProtocols = await prisma.protocol.findMany({
      where: { orgId: auth.org.id },
    })
    const orgProtoIds = orgProtocols.map((p) => p.id)

    const where: any = { status: 'EXECUTED' }
    if (protocolId) where.protocolId = protocolId

    if (orgProtoIds.length > 0) {
      where.OR = [
        { orgId: auth.org.id },
        { protocolId: { in: orgProtoIds } },
      ]
    } else {
      where.OR = [
        { orgId: auth.org.id },
        { orgId: null },
      ]
    }

    const history = await prisma.spellRecord.findMany({
      where,
      orderBy: { executedAt: 'desc' },
      take: limit,
    })

    const formatted = history.map((s) => ({
      id: s.id,
      protocolId: s.protocolId,
      spellAddress: s.spellAddress,
      txHash: s.txHash,
      executedAt: s.executedAt,
      gasUsed: s.gasUsed?.toString(),
      simulationScore: s.simulationScore,
    }))

    return {
      content: [{ type: 'text', text: JSON.stringify(sanitize(formatted), null, 2) }],
    }
  }
)

// ---------------------------------------------------------------------------
// Tool 3: get_protocol_stats
// ---------------------------------------------------------------------------
server.tool(
  'get_protocol_stats',
  'Get reliability stats for a monitored protocol in the organisation',
  {
    protocolId: z.string().describe('Protocol identifier e.g. "sky"'),
  },
  async ({ protocolId }) => {
    const auth = await authenticateMcp()
    if (!auth.authorized || !auth.org) {
      return {
        isError: true,
        content: [{ type: 'text', text: auth.error ?? 'Unauthorized. Set AXON_API_KEY.' }],
      }
    }

    const executed = await prisma.spellRecord.findMany({
      where: {
        protocolId,
        status: 'EXECUTED',
        OR: [{ orgId: auth.org.id }, { orgId: null }],
      },
      orderBy: { executedAt: 'desc' },
    })

    const failed = await prisma.spellRecord.count({
      where: {
        protocolId,
        status: 'FAILED',
        OR: [{ orgId: auth.org.id }, { orgId: null }],
      },
    })

    const total = executed.length + failed
    const reliabilityPct = total > 0 ? ((executed.length / total) * 100).toFixed(1) + '%' : '100.0%'

    let totalDelayHours = 0
    let delayCount = 0

    for (const s of executed) {
      if (s.executedAt && s.earliestExecution) {
        const diffMs = s.executedAt.getTime() - s.earliestExecution.getTime()
        if (diffMs > 0) {
          totalDelayHours += diffMs / (1000 * 60 * 60)
          delayCount++
        }
      }
    }

    const avgDelayHours = delayCount > 0 ? (totalDelayHours / delayCount).toFixed(2) : '0.00'
    const lastExecution = executed.length > 0 ? executed[0].executedAt : null

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              protocolId,
              orgId: auth.org.id,
              totalExecutions: executed.length,
              totalFailed: failed,
              avgDelayHours: Number(avgDelayHours),
              reliabilityPct,
              lastExecution,
            },
            null,
            2
          ),
        },
      ],
    }
  }
)

// ---------------------------------------------------------------------------
// Tool 4: get_active_spell
// ---------------------------------------------------------------------------
server.tool(
  'get_active_spell',
  'Get the current active spell for a protocol',
  {
    protocolId: z.string().describe('Protocol identifier e.g. "sky"'),
  },
  async ({ protocolId }) => {
    const auth = await authenticateMcp()
    if (!auth.authorized || !auth.org) {
      return {
        isError: true,
        content: [{ type: 'text', text: auth.error ?? 'Unauthorized. Set AXON_API_KEY.' }],
      }
    }

    const active = await prisma.spellRecord.findFirst({
      where: {
        protocolId,
        status: { in: ['READY', 'EXECUTING', 'SIMULATING', 'QUEUED'] },
        OR: [{ orgId: auth.org.id }, { orgId: null }],
      },
      orderBy: { nextExecutionWindow: 'asc' },
    })

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(sanitize(active ?? null), null, 2),
        },
      ],
    }
  }
)

// ---------------------------------------------------------------------------
// Tool 5: register_protocol
// ---------------------------------------------------------------------------
server.tool(
  'register_protocol',
  'Register a new protocol for Axon to monitor under the organisation',
  {
    id: z.string().min(1),
    name: z.string().min(1),
    chainId: z.number().int().positive(),
    governanceContract: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    governanceType: z.enum([
      'makerdao-spell',
      'compound-governor',
      'openzeppelin-governor',
      'optimistic-timelock',
    ]),
    executionMethod: z.enum(['cast', 'execute', 'queue-execute']),
    timelockDelay: z.number().nonnegative(),
    officeHours: z.boolean(),
    officeHoursStart: z.number().min(0).max(23).optional(),
    officeHoursEnd: z.number().min(0).max(23).optional(),
    officeDays: z.array(z.number().min(0).max(6)).optional(),
    expirySeconds: z.number().positive(),
    network: z.enum(['mainnet', 'base', 'arbitrum', 'optimism']),
    rpcUrl: z.string().url().optional(),
    tags: z.array(z.string()).optional(),
  },
  async (config) => {
    const auth = await authenticateMcp()
    if (!auth.authorized || !auth.org) {
      return {
        isError: true,
        content: [{ type: 'text', text: auth.error ?? 'Unauthorized. Set AXON_API_KEY.' }],
      }
    }

    // Save to file
    const dir = getConfigsDir()
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    const filePath = path.join(dir, `${config.id}.json`)
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8')

    // Persist to DB linked to organisation
    await prisma.protocol.upsert({
      where: { id: config.id },
      create: {
        id: config.id,
        orgId: auth.org.id,
        config: config as any,
        status: 'MONITORING',
      },
      update: {
        orgId: auth.org.id,
        config: config as any,
        status: 'MONITORING',
      },
    })

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            orgId: auth.org.id,
            protocolId: config.id,
            message: `Protocol ${config.name} (${config.id}) registered under ${auth.org.name}. Saved to ${filePath}`,
          }),
        },
      ],
    }
  }
)

// ---------------------------------------------------------------------------
// Tool 6: get_simulation_state
// ---------------------------------------------------------------------------
server.tool(
  'get_simulation_state',
  'Get the projected chain state used for spell simulation',
  {
    spellAddress: z.string().describe('The contract address of the spell'),
  },
  async ({ spellAddress }) => {
    const auth = await authenticateMcp()
    if (!auth.authorized || !auth.org) {
      return {
        isError: true,
        content: [{ type: 'text', text: auth.error ?? 'Unauthorized. Set AXON_API_KEY.' }],
      }
    }

    const spell = await prisma.spellRecord.findUnique({
      where: { spellAddress },
    })

    // Live projection persisted by the StateProjector — never fabricated.
    const state = buildSimulationState(spellAddress, spell)

    return {
      content: [{ type: 'text', text: JSON.stringify(state, null, 2) }],
    }
  }
)

// ---------------------------------------------------------------------------
// Tool 7: list_protocols
// ---------------------------------------------------------------------------
server.tool(
  'list_protocols',
  'List all protocols Axon is monitoring for the authenticated organisation',
  async () => {
    const auth = await authenticateMcp()
    if (!auth.authorized || !auth.org) {
      return {
        isError: true,
        content: [{ type: 'text', text: auth.error ?? 'Unauthorized. Set AXON_API_KEY.' }],
      }
    }

    const dbProtocols = await prisma.protocol.findMany({
      where: { orgId: auth.org.id },
    })

    const configs = loadAllConfigs()
    const result = configs.map((c) => {
      const match = dbProtocols.find((p) => p.id === c.id)
      return {
        ...c,
        status: match ? match.status : c.id === 'sky' ? 'ACTIVE' : 'MONITORING',
        orgId: auth.org.id,
      }
    })

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    }
  }
)

// ---------------------------------------------------------------------------
// HTTP Server for remote clients (port 3002)
// ---------------------------------------------------------------------------
export function startHttpServer(port = 3002): http.Server {
  const httpServer = http.createServer(async (req, res) => {
    const { method, url } = req

    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Api-Key')

    if (method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    if (method === 'GET' && url === '/health') {
      res.writeHead(200)
      res.end(JSON.stringify({ ok: true, name: 'axon-mcp-server', port }))
      return
    }

    // Authenticate all protected HTTP endpoints
    const authHeader = req.headers['authorization'] || req.headers['x-api-key']
    const token = typeof authHeader === 'string'
      ? authHeader.replace(/^Bearer\s+/i, '').trim()
      : undefined

    const auth = await authenticateMcp(token)
    if (!auth.authorized || !auth.org) {
      res.writeHead(401)
      res.end(JSON.stringify({ error: auth.error ?? 'Unauthorized. Set AXON_API_KEY.' }))
      return
    }

    if (method === 'GET' && url === '/protocols') {
      res.writeHead(200)
      res.end(JSON.stringify(loadAllConfigs(), null, 2))
      return
    }

    if (method === 'GET' && url?.startsWith('/queue')) {
      const spells = await prisma.spellRecord.findMany({
        where: {
          status: { in: ['QUEUED', 'SIMULATING', 'CONFLICT', 'READY', 'EXECUTING', 'HELD'] },
          OR: [{ orgId: auth.org.id }, { orgId: null }],
        },
        orderBy: { nextExecutionWindow: 'asc' },
      })
      res.writeHead(200)
      res.end(JSON.stringify(sanitize(spells), null, 2))
      return
    }

    // Generic JSON-RPC / REST endpoint for tools
    if (method === 'POST' && url?.startsWith('/tools/')) {
      const toolName = url.replace('/tools/', '').split('?')[0]
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', async () => {
        try {
          const args = body ? JSON.parse(body) : {}
          // Handle tool routing
          if (toolName === 'list_protocols') {
            const configs = loadAllConfigs()
            res.writeHead(200)
            res.end(JSON.stringify({ result: configs, orgId: auth.org!.id }))
            return
          }
          if (toolName === 'get_queue') {
            const spells = await prisma.spellRecord.findMany({
              where: {
                ...(args.status ? { status: args.status } : {}),
                OR: [{ orgId: auth.org!.id }, { orgId: null }],
              },
              orderBy: { nextExecutionWindow: 'asc' },
            })
            res.writeHead(200)
            res.end(JSON.stringify({ result: sanitize(spells) }))
            return
          }
          res.writeHead(404)
          res.end(JSON.stringify({ error: `Tool ${toolName} not found via HTTP wrapper` }))
        } catch (e: any) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: e.message }))
        }
      })
      return
    }

    res.writeHead(404)
    res.end(JSON.stringify({ error: 'Not found' }))
  })

  httpServer.listen(port, () => {
    // Server started
  })

  return httpServer
}

// ---------------------------------------------------------------------------
// Main execution
// ---------------------------------------------------------------------------
async function main() {
  const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]

  if (isDirectRun || process.env.RUN_MCP_SERVER) {
    // Require AXON_API_KEY to run
    if (!process.env.AXON_API_KEY) {
      console.error('Error: Unauthorized. Set AXON_API_KEY.')
      process.exit(1)
    }

    // Start HTTP server on 3002
    startHttpServer(3002)

    // Connect stdio transport
    const transport = new StdioServerTransport()
    await server.connect(transport)
  }
}

main().catch((err) => {
  console.error('Fatal MCP server error:', err)
  process.exit(1)
})
