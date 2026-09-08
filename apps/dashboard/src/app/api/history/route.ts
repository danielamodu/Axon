import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const result = await authenticateRequest(req)
  if ('errorResponse' in result) {
    return result.errorResponse
  }

  const { org } = result

  const orgProtocols = await prisma.protocol.findMany({
    where: { orgId: org.id },
  })
  const protoIds = orgProtocols.map((p) => p.id)

  const where: any = {
    status: 'EXECUTED',
  }

  if (protoIds.length > 0) {
    where.OR = [
      { orgId: org.id },
      { protocolId: { in: protoIds } },
    ]
  } else {
    where.OR = [
      { orgId: org.id },
      { orgId: null },
    ]
  }

  const history = await prisma.spellRecord.findMany({
    where,
    orderBy: { executedAt: 'desc' },
    take: 50,
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

  return NextResponse.json({
    history: formatted,
    count: formatted.length,
  })
}
