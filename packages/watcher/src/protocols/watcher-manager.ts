import path from 'node:path'
import { createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'
import { PrismaClient } from '@prisma/client'
import { GovernanceWatcher } from '../watcher'
import { ProtocolConfig } from './types'
import { ProtocolRegistry, protocolRegistry } from './registry'
import { KeeperHubClient } from '@keeperhub/sdk'
import { KeeperHubScheduler } from '../kh-scheduler'
import { WorkflowTemplateFactory } from '../workflow-templates'
import { WEBHOOK_SERVER_PORT } from '../constants'
import { logger } from '../logger'

function webhookBaseUrl(): string {
  return process.env.AXON_WEBHOOK_BASE_URL ?? `http://localhost:${WEBHOOK_SERVER_PORT}`
}

export class WatcherManager {
  private client: ReturnType<typeof createPublicClient>
  private prisma: PrismaClient
  private registry: ProtocolRegistry
  private scheduler: KeeperHubScheduler
  private watchers: Map<string, GovernanceWatcher> = new Map()
  private running = false

  constructor(
    client?: ReturnType<typeof createPublicClient>,
    prisma?: PrismaClient,
    registry?: ProtocolRegistry,
    scheduler?: KeeperHubScheduler
  ) {
    this.client = client ?? createPublicClient({
      chain: mainnet,
      transport: http(process.env.ETH_RPC_URL ?? 'https://ethereum-rpc.publicnode.com'),
    })
    this.prisma = prisma ?? new PrismaClient()
    this.registry = registry ?? protocolRegistry
    this.scheduler = scheduler ?? new KeeperHubScheduler()
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

    // Dual detection: KeeperHub scheduler runs alongside the polling watcher.
    // First detector to see a new hat wins; the webhook handler deduplicates.
    this.scheduler.startScheduler(config, webhookBaseUrl()).catch((err) => {
      logger.error({ protocol: config.id, err }, 'Scheduler start error')
    })

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
    this.scheduler.stopScheduler(protocolId).catch(() => {})
  }

  async registerAndWatch(config: ProtocolConfig): Promise<GovernanceWatcher> {
    const registered = this.registry.register(config)
    const watcher = await this.startWatcher(registered)
    // Publish the governor-specific template before watching starts.
    await this.ensureTemplate(registered).catch((err) => {
      logger.warn({ protocol: config.id, err: err?.message }, 'Template publish failed — watching anyway')
    })
    return watcher
  }

  /**
   * Phase 9 F4 — generate + publish the governor-specific KeeperHub
   * template and store its id/url on the org's Protocol row (if present).
   */
  async ensureTemplate(config: ProtocolConfig): Promise<{ templateId: string; templateUrl: string } | null> {
    const key = process.env.KEEPERHUB_API_KEY
    if (!key) {
      logger.debug({ protocol: config.id }, 'Template publish skipped — no KeeperHub key')
      return null
    }
    const published = await WorkflowTemplateFactory.publishTemplate(
      new KeeperHubClient({ apiKey: key }),
      config
    )
    if (published) {
      try {
        await this.prisma.protocol.updateMany({
          where: { id: config.id },
          data: {
            keeperHubTemplateId: published.templateId,
            keeperHubTemplateUrl: published.templateUrl,
          },
        })
      } catch (err: any) {
        logger.warn({ err: err?.message, protocol: config.id }, 'Template id persist failed')
      }
    }
    return published
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
    // Phase 9 F4 — publish missing governor templates BEFORE awaiting the
    // watchers below (their start() loops forever, so anything after the
    // await would never run). Covers file/CLI/dashboard registrations
    // converging on the watcher service.
    await this.ensureAllTemplates()

    await Promise.all(promises)
  }

  /**
   * Publish templates for every registered protocol missing one.
   * CLI (`axon init`) and dashboard registrations converge here.
   */
  async ensureAllTemplates(): Promise<void> {
    const results = await Promise.allSettled(
      this.registry.list().map((config) => this.ensureTemplate(config))
    )
    const published = results.filter(
      (r) => r.status === 'fulfilled' && r.value !== null
    ).length
    if (published > 0) {
      logger.info({ published }, 'KeeperHub templates ensured')
    }
  }

  stopAll(): void {
    this.running = false
    for (const [id, watcher] of this.watchers.entries()) {
      watcher.stop()
      this.scheduler.stopScheduler(id).catch(() => {})
    }
    this.watchers.clear()
    this.scheduler.stopAll()
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
