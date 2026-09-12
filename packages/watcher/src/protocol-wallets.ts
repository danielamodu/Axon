import { KeeperHubClient } from '@keeperhub/sdk'
import { PrismaClient } from '@prisma/client'
import type { ProtocolConfig } from './protocols/types'
import { logger } from './logger'

/**
 * Phase 9, Feature 5 — per-protocol KeeperHub agentic wallets.
 *
 * Each registered protocol gets a scoped executor wallet that may only touch
 * its own governance contract (cast/execute/queue, capped value, daily limit).
 * The executor threads the protocol's walletId into workflow creation so one
 * protocol's transactions can never spend another's scope.
 *
 * The SDK exposes no typed wallet endpoint, so provisioning goes through
 * rawRequest. If KeeperHub does not offer the endpoint, provisioning returns
 * null and execution falls back to the shared wallet — logged, never silent.
 */
export interface ProtocolWallet {
  walletId: string
  address: string
}

export class ProtocolWalletManager {
  private khClient: KeeperHubClient | null
  private prisma: PrismaClient | null

  constructor(apiKeyOrClient?: string | KeeperHubClient, prisma?: PrismaClient) {
    if (typeof apiKeyOrClient === 'object' && apiKeyOrClient !== null) {
      this.khClient = apiKeyOrClient
    } else if (typeof apiKeyOrClient === 'string' && apiKeyOrClient) {
      this.khClient = new KeeperHubClient({ apiKey: apiKeyOrClient })
    } else {
      const key = process.env.KEEPERHUB_API_KEY
      this.khClient = key ? new KeeperHubClient({ apiKey: key }) : null
    }
    this.prisma = prisma ?? null
  }

  get isConfigured(): boolean {
    return this.khClient !== null
  }

  /**
   * Provision a scoped wallet for a protocol and persist it on the Protocol row.
   * Returns the wallet, or null when KeeperHub is unreachable/unconfigured or
   * offers no wallet endpoint (caller falls back to the shared wallet).
   */
  async provisionWallet(protocolId: string, config: ProtocolConfig): Promise<ProtocolWallet | null> {
    if (!this.khClient) {
      logger.info({ protocol: protocolId }, 'Wallet provisioning skipped — no KeeperHub key')
      return null
    }
    try {
      const res = await this.khClient.rawRequest<{ walletId?: string; id?: string; address?: string }>(
        '/api/wallets',
        {
          method: 'POST',
          body: JSON.stringify({
            name: `axon-${protocolId}-executor`,
            scopes: [
              {
                chainId: config.chainId,
                allowedContracts: [config.governanceContract],
                allowedFunctions: ['cast()', 'execute()', 'queue()'],
                maxValuePerTx: '0.1',
                dailyLimit: '0.5',
              },
            ],
          }),
        }
      )
      const walletId = res?.walletId ?? res?.id
      const address = res?.address ?? ''
      if (!walletId) {
        logger.warn({ protocol: protocolId }, 'Wallet endpoint returned no wallet id — shared wallet fallback')
        return null
      }
      const wallet = { walletId, address }
      await this.persist(protocolId, wallet)
      logger.info({ protocol: protocolId, address }, `👛 Provisioned KeeperHub wallet for ${protocolId}: ${address}`)
      return wallet
    } catch (err: any) {
      logger.warn(
        { err: err?.message, protocol: protocolId },
        'Wallet provisioning failed (endpoint may be unavailable) — shared wallet fallback'
      )
      return null
    }
  }

  /** Look up the stored wallet for a protocol (null = use shared wallet). */
  async getWallet(protocolId: string): Promise<ProtocolWallet | null> {
    if (!this.prisma) return null
    try {
      const row = await this.prisma.protocol.findFirst({ where: { id: protocolId } })
      if (!row?.keeperHubWalletId) return null
      return { walletId: row.keeperHubWalletId, address: row.keeperHubWalletAddress ?? '' }
    } catch {
      return null
    }
  }

  private async persist(protocolId: string, wallet: ProtocolWallet): Promise<void> {
    if (!this.prisma) return
    try {
      await this.prisma.protocol.updateMany({
        where: { id: protocolId },
        data: {
          keeperHubWalletId: wallet.walletId,
          keeperHubWalletAddress: wallet.address,
        },
      })
    } catch (err: any) {
      logger.warn({ err: err?.message, protocol: protocolId }, 'Wallet persist failed')
    }
  }
}
