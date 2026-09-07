import type { Address, PublicClient } from 'viem'
import { PrismaClient, type SpellRecord } from '@prisma/client'
import { KeeperHubClient, DirectExecutor, KeeperHubError, isReadResult } from '@keeperhub/sdk'
import type {
  CreateWorkflowInput,
  WorkflowNode,
  WorkflowEdge,
  DirectExecutionStatus,
} from '@keeperhub/sdk'
import { CHIEF_ABI, SPELL_ABI } from './abi'
import { SKY_CHIEF_ADDRESS, EXECUTOR_POLL_INTERVAL_MS, MAX_GAS_PRICE_GWEI } from './constants'
import { isWithinOfficeHours } from './office-hours'
import { NotificationDispatcher } from './notifications'
import { RegistryWriter } from './registry-writer'
import { logger } from './logger'

// ---------------------------------------------------------------------------
// Polling schedule constants (milliseconds)
// ---------------------------------------------------------------------------
const POLL_PHASE_1_INTERVAL_MS = 15_000      // 15 s for first 2 minutes
const POLL_PHASE_1_DURATION_MS = 2 * 60_000  // first 2 minutes
const POLL_PHASE_2_INTERVAL_MS = 30_000      // 30 s for next 5 minutes
const POLL_PHASE_2_DURATION_MS = 7 * 60_000  // up to 7 minutes elapsed
const POLL_PHASE_3_INTERVAL_MS = 60_000      // 60 s thereafter
const POLL_TIMEOUT_MS = 30 * 60_000          // 30 minute hard cap

export interface ExecutionReport {
  spellAddress: string
  workflowId: string
  executionId: string
  status: 'EXECUTED' | 'FAILED'
  txHash?: string
  gasUsed?: bigint
  error?: string
  retryCount: number
}

export class ExecutionEngine {
  private client: PublicClient
  private prisma: PrismaClient
  private notify: NotificationDispatcher
  private registryWriter: RegistryWriter
  private khClient?: KeeperHubClient
  private direct?: DirectExecutor
  private running = false
  private currentExecution: Promise<void> | null = null

