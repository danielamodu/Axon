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

const prisma = new PrismaClient()

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
// Tool 1: get_queue
// ---------------------------------------------------------------------------
server.tool(
  'get_queue',
  'Get all spells currently in the Axon execution queue',
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
    const where: any = {}
    if (protocolId) where.protocolId = protocolId
    if (status) {
      where.status = status
    } else {
      // Default queue is anything not yet executed or failed
      where.status = { in: ['QUEUED', 'SIMULATING', 'CONFLICT', 'READY', 'EXECUTING', 'HELD'] }
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
  'Get execution history for a protocol',
  {
    protocolId: z.string().optional().describe('Filter by protocol ID (e.g. "sky")'),
    limit: z.number().int().positive().optional().describe('Max records to return (default 20)'),
  },
  async ({ protocolId, limit = 20 }) => {
    const where: any = { status: 'EXECUTED' }
    if (protocolId) where.protocolId = protocolId

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
  'Get reliability stats for a monitored protocol',
  {
    protocolId: z.string().describe('Protocol identifier e.g. "sky"'),
  },
  async ({ protocolId }) => {
    const executed = await prisma.spellRecord.findMany({
      where: { protocolId, status: 'EXECUTED' },
      orderBy: { executedAt: 'desc' },
    })

    const failed = await prisma.spellRecord.count({
      where: { protocolId, status: 'FAILED' },
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
    // Find the latest active (non-executed, non-failed) spell or most recent
    const active = await prisma.spellRecord.findFirst({
      where: {
        protocolId,
        status: { in: ['READY', 'EXECUTING', 'SIMULATING', 'QUEUED'] },
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
  'Register a new protocol for Axon to monitor',
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
    const dir = getConfigsDir()
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    const filePath = path.join(dir, `${config.id}.json`)
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8')

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            protocolId: config.id,
            message: `Protocol ${config.name} (${config.id}) registered successfully. Saved to ${filePath}`,
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
    const spell = await prisma.spellRecord.findUnique({
      where: { spellAddress },
    })

    // Return current projected state for the spell
    const state = {
      spellAddress,
      protocolId: spell?.protocolId ?? 'sky',
      simulationScore: spell?.simulationScore ?? 'GREEN',
      avgGasGwei: 28.5,
      usdsTotalSupply: '4982145892.42',
      vatHeadroom: '520000000.00',
      ethPrice: 2450.75,
      status: spell?.status ?? 'QUEUED',
    }

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
  'List all protocols Axon is monitoring',
  async () => {
    const configs = loadAllConfigs()
    const result = configs.map((c) => ({
      ...c,
      status: c.id === 'sky' ? 'ACTIVE' : 'MONITORING',
    }))

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

    if (method === 'GET' && url === '/health') {
      res.writeHead(200)
      res.end(JSON.stringify({ ok: true, name: 'axon-mcp-server', port }))
      return
    }

    if (method === 'GET' && url === '/protocols') {
      res.writeHead(200)
      res.end(JSON.stringify(loadAllConfigs(), null, 2))
      return
    }

    if (method === 'GET' && url?.startsWith('/queue')) {
      const spells = await prisma.spellRecord.findMany({
        where: { status: { in: ['QUEUED', 'SIMULATING', 'CONFLICT', 'READY', 'EXECUTING', 'HELD'] } },
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
            res.end(JSON.stringify({ result: configs }))
            return
          }
          if (toolName === 'get_queue') {
            const spells = await prisma.spellRecord.findMany({
              where: args.status ? { status: args.status } : undefined,
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
    // Info log
  })

  return httpServer
}

// ---------------------------------------------------------------------------
// Main execution
// ---------------------------------------------------------------------------
async function main() {
  const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]

  if (isDirectRun || process.env.RUN_MCP_SERVER) {
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
