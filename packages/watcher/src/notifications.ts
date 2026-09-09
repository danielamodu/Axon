import { logger } from './logger'

export interface NotificationPayload {
  title: string
  description: string
  color: 'green' | 'yellow' | 'red' | 'blue'
  fields?: Array<{ name: string; value: string; inline?: boolean }>
  footer?: string
}

// Discord embed colors
const DISCORD_COLORS = {
  green: 0x2ecc71,
  yellow: 0xf1c40f,
  red: 0xe74c3c,
  blue: 0x3498db,
} as const

export class NotificationDispatcher {
  private discordWebhookUrl: string | undefined

  constructor(discordWebhookUrl?: string) {
    this.discordWebhookUrl = discordWebhookUrl ?? process.env.DISCORD_WEBHOOK_URL
  }

  async send(payload: NotificationPayload, skipDiscord = false): Promise<void> {
    const formatted = this.formatForLog(payload)
    logger.info(formatted, `[Notification] ${payload.title}`)

    if (this.discordWebhookUrl && !skipDiscord) {
      await this.sendDiscord(payload)
    }
  }

  async notifyExecutionStarted(opts: {
    spellAddress: string
    description: string
    executionWindow: Date
    workflowId: string
  }): Promise<void> {
    await this.send({
      title: '🚀 Execution Started',
      description: `Sky governance spell queued for on-chain execution.`,
      color: 'blue',
      fields: [
        { name: 'Spell', value: opts.spellAddress, inline: false },
        { name: 'Description', value: opts.description.slice(0, 200) || 'N/A', inline: false },
        { name: 'Execution Window', value: opts.executionWindow.toISOString(), inline: true },
        { name: 'Workflow ID', value: opts.workflowId, inline: true },
      ],
    })
  }

  async notifyExecutionSucceeded(opts: {
    spellAddress: string
    txHash: string
    gasUsed: string
    executedAt: Date
    keeperHubExecutionId?: string
  }): Promise<void> {
    const etherscanLink = `https://etherscan.io/tx/${opts.txHash}`
    const fields: Array<{ name: string; value: string; inline?: boolean }> = [
      { name: 'Spell', value: opts.spellAddress, inline: false },
      { name: 'Tx Hash', value: opts.txHash, inline: false },
      { name: 'Etherscan', value: etherscanLink, inline: false },
      { name: 'Gas Used', value: opts.gasUsed, inline: true },
      { name: 'Executed At', value: opts.executedAt.toISOString(), inline: true },
    ]

    if (opts.keeperHubExecutionId) {
      fields.push(
        { name: 'KeeperHub Execution ID', value: opts.keeperHubExecutionId, inline: true },
        {
          name: 'KeeperHub Audit Trail',
          value: `https://app.keeperhub.com/executions/${opts.keeperHubExecutionId}\nView audit trail on KeeperHub →`,
          inline: false,
        }
      )
    }

    // Direct Discord call removed as it is now handled by KeeperHub workflow node 8
    await this.send(
      {
        title: '✅ Execution Successful',
        description: `Spell cast() confirmed on Ethereum mainnet.`,
        color: 'green',
        fields,
      },
      true // skip direct Discord webhook
    )
  }

  async notifyExecutionFailed(opts: {
    spellAddress: string
    error: string
    retryCount: number
    workflowId?: string
  }): Promise<void> {
    await this.send({
      title: '❌ Execution Failed',
      description: `Spell execution failed after ${opts.retryCount} attempt(s). Manual review required.`,
      color: 'red',
      fields: [
        { name: 'Spell', value: opts.spellAddress, inline: false },
        { name: 'Error', value: opts.error.slice(0, 500), inline: false },
        { name: 'Retry Count', value: String(opts.retryCount), inline: true },
        ...(opts.workflowId
          ? [{ name: 'Workflow ID', value: opts.workflowId, inline: true }]
          : []),
      ],
      footer: 'Axon Execution Engine — Phase 4',
    })
  }

