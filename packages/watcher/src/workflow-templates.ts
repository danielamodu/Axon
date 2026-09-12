import {
  KeeperHubClient,
  type CreateWorkflowInput,
  type WorkflowEdge,
  type WorkflowNode,
} from '@keeperhub/sdk'
import type { GovernanceType, ProtocolConfig } from './protocols/types'
import { CHIEF_ABI, SPELL_ABI } from './abi'
import { logger } from './logger'

/**
 * Phase 9, Feature 4 — protocol-specific KeeperHub workflow templates.
 *
 * Each governor architecture gets its own guard → simulate → execute →
 * verify shape. Every template ends with the same three nodes:
 * registry webhook (Node 7), discord success (Node 8) and the simulation
 * failure branch (Node 4a). All nodes carry axon: metadata tags so the
 * pipeline stays legible inside KeeperHub's dashboard.
 */

export interface TemplateSpec {
  templateName: string
  readFunction: string
  readArgs: string
  expectedState: string
  executeFunction: string
  executeArgs: string
  verifyFunction: string
  executedState: string
}

const TEMPLATE_SPECS: Record<GovernanceType, TemplateSpec> = {
  'makerdao-spell': {
    templateName: 'axon-makerdao-spell-execution',
    readFunction: 'hat',
    readArgs: '[]',
    expectedState: 'spell matches hat',
    executeFunction: 'cast',
    executeArgs: '[]',
    verifyFunction: 'hat',
    executedState: 'hat rotated',
  },
  'compound-governor': {
    templateName: 'axon-compound-governor-execution',
    readFunction: 'state',
    readArgs: '["{{@trigger.proposalId}}"]',
    expectedState: '4 (Queued)',
    executeFunction: 'execute',
    executeArgs: '["{{@trigger.proposalId}}"]',
    verifyFunction: 'state',
    executedState: '5 (Executed)',
  },
  'openzeppelin-governor': {
    templateName: 'axon-openzeppelin-governor-execution',
    readFunction: 'state',
    readArgs: '["{{@trigger.proposalId}}"]',
    expectedState: '5 (Queued)',
    executeFunction: 'execute',
    executeArgs: '["{{@trigger.targets}}","{{@trigger.values}}","{{@trigger.calldatas}}","{{@trigger.descriptionHash}}"]',
    verifyFunction: 'state',
    executedState: '7 (Executed)',
  },
  'optimistic-timelock': {
    templateName: 'axon-optimistic-timelock-execution',
    readFunction: 'isOperationReady',
    readArgs: '["{{@trigger.operationId}}"]',
    expectedState: 'true (ready)',
    executeFunction: 'execute',
    executeArgs: '["{{@trigger.target}}","{{@trigger.value}}","{{@trigger.data}}","{{@trigger.salt}}"]',
    verifyFunction: 'isOperationDone',
    executedState: 'true (done)',
  },
}

export function templateSpecFor(governanceType: GovernanceType): TemplateSpec {
  return TEMPLATE_SPECS[governanceType]
}

function node(
  id: string,
  type: WorkflowNode['type'],
  label: string,
  nodeType: string,
  tag: string,
  config: Record<string, unknown>,
  y: number
): WorkflowNode {
  return {
    id,
    type,
    data: { label, type: nodeType, tags: [tag], config },
    position: { x: 0, y },
  } as WorkflowNode
}

