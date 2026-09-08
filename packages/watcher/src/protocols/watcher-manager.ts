import path from 'node:path'
import { createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'
import { PrismaClient } from '@prisma/client'
import { GovernanceWatcher } from '../watcher'
import { ProtocolConfig } from './types'
import { ProtocolRegistry, protocolRegistry } from './registry'
import { logger } from '../logger'

export class WatcherManager {
  private client: ReturnType<typeof createPublicClient>
  private prisma: PrismaClient
  private registry: ProtocolRegistry
  private watchers: Map<string, GovernanceWatcher> = new Map()
  private running = false

  constructor(
    client?: ReturnType<typeof createPublicClient>,
    prisma?: PrismaClient,
    registry?: ProtocolRegistry
  ) {
    this.client = client ?? createPublicClient({
      chain: mainnet,
      transport: http(process.env.ETH_RPC_URL ?? 'https://ethereum-rpc.publicnode.com'),
    })
    this.prisma = prisma ?? new PrismaClient()
    this.registry = registry ?? protocolRegistry
  }

  getClient(): ReturnType<typeof createPublicClient> {
    return this.client
  }

  getPrisma(): PrismaClient {
    return this.prisma
  }

  getRegistry(): ProtocolRegistry {
    return this.registry
  }

  loadConfigs(dirPath?: string): ProtocolConfig[] {
    const configsDir = dirPath ?? path.join(__dirname, 'configs')
    return this.registry.loadFromDirectory(configsDir)
  }

  async startWatcher(config: ProtocolConfig): Promise<GovernanceWatcher> {
    if (this.watchers.has(config.id)) {
      return this.watchers.get(config.id)!
    }

    const watcher = new GovernanceWatcher(config, this.client, this.prisma)
    this.watchers.set(config.id, watcher)

    if (this.running) {
      watcher.start().catch((err) => {
        logger.error({ protocol: config.id, err }, 'Watcher run error')
      })
    }

    return watcher
  }

  stopWatcher(protocolId: string): void {
    const watcher = this.watchers.get(protocolId)
    if (watcher) {
      watcher.stop()
      this.watchers.delete(protocolId)
    }
  }

  async registerAndWatch(config: ProtocolConfig): Promise<GovernanceWatcher> {
    const registered = this.registry.register(config)
    return this.startWatcher(registered)
  }

  async startAll(): Promise<void> {
    this.running = true
    logger.info({ count: this.registry.list().length }, 'Starting all protocol watchers')

    const promises: Promise<void>[] = []
    for (const config of this.registry.list()) {
      if (!this.watchers.has(config.id)) {
        const watcher = new GovernanceWatcher(config, this.client, this.prisma)
        this.watchers.set(config.id, watcher)
      }
      const watcher = this.watchers.get(config.id)!
      promises.push(
        watcher.start().catch((err) => {
          logger.error({ protocol: config.id, err }, 'Watcher fatal error')
        })
      )
    }
    await Promise.all(promises)
  }

  stopAll(): void {
    this.running = false
    for (const [id, watcher] of this.watchers.entries()) {
      watcher.stop()
    }
    this.watchers.clear()
    logger.info('All protocol watchers stopped')
  }

  getWatcher(protocolId: string): GovernanceWatcher | undefined {
    return this.watchers.get(protocolId)
  }

  listWatchers(): { protocol: ProtocolConfig; running: boolean }[] {
    return this.registry.list().map((p) => ({
      protocol: p,
      running: this.watchers.has(p.id),
    }))
  }
}