  async notifySimulationFailed(opts: {
    spellAddress: string
    error: string
    phase: 'pre-execution'
  }): Promise<void> {
    // Direct Discord call removed as it is now handled by KeeperHub workflow node 4a
    await this.send(
      {
        title: '⚠️ Simulation Failed at Execution Time',
        description: `Pre-execution simulation of cast() reverted. Spell held.`,
        color: 'yellow',
        fields: [
          { name: 'Spell', value: opts.spellAddress, inline: false },
          { name: 'Phase', value: opts.phase, inline: true },
          { name: 'Error', value: opts.error.slice(0, 500), inline: false },
        ],
      },
      true // skip direct Discord webhook
    )
  }

  async notifyPaymentSettled(opts: {
    spellAddress: string
    feeUsdc: number
    txHash?: string
    settledAt: Date
  }): Promise<void> {
    await this.send({
      title: '💳 x402 Execution Payment Settled',
      description: `Execution payment of ${opts.feeUsdc.toFixed(2)} USDC settled on Base.`,
      color: 'blue',
      fields: [
        { name: 'Spell', value: opts.spellAddress, inline: false },
        { name: 'Amount', value: `${opts.feeUsdc.toFixed(2)} USDC`, inline: true },
        ...(opts.txHash
          ? [{ name: 'Base Tx', value: `https://basescan.org/tx/${opts.txHash}`, inline: false }]
          : []),
        { name: 'Settled At', value: opts.settledAt.toISOString(), inline: true },
      ],
    })
  }

  async notifyLowBalance(opts: {
    orgName: string
    balanceUsdc: number
  }): Promise<void> {
    await this.send({
      title: '⚠️ Low USDC Balance',
      description: `Axon workspace balance is running low. Please deposit USDC to continue executions.`,
      color: 'yellow',
      fields: [
        { name: 'Organisation', value: opts.orgName, inline: true },
        { name: 'Current Balance', value: `${opts.balanceUsdc.toFixed(2)} USDC`, inline: true },
      ],
      footer: 'Run: axon deposit --amount 10 to top up',
    })
  }

  async notifyConflictDetected(opts: {
    spellAddress: string
    conflictType: string
    conflictingAddress: string
    detail: string
  }): Promise<void> {
    await this.send({
      title: '🚨 Spell Conflict Detected',
      description: `Conflict detected during conflict-check phase. Spell set to CONFLICT.`,
      color: 'red',
      fields: [
        { name: 'Spell', value: opts.spellAddress, inline: false },
        { name: 'Conflict Type', value: opts.conflictType, inline: true },
        { name: 'Conflicting Spell', value: opts.conflictingAddress, inline: true },
        { name: 'Detail', value: opts.detail.slice(0, 400), inline: false },
      ],
    })
  }

  async notifyTimeoutWarning(opts: {
    spellAddress: string
    executionId: string
    elapsedMinutes: number
  }): Promise<void> {
    await this.send({
      title: '⏱️ Execution Timeout',
      description: `No confirmation after ${opts.elapsedMinutes} minutes. Spell marked FAILED.`,
      color: 'red',
      fields: [
        { name: 'Spell', value: opts.spellAddress, inline: false },
        { name: 'Execution ID', value: opts.executionId, inline: true },
        { name: 'Elapsed', value: `${opts.elapsedMinutes} minutes`, inline: true },
      ],
    })
  }

  private formatForLog(payload: NotificationPayload): Record<string, unknown> {
    const obj: Record<string, unknown> = { title: payload.title }
    if (payload.fields) {
      for (const f of payload.fields) {
        obj[f.name.toLowerCase().replace(/\s+/g, '_')] = f.value
      }
    }
    return obj
  }

  private async sendDiscord(payload: NotificationPayload): Promise<void> {
    if (!this.discordWebhookUrl) return

    const embed = {
      title: payload.title,
      description: payload.description,
      color: DISCORD_COLORS[payload.color],
      fields: payload.fields?.map((f) => ({
        name: f.name,
        value: f.value,
        inline: f.inline ?? false,
      })) ?? [],
      footer: payload.footer ? { text: payload.footer } : { text: 'Axon — Autonomous Protocol Operations' },
      timestamp: new Date().toISOString(),
    }

    try {
      const res = await fetch(this.discordWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embeds: [embed] }),
      })

      if (!res.ok) {
        const text = await res.text()
        logger.warn({ status: res.status, body: text }, 'Discord webhook delivery failed')
      }
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Discord webhook request threw — continuing')
    }
  }
}