export class WorkflowTemplateFactory {
  /**
   * Generate the execution template for a protocol config. Pure — no network.
   */
  static generateTemplate(config: ProtocolConfig): CreateWorkflowInput {
    const spec = templateSpecFor(config.governanceType)
    const isMaker = config.governanceType === 'makerdao-spell'
    const abi = isMaker ? JSON.stringify(SPELL_ABI) : '[]'

    const nodes: WorkflowNode[] = [
      node('trigger', 'trigger', 'Manual Trigger', 'manual', 'axon:workflow-trigger', {}, 0),
      node('read-state', 'action', `Read ${spec.readFunction}`, 'web3/read-contract', 'axon:template-read', {
        contractAddress: config.governanceContract,
        chainId: String(config.chainId),
        functionName: spec.readFunction,
        functionArgs: spec.readArgs,
        abi: isMaker ? JSON.stringify(CHIEF_ABI) : '[]',
      }, 150),
      node('check-state', 'condition', `Expect ${spec.expectedState}`, 'condition', 'axon:template-condition', {
        leftValue: '{{@read-state.result}}',
        operator: 'eq',
        rightValue: spec.expectedState,
      }, 300),
      node('simulate-execute', 'action', `Simulate ${spec.executeFunction}`, 'web3/simulate-contract', 'axon:pre-flight-simulation', {
        contractAddress: config.governanceContract,
        chainId: String(config.chainId),
        functionName: spec.executeFunction,
        functionArgs: spec.executeArgs,
        abi,
      }, 450),
      node('check-simulation', 'condition', 'Simulation passed (no revert)', 'condition', 'axon:simulation-condition', {
        leftValue: '{{@simulate-execute.wouldRevert}}',
        operator: 'eq',
        rightValue: 'false',
      }, 600),
      node('notify-failure', 'action', 'Notify Simulation Failed (Discord)', 'notification/discord', 'axon:notify-failure', {
        webhookUrl: process.env.DISCORD_WEBHOOK_URL ?? '',
        message: JSON.stringify({ title: '🛑 Template simulation failed', protocol: config.id }),
      }, 600),
      node('execute-action', 'action', `Execute ${spec.executeFunction}`, 'web3/write-contract', 'axon:governance-execution', {
        contractAddress: config.governanceContract,
        chainId: String(config.chainId),
        functionName: spec.executeFunction,
        functionArgs: spec.executeArgs,
        abi,
        gasLimitMultiplier: '1.3',
      }, 750),
      node('verify-state', 'action', `Verify ${spec.verifyFunction}`, 'web3/read-contract', 'axon:post-execution-verify', {
        contractAddress: config.governanceContract,
        chainId: String(config.chainId),
        functionName: spec.verifyFunction,
        abi: isMaker ? JSON.stringify(CHIEF_ABI) : '[]',
      }, 900),
      node('notify-registry', 'action', 'Notify Axon Registry', 'webhook', 'axon:registry-write', {
        url: process.env.AXON_REGISTRY_ENDPOINT ?? 'https://registry.axon.internal/executions',
        method: 'POST',
        body: JSON.stringify({ protocolId: config.id, executedAt: '{{@execute-action.completedAt}}' }),
      }, 1050),
      node('notify-success', 'action', 'Notify Execution Succeeded (Discord)', 'notification/discord', 'axon:notify-success', {
        webhookUrl: process.env.DISCORD_WEBHOOK_URL ?? '',
        message: JSON.stringify({ title: '✅ Template execution confirmed', protocol: config.id }),
      }, 1200),
    ]

    const edges: WorkflowEdge[] = [
      { id: 't0', source: 'trigger', target: 'read-state' },
      { id: 't1', source: 'read-state', target: 'check-state' },
      { id: 't2', source: 'check-state', target: 'simulate-execute', sourceHandle: 'true' },
      { id: 't3', source: 'simulate-execute', target: 'check-simulation' },
      { id: 't4', source: 'check-simulation', target: 'execute-action', sourceHandle: 'true' },
      { id: 't4a', source: 'check-simulation', target: 'notify-failure', sourceHandle: 'false' },
      { id: 't5', source: 'execute-action', target: 'verify-state' },
      { id: 't6', source: 'verify-state', target: 'notify-registry' },
      { id: 't7', source: 'notify-registry', target: 'notify-success' },
    ]

    return {
      name: `${spec.templateName}-${config.id}`,
      description: `Axon ${config.governanceType} execution template for ${config.name}. Expects ${spec.expectedState}; verifies ${spec.executedState}.`,
      nodes,
      edges,
    }
  }

  /**
   * Publish a generated template to the KeeperHub marketplace. Returns the
   * template workflow id, or null when KeeperHub is unreachable.
   */
  static async publishTemplate(
    khClient: KeeperHubClient,
    config: ProtocolConfig
  ): Promise<{ templateId: string; templateUrl: string } | null> {
    const input = WorkflowTemplateFactory.generateTemplate(config)
    try {
      const workflow = await khClient.createWorkflow(input)
      const templateUrl = `https://app.keeperhub.com/workflows/${workflow.id}`
      try {
        await khClient.rawRequest(`/workflows/${workflow.id}/list`, {
          method: 'POST',
          body: JSON.stringify({
            slug: input.name,
            category: 'defi',
            chain: String(config.chainId),
            workflowType: 'write',
          }),
        })
      } catch (err: any) {
        logger.warn({ err: err?.message, workflowId: workflow.id }, 'Template marketplace publish failed — continuing')
      }
      logger.info(
        { protocol: config.id, templateId: workflow.id, type: config.governanceType },
        `📋 Published ${config.governanceType} template: ${workflow.id}`
      )
      return { templateId: workflow.id, templateUrl }
    } catch (err: any) {
      logger.warn({ err: err?.message, protocol: config.id }, 'Template publish failed')
      return null
    }
  }
}
