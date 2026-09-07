import { createPublicClient, http, type Address } from 'viem'
import { mainnet } from 'viem/chains'
import { PrismaClient } from '@prisma/client'
import { CHIEF_ABI, SPELL_ABI } from './abi'
import { parseSpell } from './spell-parser'
import { nextOfficeHoursSlot } from './office-hours'
import {
  SKY_CHIEF_ADDRESS,
  GSM_PAUSE_DELAY_SECONDS,
  SPELL_EXPIRY_SECONDS,
  POLL_INTERVAL_MS,
} from './constants'
import { logger } from './logger'
import { SpellRecordSchema } from './types'

export class GovernanceWatcher {
  private client: ReturnType<typeof createPublicClient>
  private prisma: PrismaClient
  private lastKnownHat: Address | null = null
  private running = false

  constructor(
    rpcUrlOrClient: string | ReturnType<typeof createPublicClient>,
    prisma?: PrismaClient
  ) {
    if (typeof rpcUrlOrClient === 'string') {
      this.client = createPublicClient({
        chain: mainnet,
        transport: http(rpcUrlOrClient),
      })
    } else {
      this.client = rpcUrlOrClient
    }
    this.prisma = prisma ?? new PrismaClient()
  }

  getClient(): ReturnType<typeof createPublicClient> {
    return this.client
  }

  getPrisma(): PrismaClient {
    return this.prisma
  }

  async start(): Promise<void> {
    this.running = true
    logger.info('Governance Watcher started')

    // Load last known hat from DB on startup
    const latest = await this.prisma.spellRecord.findFirst({
      orderBy: { createdAt: 'desc' },
    })
    if (latest) {
      this.lastKnownHat = latest.spellAddress as Address
      logger.info({ hat: this.lastKnownHat }, 'Restored last known hat from DB')
    }

    while (this.running) {
      try {
        await this.poll()
      } catch (err) {
        logger.error({ err }, 'Poll error — continuing')
      }
      await sleep(POLL_INTERVAL_MS)
    }
  }

  stop(): void {
    this.running = false
    logger.info('Governance Watcher stopped')
  }

  private async poll(): Promise<void> {
    const hat = await this.client.readContract({
      address: SKY_CHIEF_ADDRESS as Address,
      abi: CHIEF_ABI,
      functionName: 'hat',
    }) as Address

    // Zero address = no active spell
    if (hat === '0x0000000000000000000000000000000000000000') {
      logger.debug('No active spell (hat = zero address)')
      this.lastKnownHat = hat
      return
    }

    // Hat unchanged — nothing to do
    if (hat === this.lastKnownHat) {
      logger.debug({ hat }, 'Hat unchanged')
      return
    }

    logger.info({ 
      previousHat: this.lastKnownHat, 
      newHat: hat 
    }, '🚨 New spell detected — hat changed')

    this.lastKnownHat = hat
    await this.processNewSpell(hat)
  }

  private async processNewSpell(spellAddress: Address): Promise<void> {
    // Check if we already have this spell
    const existing = await this.prisma.spellRecord.findUnique({
      where: { spellAddress },
    })

    if (existing) {
      logger.info({ spellAddress }, 'Spell already in DB — skipping')
      return
    }

    // Parse the spell contract
    const spell = await parseSpell(this.client, spellAddress)

    const now = new Date()

    // Use nextCastTime from contract if available and sane
    // Otherwise calculate from now + GSM delay
    const earliestExecution = spell.nextCastTime > now
      ? spell.nextCastTime
      : new Date(now.getTime() + GSM_PAUSE_DELAY_SECONDS * 1000)

    // Expiration from contract if available
    const latestExecution = spell.expiration > now
      ? spell.expiration
      : new Date(now.getTime() + SPELL_EXPIRY_SECONDS * 1000)

    // Calculate next office-hours slot if spell has the constraint
    const nextExecutionWindow = spell.officeHoursActive
      ? nextOfficeHoursSlot(earliestExecution)
      : earliestExecution

    // Validate with zod
    const record = SpellRecordSchema.parse({
      spellAddress,
      calledAt: now,
      earliestExecution,
      latestExecution,
      officeHoursActive: spell.officeHoursActive,
      nextExecutionWindow,
      calldata: '0x', // full calldata decoding in Phase 2
      actions: spell.actions,
    })

    const status = spell.done ? 'EXECUTED' : 'QUEUED'

    // Persist to DB
    await this.prisma.spellRecord.create({
      data: {
        spellAddress: record.spellAddress,
        calledAt: record.calledAt,
        earliestExecution: record.earliestExecution,
        latestExecution: record.latestExecution,
        officeHoursActive: record.officeHoursActive,
        nextExecutionWindow: record.nextExecutionWindow,
        calldata: record.calldata,
        actions: record.actions,
        status,
        executedAt: spell.done ? (spell.expiration > now ? now : spell.expiration) : null,
      },
    })

    // If spell is already executed, record it and skip execution queue
    if (spell.done) {
      logger.info({ spellAddress }, 'Spell already executed — recorded in DB as EXECUTED')
      return
    }

    logger.info({
      spellAddress,
      description: spell.description.slice(0, 80),
      earliestExecution: earliestExecution.toISOString(),
      nextExecutionWindow: nextExecutionWindow.toISOString(),
      latestExecution: latestExecution.toISOString(),
      officeHoursActive: spell.officeHoursActive,
    }, '✅ SpellRecord created and queued')

    // Expiry warning
    const daysUntilExpiry = Math.floor(
      (latestExecution.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    )
    if (daysUntilExpiry <= 5) {
      logger.warn({ spellAddress, daysUntilExpiry }, '⚠️ Spell expires soon')
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
