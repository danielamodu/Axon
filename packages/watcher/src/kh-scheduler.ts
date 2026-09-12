import { KeeperHubClient, type CreateWorkflowInput, type WorkflowNode, type WorkflowEdge } from '@keeperhub/sdk'
import type { ProtocolConfig } from './protocols/types'
import { CHIEF_ABI } from './abi'
import { logger } from './logger'

/**
 * Phase 9, Feature 3 — KeeperHub scheduler as a parallel detection path.
 *
 * The 12-second polling loop in watcher.ts stays. In addition, a KeeperHub
 * workflow on a schedule trigger reads the governance contract and POSTs
 * /webhook/hat-change when the hat moves. Both paths write to the same
 * SpellRecord table; the webhook handler deduplicates (first detector wins).
 */
export const SCHEDULER_INTERVAL_SECONDS = 12

export class KeeperHubScheduler {
  private khClient: KeeperHubClient | null
  private workflows: Map<string, string> = new Map() // protocolId -> workflowId

  constructor(apiKeyOrClient?: string | KeeperHubClient) {
    if (typeof apiKeyOrClient === 'object' && apiKeyOrClient !== null) {
      this.khClient = apiKeyOrClient
    } else if (typeof apiKeyOrClient === 'string' && apiKeyOrClient) {
      this.khClient = new KeeperHubClient({ apiKey: apiKeyOrClient })
    } else {
      const key = process.env.KEEPERHUB_API_KEY
      this.khClient = key ? new KeeperHubClient({ apiKey: key }) : null
    }
  }

  get isConfigured(): boolean {
    return this.khClient !== null
  }

  workflowIdFor(protocolId: string): string | undefined {
    return this.workflows.get(protocolId)
  }

  /**
   * Build the detector workflow shape. Pure — no network calls, fully testable.
   */
  buildDetectorWorkflow(config: ProtocolConfig, webhookBaseUrl: string): CreateWorkflowInput {
    const readNode: WorkflowNode = {
      id: 'read-hat',
      type: 'action',
      data: {
        label: `Read ${config.name} governance state`,
        type: 'web3/read-contract',
        tags: ['axon:scheduler-read'],
        config: {
          contractAddress: config.governanceContract,
          chainId: String(config.chainId),
          functionName: config.governanceType === 'makerdao-spell' ? 'hat' : 'state',
          abi: config.governanceType === 'makerdao-spell' ? JSON.stringify(CHIEF_ABI) : '[]',
        },
      },
      position: { x: 0, y: 150 },
    }

    const nodes: WorkflowNode[] = [
      {
        id: 'schedule',
        type: 'trigger',
        data: {
          label: `Every ${SCHEDULER_INTERVAL_SECONDS}s`,
          type: 'schedule',
          tags: ['axon:scheduler-trigger'],
          config: { intervalSeconds: SCHEDULER_INTERVAL_SECONDS },
        },
        position: { x: 0, y: 0 },
      },
      readNode,
      {
        id: 'report-hat',
        type: 'action',
        data: {
          label: 'Report hat to Axon',
          type: 'webhook',
          tags: ['axon:scheduler-report'],
          config: {
            url: `${webhookBaseUrl.replace(/\/$/, '')}/webhook/hat-change`,
            method: 'POST',
            body: JSON.stringify({
              protocolId: config.id,
              newHat: '{{@read-hat.result}}',
              detectedAt: '{{@schedule.firedAt}}',
              timelockDelay: config.timelockDelay,
            }),
          },
        },
        position: { x: 0, y: 300 },
      },
    ]

    const edges: WorkflowEdge[] = [
      { id: 'sched-e0', source: 'schedule', target: 'read-hat' },
      { id: 'sched-e1', source: 'read-hat', target: 'report-hat' },
    ]

    return {
      name: `axon-governance-detector-${config.id}`,
      description: `Axon dual-detection scheduler for ${config.name}: reads governance state every ${SCHEDULER_INTERVAL_SECONDS}s and reports hat changes.`,
      nodes,
      edges,
    }
  }

  /** Start scheduler for a protocol. No-op without a KeeperHub key. */
  async startScheduler(config: ProtocolConfig, webhookBaseUrl: string): Promise<string | null> {
    if (!this.khClient) {
      logger.info({ protocol: config.id }, 'KeeperHub scheduler skipped — no API key')
      return null
    }
    if (this.workflows.has(config.id)) {
      return this.workflows.get(config.id)!
    }
    const input = this.buildDetectorWorkflow(config, webhookBaseUrl)
    const workflow = await this.khClient.createWorkflow(input)
    this.workflows.set(config.id, workflow.id)
    logger.info(
      { protocol: config.id, workflowId: workflow.id },
      '📡 KeeperHub detection scheduler started'
    )
    return workflow.id
  }

  async stopScheduler(protocolId: string): Promise<void> {
    const workflowId = this.workflows.get(protocolId)
    if (!workflowId) return
    try {
      await this.khClient?.deleteWorkflow(workflowId)
    } catch (err: any) {
      logger.warn({ err: err?.message, protocolId }, 'Scheduler workflow delete failed — forgetting anyway')
    }
    this.workflows.delete(protocolId)
  }

  stopAll(): void {
    this.workflows.clear()
  }
}
