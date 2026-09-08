import { NextRequest, NextResponse } from 'next/server'
import { prisma } from './prisma'
import type { Organisation } from '@prisma/client'

export async function authenticateRequest(
  req: NextRequest
): Promise<{ org: Organisation } | { errorResponse: NextResponse }> {
  const authHeader = req.headers.get('authorization')
  if (!authHeader) {
    return {
      errorResponse: NextResponse.json(
        { error: 'Unauthorized: Missing Authorization header' },
        { status: 401 }
      ),
    }
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) {
    return {
      errorResponse: NextResponse.json(
        { error: 'Unauthorized: Missing Bearer token' },
        { status: 401 }
      ),
    }
  }

  try {
    const org = await prisma.organisation.findUnique({
      where: { apiKey: token },
    })

    if (!org) {
      return {
        errorResponse: NextResponse.json(
          { error: 'Unauthorized: Invalid API key' },
          { status: 401 }
        ),
      }
    }

    return { org }
  } catch (err: any) {
    return {
      errorResponse: NextResponse.json(
        { error: `Internal auth error: ${err.message}` },
        { status: 500 }
      ),
    }
  }
}
