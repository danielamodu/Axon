import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const result = await authenticateRequest(req)
  if ('errorResponse' in result) {
    return result.errorResponse
  }

  const { org } = result
  return NextResponse.json({
    ok: true,
    org: {
      id: org.id,
      name: org.name,
      email: org.email,
      createdAt: org.createdAt,
    },
  })
}

export async function POST(req: NextRequest) {
  return GET(req)
}
