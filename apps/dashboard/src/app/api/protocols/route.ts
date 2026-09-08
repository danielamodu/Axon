import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import fs from 'node:fs'
import path from 'node:path'

function loadDefaultFileConfigs(): any[] {
  const configsDir = path.resolve(process.cwd(), '../../packages/watcher/src/protocols/configs')
  if (!fs.existsSync(configsDir)) return []
  try {
    const files = fs.readdirSync(configsDir).filter((f) => f.endsWith('.json'))
    return files.map((f) => JSON.parse(fs.readFileSync(path.join(configsDir, f), 'utf-8')))
  } catch {
    return []
  }
}

export async function GET(req: NextRequest) {
  const result = await authenticateRequest(req)
  if ('errorResponse' in result) {
    return result.errorResponse
  }

  const { org } = result

  // Fetch protocols registered directly under this organisation
  const dbProtocols = await prisma.protocol.findMany({
    where: { orgId: org.id },
    orderBy: { createdAt: 'desc' },
  })

  // Also include system monitored protocols with active status
  const systemConfigs = loadDefaultFileConfigs()
  const combined = [
    ...dbProtocols.map((p) => ({
      id: p.id,
      name: (p.config as any)?.name ?? p.id,
      network: (p.config as any)?.network ?? 'mainnet',
      governanceContract: (p.config as any)?.governanceContract ?? '',
      governanceType: (p.config as any)?.governanceType ?? 'openzeppelin-governor',
      status: p.status,
      isCustom: true,
    })),
    ...systemConfigs.map((c) => ({
      id: c.id,
      name: c.name,
      network: c.network,
      governanceContract: c.governanceContract,
      governanceType: c.governanceType,
      status: c.id === 'sky' ? 'ACTIVE' : 'MONITORING',
      isCustom: false,
    })),
  ]

  // Remove duplicates by id
  const seen = new Set<string>()
  const protocols = combined.filter((p) => {
    if (seen.has(p.id)) return false
    seen.add(p.id)
    return true
  })

  return NextResponse.json({
    protocols,
    total: protocols.length,
  })
}