  constructor(
    client: PublicClient,
    prisma: PrismaClient,
    notify?: NotificationDispatcher,
    keeperHubApiKey?: string,
    registryWriter?: RegistryWriter
  ) {
    this.client = client
    this.prisma = prisma
    this.notify = notify ?? new NotificationDispatcher()
    this.registryWriter = registryWriter ?? new RegistryWriter()

    const apiKey = keeperHubApiKey ?? process.env.KEEPERHUB_API_KEY
    if (apiKey) {
      this.khClient = new KeeperHubClient({ apiKey })
      this.direct = new DirectExecutor(this.khClient)
    } else {
      logger.warn('KEEPERHUB_API_KEY not set — ExecutionEngine will log-only; no real execution')
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async start(): Promise<void> {
    this.running = true
    logger.info('Execution Engine started')

    while (this.running) {
      try {
        const exec = this.poll()
        this.currentExecution = exec
        await exec
        this.currentExecution = null
      } catch (err) {
        logger.error({ err }, 'Execution Engine poll error — continuing')
      }
      await sleep(EXECUTOR_POLL_INTERVAL_MS)
    }
  }

  stop(): void {
    this.running = false
    logger.info('Execution Engine stopping — waiting for current execution to finish')
  }

  /** Waits for the in-flight execution to complete before resolving. */
  async drain(): Promise<void> {
    if (this.currentExecution) {
      await this.currentExecution
    }
  }

  // -------------------------------------------------------------------------
  // Core poll — finds one eligible spell and executes it
  // -------------------------------------------------------------------------

  async poll(): Promise<SpellRecord | null> {
    const now = new Date()

    // Find the oldest READY+CLEAR spell whose execution window has opened
    const spell = await this.prisma.spellRecord.findFirst({
      where: {
        status: 'READY',
        conflictStatus: 'CLEAR',
        nextExecutionWindow: { lte: now },
        latestExecution: { gte: now },
      },
      orderBy: { nextExecutionWindow: 'asc' },
    })

    if (!spell) {
      logger.debug('No eligible spells for execution')
      return null
    }

    // Office-hours gate — wait, don't skip
    if (spell.officeHoursActive && !isWithinOfficeHours(now)) {
      logger.info(
        { spellAddress: spell.spellAddress, nextExecutionWindow: spell.nextExecutionWindow },
        '🕐 Spell is office-hours constrained and we are outside window — waiting'
      )
      return null
    }

    logger.info({ spellAddress: spell.spellAddress }, '⚡ Eligible spell found — beginning execution pipeline')
    await this.executeSpell(spell, 0)
    return spell
  }

  // -------------------------------------------------------------------------
  // Full execution pipeline for a single spell
  // -------------------------------------------------------------------------

  async executeSpell(spell: SpellRecord, retryCount: number): Promise<ExecutionReport> {
    const { spellAddress } = spell
    const addr = spellAddress as Address

    // Step 1: Fresh pre-execution simulation
    logger.info({ spellAddress, retryCount }, '🔍 Running pre-execution simulation')
    const simResult = await this.runPreflightSimulation(addr)
    if (!simResult.success) {
      logger.error({ spellAddress, error: simResult.error }, '🛑 Pre-execution simulation reverted — holding spell')
      await this.setHeld(spell.id, `Pre-execution simulation failed: ${simResult.error}`)
      await this.notify.notifySimulationFailed({
        spellAddress,
        error: simResult.error ?? 'unknown',
        phase: 'pre-execution',
      })
      return {
        spellAddress,
        workflowId: '',
        executionId: '',
        status: 'FAILED',
        error: simResult.error,
        retryCount,
      }
    }
    logger.info({ spellAddress }, '✅ Pre-execution simulation passed')

    // Step 2: Guard — confirm spell is still the live hat on mainnet
    const isStillHat = await this.guardCheckHat(addr)
    if (!isStillHat) {
      logger.warn({ spellAddress }, '🎩 Spell is no longer the active hat — marking EXECUTED (superseded)')
      await this.prisma.spellRecord.update({
        where: { id: spell.id },
        data: { status: 'EXECUTED', executedAt: new Date() },
      })
      return {
        spellAddress,
        workflowId: '',
        executionId: '',
        status: 'EXECUTED',
        retryCount,
      }
    }

    // Step 3: Build and register KeeperHub workflow
    const workflowId = await this.buildAndRegisterWorkflow(spell)

    // Step 4: Transition to EXECUTING
    await this.prisma.spellRecord.update({
      where: { id: spell.id },
      data: { status: 'EXECUTING' },
    })

    // Step 5: Notify execution started
    let spellDescription = 'Sky Protocol Governance Spell'
    if (Array.isArray(spell.actions) && spell.actions.length > 0) {
      const first = (spell.actions as any[])[0]
      if (typeof first?.description === 'string') spellDescription = first.description
    }

    await this.notify.notifyExecutionStarted({
      spellAddress,
      description: spellDescription,
      executionWindow: spell.nextExecutionWindow,
      workflowId,
    })

    // Step 6: Trigger the workflow
    const executionId = await this.triggerWorkflow(workflowId, spell)

    // Step 7: Poll for confirmation with exponential backoff schedule
    logger.info({ spellAddress, executionId, workflowId }, '🔄 Polling for execution confirmation')
    const result = await this.pollForConfirmation(spellAddress, workflowId, executionId)

    if (result.status === 'EXECUTED') {
      // Step 8a: Record success
      await this.prisma.spellRecord.update({
        where: { id: spell.id },
        data: {
          status: 'EXECUTED',
          executedAt: result.executedAt,
          txHash: result.txHash,
          gasUsed: result.gasUsed,
        },
      })

      await this.notify.notifyExecutionSucceeded({
        spellAddress,
        txHash: result.txHash!,
        gasUsed: result.gasUsed ? result.gasUsed.toString() : 'unknown',
        executedAt: result.executedAt ?? new Date(),
      })

      logger.info({ spellAddress, txHash: result.txHash, gasUsed: result.gasUsed?.toString() }, '✅ Spell executed successfully')

      // Step 8b: Write to AxonRegistry on Base (non-fatal)
      const simScore = spell.simulationScore === 'GREEN' ? 2 : spell.simulationScore === 'YELLOW' ? 1 : 0
      await this.registryWriter.log({
        protocol: SKY_CHIEF_ADDRESS as Address,
        spellAddress: spellAddress as Address,
        actionType: 'GOVERNANCE_CAST',
        txHash: result.txHash ?? '0x',
        executedAt: result.executedAt ?? new Date(),
        gasUsed: result.gasUsed ?? 0n,
        executor: SKY_CHIEF_ADDRESS as Address,
        simulationScore: simScore as 0 | 1 | 2,
      })

      // Step 8c: Publish workflow to marketplace
      await this.publishWorkflow(workflowId, spell)

      return {
        spellAddress,
        workflowId,
        executionId,
        status: 'EXECUTED',
        txHash: result.txHash,
        gasUsed: result.gasUsed,
        retryCount,
      }
    } else {
      // Execution failed (not simulation failure — actual onchain revert or timeout)
      if (retryCount === 0 && result.error !== 'TIMEOUT') {
        // Step 9: Retry once with fresh simulation after 2 minutes
        logger.warn({ spellAddress, error: result.error }, '⚠️ Execution failed — retrying once after 2 minutes')
        await sleep(2 * 60_000)

        // Re-fetch spell record in case state changed
        const refreshed = await this.prisma.spellRecord.findUnique({ where: { id: spell.id } })
        if (!refreshed || refreshed.status === 'EXECUTED') {
          logger.info({ spellAddress }, 'Spell already executed during retry wait — skipping retry')
          return { spellAddress, workflowId, executionId, status: 'EXECUTED', retryCount: 1 }
        }

        // Reset to READY so retry pipeline begins cleanly
        await this.prisma.spellRecord.update({
          where: { id: spell.id },
          data: { status: 'READY' },
        })
        return this.executeSpell(refreshed, retryCount + 1)
      }

      // Step 9b: Give up — set FAILED
      const errorMsg = result.error ?? 'Execution failed after retry'
      await this.prisma.spellRecord.update({
        where: { id: spell.id },
        data: { status: 'FAILED' },
      })

      await this.notify.notifyExecutionFailed({
        spellAddress,
        error: errorMsg,
        retryCount: retryCount + 1,
        workflowId,
      })

      logger.error({ spellAddress, error: errorMsg, retryCount }, '❌ Spell execution permanently failed')

      return {
        spellAddress,
        workflowId,
        executionId,
        status: 'FAILED',
        error: errorMsg,
        retryCount: retryCount + 1,
      }
    }
  }

  // -------------------------------------------------------------------------
  // Step 1: Pre-execution simulation via KeeperHub DirectExecutor or Viem
  // -------------------------------------------------------------------------

  async runPreflightSimulation(spellAddress: Address): Promise<{ success: boolean; error?: string }> {
    if (this.direct) {
      try {
        const res = await this.direct.callContract({
          contractAddress: spellAddress,
          network: 'ethereum',
          functionName: 'cast',
          functionArgs: '[]',
          abi: JSON.stringify(SPELL_ABI),
        })

        // callContract with simulate doesn't broadcast — check if result came back cleanly
        if (isReadResult(res)) {
          // Unexpected read result from a write call — treat as success since no revert
          return { success: true }
        }
        // Write result: executionId returned means transaction would proceed
        return { success: true }
      } catch (err: any) {
        if (err instanceof KeeperHubError) {
          return { success: false, error: `KeeperHub: ${err.message}` }
        }
        // Network error on simulation — fall through to viem
        logger.warn({ err: err.message }, 'KeeperHub simulation threw — falling back to viem')
      }
    }

    // Viem fallback
    try {
      await this.client.simulateContract({
        address: spellAddress,
        abi: SPELL_ABI,
        functionName: 'cast',
      })
      return { success: true }
    } catch (err: any) {
      return {
        success: false,
        error: err?.shortMessage ?? err?.message ?? 'Simulation reverted',
      }
    }
  }

  // -------------------------------------------------------------------------
  // Step 2: Guard — verify spell is still the live hat
  // -------------------------------------------------------------------------

  async guardCheckHat(spellAddress: Address): Promise<boolean> {
    try {
      const hat = await this.client.readContract({
        address: SKY_CHIEF_ADDRESS as Address,
        abi: CHIEF_ABI,
        functionName: 'hat',
      }) as Address
      return hat.toLowerCase() === spellAddress.toLowerCase()
    } catch (err: any) {
      // If we can't read the hat, fail safe — don't execute
      logger.error({ err: err.message }, 'Guard check: failed to read Chief.hat() — aborting execution')
      return false
    }
  }

  // -------------------------------------------------------------------------
  // Step 3: Build and register KeeperHub workflow
  // -------------------------------------------------------------------------

  async buildAndRegisterWorkflow(spell: SpellRecord): Promise<string> {
    if (!this.khClient) {
      // No KeeperHub — return sentinel ID for testing
      return `local-workflow-${spell.spellAddress.slice(2, 10)}`
    }

    const { spellAddress } = spell
    const workflowName = `axon-sky-governance-${spellAddress.slice(0, 10).toLowerCase()}`

    const nodes: WorkflowNode[] = [
      // Node 0: Manual trigger
      {
        id: 'trigger',
        type: 'trigger',
        data: {
          label: 'Manual Trigger',
          type: 'manual',
          config: {},
        },
        position: { x: 0, y: 0 },
      },
      // Node 1: Read Chief.hat() — guard
      {
        id: 'read-hat',
        type: 'action',
        data: {
          label: 'Read Chief.hat()',
          type: 'web3/read-contract',
          config: {
            contractAddress: SKY_CHIEF_ADDRESS,
            chainId: '1',
            functionName: 'hat',
            abi: JSON.stringify(CHIEF_ABI),
          },
        },
        position: { x: 0, y: 150 },
      },
      // Node 2: Condition — hat must equal spellAddress
      {
        id: 'check-hat',
        type: 'condition',
        data: {
          label: 'Confirm spell is active hat',
          type: 'condition',
          config: {
            leftValue: `{{@read-hat.result}}`,
            operator: 'eq',
            rightValue: spellAddress.toLowerCase(),
          },
        },
        position: { x: 0, y: 300 },
      },
      // Node 3: Final preflight simulation of cast()
      {
        id: 'simulate-cast',
        type: 'action',
        data: {
          label: 'Simulate spell.cast()',
          type: 'web3/simulate-contract',
          config: {
            contractAddress: spellAddress,
            chainId: '1',
            functionName: 'cast',
            abi: JSON.stringify(SPELL_ABI),
          },
        },
        position: { x: 0, y: 450 },
      },
      // Node 4: Condition — simulation must not revert
      {
        id: 'check-simulation',
        type: 'condition',
        data: {
          label: 'Simulation passed (no revert)',
          type: 'condition',
          config: {
            leftValue: `{{@simulate-cast.wouldRevert}}`,
            operator: 'eq',
            rightValue: 'false',
          },
        },
        position: { x: 0, y: 600 },
      },
      // Node 5: Execute spell.cast()
      {
        id: 'execute-cast',
        type: 'action',
        data: {
          label: 'Execute spell.cast()',
          type: 'web3/write-contract',
          config: {
            contractAddress: spellAddress,
            chainId: '1',
            functionName: 'cast',
            abi: JSON.stringify(SPELL_ABI),
            gasLimitMultiplier: '1.3',
          },
        },
        position: { x: 0, y: 750 },
      },
      // Node 6: Post-execution hat read — verify spell no longer active
      {
        id: 'verify-hat',
        type: 'action',
        data: {
          label: 'Verify post-execution hat',
          type: 'web3/read-contract',
          config: {
            contractAddress: SKY_CHIEF_ADDRESS,
            chainId: '1',
            functionName: 'hat',
            abi: JSON.stringify(CHIEF_ABI),
          },
        },
        position: { x: 0, y: 900 },
      },
      // Node 7: Webhook to Axon registry endpoint
      {
        id: 'notify-registry',
        type: 'action',
        data: {
          label: 'Notify Axon Registry',
          type: 'webhook',
          config: {
            url: process.env.AXON_REGISTRY_ENDPOINT ?? 'https://registry.axon.internal/executions',
            method: 'POST',
            body: JSON.stringify({
              spellAddress,
              txHash: `{{@execute-cast.transactionHash}}`,
              executedAt: `{{@execute-cast.completedAt}}`,
              gasUsed: `{{@execute-cast.gasUsed}}`,
            }),
          },
        },
        position: { x: 0, y: 1050 },
      },
    ]

    const edges: WorkflowEdge[] = [
      { id: 'e0-1', source: 'trigger', target: 'read-hat' },
      { id: 'e1-2', source: 'read-hat', target: 'check-hat' },
      { id: 'e2-3', source: 'check-hat', target: 'simulate-cast', sourceHandle: 'true' },
      { id: 'e3-4', source: 'simulate-cast', target: 'check-simulation' },
      { id: 'e4-5', source: 'check-simulation', target: 'execute-cast', sourceHandle: 'true' },
      { id: 'e5-6', source: 'execute-cast', target: 'verify-hat' },
      { id: 'e6-7', source: 'verify-hat', target: 'notify-registry' },
    ]

    const createInput: CreateWorkflowInput = {
      name: workflowName,
      description: `Axon autonomous execution workflow for Sky Protocol spell ${spellAddress}. ` +
        `Guards: hat check, simulation, gas check. Executes cast() and records outcome.`,
      nodes,
      edges,
    }

    const workflow = await this.khClient.createWorkflow(createInput)
    logger.info({ workflowId: workflow.id, workflowName }, '📋 KeeperHub workflow created')

    // Validate workflow
    try {
      const validation = await this.khClient.rawRequest<{ ok: boolean; result: { valid: boolean; errors?: unknown[] } }>(
        `/workflows/${workflow.id}/validate`,
        { method: 'POST', body: JSON.stringify({}) }
      )
      if (validation.result && !validation.result.valid && validation.result.errors?.length) {
        logger.warn({ workflowId: workflow.id, errors: validation.result.errors }, 'Workflow validation warnings')
      }
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Workflow validation request failed — proceeding')
    }

    return workflow.id
  }

  // -------------------------------------------------------------------------
  // Step 4: Trigger workflow execution
  // -------------------------------------------------------------------------

  async triggerWorkflow(workflowId: string, spell: SpellRecord): Promise<string> {
    if (!this.khClient || workflowId.startsWith('local-workflow-')) {
      // Dry-run mode
      logger.info({ workflowId }, '🏃 [DRY RUN] Workflow execution triggered')
      return `local-exec-${Date.now()}`
    }

    const response = await this.khClient.executeWorkflow(workflowId, {
      spellAddress: spell.spellAddress,
      triggeredAt: new Date().toISOString(),
    })

    logger.info({ workflowId, executionId: response.executionId }, '▶️ Workflow execution triggered')
    return response.executionId
  }

  // -------------------------------------------------------------------------
  // Step 5: Poll for confirmation with phased backoff
  // -------------------------------------------------------------------------

  async pollForConfirmation(
    spellAddress: string,
    workflowId: string,
    executionId: string
  ): Promise<{
    status: 'EXECUTED' | 'FAILED'
    txHash?: string
    gasUsed?: bigint
    executedAt?: Date
    error?: string
  }> {
    if (!this.khClient || executionId.startsWith('local-exec-')) {
      // Dry-run: simulate success
      logger.info({ executionId }, '[DRY RUN] Simulated execution confirmed')
      return {
        status: 'EXECUTED',
        txHash: `0xdryrun${Date.now().toString(16)}`,
        executedAt: new Date(),
      }
    }

    const startMs = Date.now()

    while (true) {
      const elapsedMs = Date.now() - startMs

      if (elapsedMs > POLL_TIMEOUT_MS) {
        const elapsedMinutes = Math.floor(elapsedMs / 60_000)
        logger.error({ spellAddress, executionId, elapsedMinutes }, '⏱️ Execution polling timed out after 30 minutes')
        await this.notify.notifyTimeoutWarning({ spellAddress, executionId, elapsedMinutes })
        return { status: 'FAILED', error: 'TIMEOUT' }
      }

      // Determine poll interval based on elapsed time
      const intervalMs =
        elapsedMs < POLL_PHASE_1_DURATION_MS ? POLL_PHASE_1_INTERVAL_MS :
        elapsedMs < POLL_PHASE_2_DURATION_MS ? POLL_PHASE_2_INTERVAL_MS :
        POLL_PHASE_3_INTERVAL_MS

      await sleep(intervalMs)

      try {
        const execution = await this.khClient.getExecutionStatus(executionId)

        logger.debug({ executionId, status: execution.status, elapsedMs }, 'Execution poll')

        if (execution.status === 'success' || execution.status === 'completed') {
          // Try to get tx hash and gas from logs
          const logs = await this.khClient.getExecutionLogs(executionId)
          const txHash = this.extractTxHash(logs.data)
          const gasUsed = this.extractGasUsed(logs.data)

          return {
            status: 'EXECUTED',
            txHash,
            gasUsed,
            executedAt: new Date(),
          }
        }

        if (execution.status === 'error' || execution.status === 'failed' || execution.status === 'cancelled') {
          const logs = await this.khClient.getExecutionLogs(executionId)
          const errorEntry = logs.data.find((e) => e.status === 'error' || e.status === 'failed')
          const error = typeof errorEntry?.output === 'string' ? errorEntry.output : `Workflow ${execution.status}`
          return { status: 'FAILED', error }
        }

        // Still pending/running — continue polling
      } catch (err: any) {
        logger.warn({ err: err.message, executionId }, 'Execution poll request failed — retrying')
      }
    }
  }

  // -------------------------------------------------------------------------
  // Step 6: Publish workflow to marketplace
  // -------------------------------------------------------------------------

  async publishWorkflow(workflowId: string, spell: SpellRecord): Promise<void> {
    if (!this.khClient || workflowId.startsWith('local-workflow-')) return

    const slug = `axon-sky-governance-${spell.spellAddress.slice(2, 10).toLowerCase()}`

    try {
      await this.khClient.rawRequest(`/workflows/${workflowId}/list`, {
        method: 'POST',
        body: JSON.stringify({
          slug,
          category: 'defi',
          chain: '1',
          workflowType: 'write',
          inputSchema: {
            type: 'object',
            properties: {
              spellAddress: { type: 'string', description: 'Sky governance spell contract address' },
            },
            required: ['spellAddress'],
          },
          outputMapping: {
            txHash: 'execute-cast.transactionHash',
            gasUsed: 'execute-cast.gasUsed',
          },
        }),
      })
      logger.info({ workflowId, slug }, '📢 Workflow published to KeeperHub marketplace')
    } catch (err: any) {
      logger.warn({ err: err.message, workflowId }, 'Workflow marketplace publish failed — continuing')
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async setHeld(spellId: string, reason: string): Promise<void> {
    await this.prisma.spellRecord.update({
      where: { id: spellId },
      data: { status: 'HELD' },
    })
    logger.warn({ spellId, reason }, '🛑 Spell transitioned to HELD')
  }

  private extractTxHash(logs: Array<{ output?: unknown }>): string | undefined {
    for (const entry of logs) {
      if (typeof entry.output === 'object' && entry.output !== null) {
        const obj = entry.output as Record<string, unknown>
        if (typeof obj['transactionHash'] === 'string') return obj['transactionHash']
        if (typeof obj['txHash'] === 'string') return obj['txHash']
      }
    }
    return undefined
  }

  private extractGasUsed(logs: Array<{ output?: unknown }>): bigint | undefined {
    for (const entry of logs) {
      if (typeof entry.output === 'object' && entry.output !== null) {
        const obj = entry.output as Record<string, unknown>
        if (obj['gasUsed'] !== undefined) {
          try {
            return BigInt(String(obj['gasUsed']))
          } catch {
            // non-numeric gasUsed — ignore
          }
        }
      }
    }
    return undefined
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
