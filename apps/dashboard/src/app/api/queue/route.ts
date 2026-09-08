import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const result = await authenticateRequest(req)
  if ('errorResponse' in result) {
    return result.errorResponse
  }

  const { org } = result

  // Fetch org's registered protocols to scope
  const orgProtocols = await prisma.protocol.findMany({
    where: { orgId: org.id },
  })
  const protoIds = orgProtocols.map((p) => p.id)

  const where: any = {
    status: { in: ['QUEUED', 'SIMULATING', 'CONFLICT', 'READY', 'EXECUTING', 'HELD'] },
  }

  if (protoIds.length > 0) {
    where.OR = [
      { orgId: org.id },
      { protocolId: { in: protoIds } },
    ]
  } else {
    // Backwards-compatible fallback
    where.OR = [
      { orgId: org.id },
      { orgId: null },
    ]
  }

  const spells = await prisma.spellRecord.findMany({
    where,
    orderBy: { nextExecutionWindow: 'asc' },
  })

  // Serialize BigInt safely
  const formatted = spells.map((s) => ({
    id: s.id,
    protocolId: s.protocolId,
    spellAddress: s.spellAddress,
    status: s.status,
    simulationScore: s.simulationScore,
    conflictStatus: s.conflictStatus,
    conflictDetail: s.conflictDetail,
    nextExecutionWindow: s.nextExecutionWindow,
    earliestExecution: s.earliestExecution,
    latestExecution: s.latestExecution,
    calledAt: s.calledAt,
  }))

  return NextResponse.json({
    queue: formatted,
    count: formatted.length,
  })
}
