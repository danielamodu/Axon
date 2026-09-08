import { createPublicClient, http, type Address } from 'viem'
import { mainnet } from 'viem/chains'
import { PrismaClient } from '@prisma/client'
import { CHIEF_ABI } from './abi'
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
import type { ProtocolConfig } from './protocols/types'

export const DEFAULT_SKY_CONFIG: ProtocolConfig = {
  id: 'sky',
  name: 'Sky Protocol',
  chainId: 1,
  governanceContract: SKY_CHIEF_ADDRESS,
  governanceType: 'makerdao-spell',
  executionMethod: 'cast',
  timelockDelay: GSM_PAUSE_DELAY_SECONDS,
  officeHours: true,
  officeHoursStart: 14,
  officeHoursEnd: 21,
  officeDays: [1, 2, 3, 4, 5],
  expirySeconds: SPELL_EXPIRY_SECONDS,
  network: 'mainnet',
  tags: ['stablecoin', 'lending'],
}

export class GovernanceWatcher {
  private client: ReturnType<typeof createPublicClient>
  private prisma: PrismaClient
  private config: ProtocolConfig
  private lastKnownHat: Address | null = null
  private running = false

  constructor(
    configOrRpc: ProtocolConfig | string | ReturnType<typeof createPublicClient>,
    rpcOrPrisma?: string | ReturnType<typeof createPublicClient> | PrismaClient,
    prismaOrConfig?: PrismaClient | ProtocolConfig
  ) {
    if (typeof configOrRpc === 'object' && 'governanceContract' in configOrRpc) {
      // (config, rpcOrClient, prisma)
      this.config = configOrRpc
      if (typeof rpcOrPrisma === 'string') {
        this.client = createPublicClient({
          chain: mainnet,
          transport: http(rpcOrPrisma),
        })
      } else if (rpcOrPrisma && 'readContract' in rpcOrPrisma) {
        this.client = rpcOrPrisma as ReturnType<typeof createPublicClient>
      } else {
        this.client = createPublicClient({
          chain: mainnet,
          transport: http(process.env.ETH_RPC_URL ?? 'https://ethereum-rpc.publicnode.com'),
        })
      }
      this.prisma = (prismaOrConfig as PrismaClient) ?? new PrismaClient()
    } else {
      // Backward compatible: (rpcUrlOrClient, prisma?, config?)
      if (typeof configOrRpc === 'string') {
        this.client = createPublicClient({
          chain: mainnet,
          transport: http(configOrRpc),
        })
      } else {
        this.client = configOrRpc as ReturnType<typeof createPublicClient>
      }
      this.prisma = (rpcOrPrisma as PrismaClient) ?? new PrismaClient()
      this.config = (prismaOrConfig as ProtocolConfig) ?? DEFAULT_SKY_CONFIG
    }
  }

  getClient(): ReturnType<typeof createPublicClient> {
    return this.client
  }

  getPrisma(): PrismaClient {
    return this.prisma
  }

  getConfig(): ProtocolConfig {
    return this.config
  }

  async start(): Promise<void> {
    this.running = true
    logger.info({ protocol: this.config.id, name: this.config.name }, 'Governance Watcher started')

    // Load last known hat from DB for this protocol
    const latest = await this.prisma.spellRecord.findFirst({
      where: { protocolId: this.config.id },
      orderBy: { createdAt: 'desc' },
    })
    if (latest) {
      this.lastKnownHat = latest.spellAddress as Address
      logger.info({ protocol: this.config.id, hat: this.lastKnownHat }, 'Restored last known hat from DB')
    }

    while (this.running) {
      try {
        await this.poll()
      } catch (err) {
        logger.error({ protocol: this.config.id, err }, 'Poll error — continuing')
      }
      await sleep(POLL_INTERVAL_MS)
    }
  }

  stop(): void {
    this.running = false
    logger.info({ protocol: this.config.id }, 'Governance Watcher stopped')
  }

  async poll(): Promise<void> {
    // Check governance type
    if (this.config.governanceType === 'makerdao-spell') {
      await this.pollMakerDaoSpell()
    } else {
      // Generic / Governor watcher stub: checks if contract is responsive
      logger.debug({ protocol: this.config.id, type: this.config.governanceType }, 'Polling generic governor')
    }
  }

  private async pollMakerDaoSpell(): Promise<void> {
    const hat = await this.client.readContract({
      address: this.config.governanceContract as Address,
      abi: CHIEF_ABI,
      functionName: 'hat',
    }) as Address

    // Zero address = no active spell
    if (hat === '0x0000000000000000000000000000000000000000') {
      logger.debug({ protocol: this.config.id }, 'No active spell (hat = zero address)')
      this.lastKnownHat = hat
      return
    }

    // Hat unchanged — nothing to do
    if (hat === this.lastKnownHat) {
      logger.debug({ protocol: this.config.id, hat }, 'Hat unchanged')
      return
    }

    logger.info({
      protocol: this.config.id,
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
      logger.info({ protocol: this.config.id, spellAddress }, 'Spell already in DB — skipping')
      return
    }

    // Parse the spell contract
    const spell = await parseSpell(this.client, spellAddress)

    const now = new Date()

    // Use nextCastTime from contract if available and sane
    // Otherwise calculate from now + timelockDelay
    const earliestExecution = spell.nextCastTime > now
      ? spell.nextCastTime
      : new Date(now.getTime() + this.config.timelockDelay * 1000)

    // Expiration from contract if available
    const latestExecution = spell.expiration > now
      ? spell.expiration
      : new Date(now.getTime() + this.config.expirySeconds * 1000)

    // Calculate next office-hours slot if spell/protocol has the constraint
    const hasOfficeHours = this.config.officeHours && spell.officeHoursActive
    const nextExecutionWindow = hasOfficeHours
      ? nextOfficeHoursSlot(earliestExecution)
      : earliestExecution

    // Validate with zod
    const record = SpellRecordSchema.parse({
      protocolId: this.config.id,
      spellAddress,
      calledAt: now,
      earliestExecution,
      latestExecution,
      officeHoursActive: hasOfficeHours,
      nextExecutionWindow,
      calldata: '0x',
      actions: spell.actions,
    })

    const status = spell.done ? 'EXECUTED' : 'QUEUED'

    // Persist to DB
    await this.prisma.spellRecord.create({
      data: {
        protocolId: this.config.id,
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
      logger.info({ protocol: this.config.id, spellAddress }, 'Spell already executed — recorded in DB as EXECUTED')
      return
    }

    logger.info({
      protocol: this.config.id,
      spellAddress,
      description: spell.description.slice(0, 80),
      earliestExecution: earliestExecution.toISOString(),
      nextExecutionWindow: nextExecutionWindow.toISOString(),
      latestExecution: latestExecution.toISOString(),
      officeHoursActive: hasOfficeHours,
    }, '✅ SpellRecord created and queued')

    // Expiry warning
    const daysUntilExpiry = Math.floor(
      (latestExecution.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    )
    if (daysUntilExpiry <= 5) {
      logger.warn({ protocol: this.config.id, spellAddress, daysUntilExpiry }, '⚠️ Spell expires soon')
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
