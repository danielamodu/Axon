import { formatUnits, type Address, type PublicClient } from 'viem'
import { PrismaClient, type SimulationScore, type SpellRecord } from '@prisma/client'
import { SPELL_ABI, USDS_ABI, VAT_ABI, CHAINLINK_AGGREGATOR_ABI } from './abi'
import {
  USDS_TOKEN_ADDRESS,
  SKY_VAT_ADDRESS,
  CHAINLINK_ETH_USD_ADDRESS,
  PROJECTOR_POLL_INTERVAL_MS,
} from './constants'
import { logger } from './logger'

export interface GasPriceTrend {
  averageGwei: number
  stddevGwei: number
  recentBlocks: number[]
}

export interface ProjectedChainState {
  projectedAt: Date
  gasTrend: GasPriceTrend
  usdsTotalSupply: number
  vatHeadroomUsds: number
  ethPriceUsd: number
  oracleAgeSeconds: number
}

export interface SimulationResult {
  success: boolean
  error?: string
  simulatedVia: 'keeperhub' | 'viem'
  details?: unknown
}

export interface ScoreAssessment {
  score: SimulationScore
  reasons: string[]
  state: ProjectedChainState
  simulation: SimulationResult
}

export class StateProjector {
  private client: PublicClient
  private prisma: PrismaClient
  private keeperHubApiKey?: string
  private running = false

  constructor(
    client: PublicClient,
    prisma: PrismaClient,
    keeperHubApiKey?: string
  ) {
    this.client = client
    this.prisma = prisma
    this.keeperHubApiKey = keeperHubApiKey ?? process.env.KEEPERHUB_API_KEY
  }

  async start(): Promise<void> {
    this.running = true
    logger.info('State Projector service started')

    while (this.running) {
      try {
        await this.poll()
      } catch (err) {
        logger.error({ err }, 'Projector poll error — continuing')
      }
      await sleep(PROJECTOR_POLL_INTERVAL_MS)
    }
  }

  stop(): void {
    this.running = false
    logger.info('State Projector service stopped')
  }

  /**
   * Check for QUEUED spells and process one spell at a time
   */
  async poll(): Promise<SpellRecord | null> {
    const spell = await this.prisma.spellRecord.findFirst({
      where: { status: 'QUEUED' },
      orderBy: { calledAt: 'asc' },
    })

    if (!spell) {
      logger.debug('No QUEUED spells found to project')
      return null
    }

    logger.info(
      { spellAddress: spell.spellAddress, nextExecutionWindow: spell.nextExecutionWindow.toISOString() },
      '🔮 Projecting state and simulating QUEUED spell'
    )

    await this.processSpell(spell)
    return spell
  }

  /**
   * Process and score a queued spell
   */
  async processSpell(spell: SpellRecord): Promise<ScoreAssessment> {
    // 1. Transition to SIMULATING
    await this.prisma.spellRecord.update({
      where: { id: spell.id },
      data: { status: 'SIMULATING' },
    })

    // 2. Project chain state at execution window
    const state = await this.projectChainState(spell.nextExecutionWindow)

    // 3. Simulate execution against projected state
    const simulation = await this.simulateContractCall(spell.spellAddress as Address)

    // 4. Score spell
    const assessment = this.scoreSpell(state, simulation)

    // 5. Update SpellRecord status and score
    let nextStatus: 'READY' | 'HELD' = assessment.score === 'RED' ? 'HELD' : 'READY'
    let conflictStatus: 'CLEAR' | 'CONFLICT' | null = null

    await this.prisma.spellRecord.update({
      where: { id: spell.id },
      data: {
        status: nextStatus,
        simulationScore: assessment.score,
        conflictStatus,
        conflictDetail: JSON.stringify({
          score: assessment.score,
          reasons: assessment.reasons,
          projectedAt: state.projectedAt.toISOString(),
          gasTrend: state.gasTrend,
          usdsTotalSupply: state.usdsTotalSupply,
          vatHeadroomUsds: state.vatHeadroomUsds,
          ethPriceUsd: state.ethPriceUsd,
          simulation,
        }),
      },
    })

    if (assessment.score === 'RED') {
      logger.warn(
        {
          spellAddress: spell.spellAddress,
          score: assessment.score,
          reasons: assessment.reasons,
        },
        '🚨 Spell simulation scored RED — status updated to HELD'
      )
    } else {
      logger.info(
        {
          spellAddress: spell.spellAddress,
          score: assessment.score,
          reasons: assessment.reasons,
          status: nextStatus,
        },
        `✅ Spell projection scored ${assessment.score} — status updated to READY`
      )
    }

    return assessment
  }

  /**
   * Project state inputs: Gas trend, USDS supply, Vat headroom, Chainlink price
   */
  async projectChainState(targetTime: Date): Promise<ProjectedChainState> {
    const [gasTrend, usdsTotalSupply, vatHeadroomUsds, ethOracle] = await Promise.all([
      this.getGasPriceTrend(),
      this.getUsdsTotalSupply(),
      this.getVatDebtHeadroom(),
      this.getChainlinkEthPrice(),
    ])

    return {
      projectedAt: targetTime,
      gasTrend,
      usdsTotalSupply,
      vatHeadroomUsds,
      ethPriceUsd: ethOracle.price,
      oracleAgeSeconds: ethOracle.ageSeconds,
    }
  }

  /**
   * Calculate ETH gas price average and standard deviation over last 10 blocks
   */
  async getGasPriceTrend(): Promise<GasPriceTrend> {
    const latestBlockNumber = await this.client.getBlockNumber()
    const blockPromises = []
    for (let i = 0n; i < 10n; i++) {
      blockPromises.push(this.client.getBlock({ blockNumber: latestBlockNumber - i }))
    }

    const blocks = await Promise.all(blockPromises)
    const baseFeesGwei = blocks.map((b) => Number(formatUnits(b.baseFeePerGas ?? 0n, 9)))

    const sum = baseFeesGwei.reduce((acc, v) => acc + v, 0)
    const averageGwei = sum / baseFeesGwei.length

    const variance =
      baseFeesGwei.reduce((acc, v) => acc + Math.pow(v - averageGwei, 2), 0) / baseFeesGwei.length
    const stddevGwei = Math.sqrt(variance)

    return {
      averageGwei,
      stddevGwei,
      recentBlocks: baseFeesGwei,
    }
  }

  /**
   * Read USDS total supply from ERC-20 contract
   */
  async getUsdsTotalSupply(): Promise<number> {
    try {
      const supply = await this.client.readContract({
        address: USDS_TOKEN_ADDRESS,
        abi: USDS_ABI,
        functionName: 'totalSupply',
      })
      return Number(formatUnits(supply, 18))
    } catch (err) {
      logger.error({ err }, 'Failed to read USDS totalSupply')
      return 0
    }
  }

  /**
   * Read Sky Vat Line (debt ceiling) and total debt, return headroom in USDS
   */
  async getVatDebtHeadroom(): Promise<number> {
    try {
      const [line, debt] = await Promise.all([
        this.client.readContract({
          address: SKY_VAT_ADDRESS,
          abi: VAT_ABI,
          functionName: 'Line',
        }),
        this.client.readContract({
          address: SKY_VAT_ADDRESS,
          abi: VAT_ABI,
          functionName: 'debt',
        }),
      ])

      // Vat Line and debt are formatted in RAD (10^45)
      const headroomRad = line - debt
      return Number(formatUnits(headroomRad, 45))
    } catch (err) {
      logger.error({ err }, 'Failed to read Sky Vat debt ceiling')
      return 0
    }
  }

  /**
   * Read Chainlink ETH/USD oracle price and age
   */
  async getChainlinkEthPrice(): Promise<{ price: number; ageSeconds: number }> {
    try {
      const roundData = await this.client.readContract({
        address: CHAINLINK_ETH_USD_ADDRESS,
        abi: CHAINLINK_AGGREGATOR_ABI,
        functionName: 'latestRoundData',
      })

      const price = Number(roundData[1]) / 1e8
      const updatedAt = new Date(Number(roundData[3]) * 1000)
      const ageSeconds = Math.max(0, Math.floor((Date.now() - updatedAt.getTime()) / 1000))

      return { price, ageSeconds }
    } catch (err) {
      logger.error({ err }, 'Failed to read Chainlink ETH/USD feed')
      return { price: 0, ageSeconds: Infinity }
    }
  }

  /**
   * Simulate contract call via KeeperHub (with fallback to Viem simulation)
   */
  async simulateContractCall(spellAddress: Address): Promise<SimulationResult> {
    // 1. Try KeeperHub execute_contract_call with simulate: true if API key is configured
    if (this.keeperHubApiKey) {
      try {
        const res = await fetch('https://api.keeperhub.com/direct/call', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.keeperHubApiKey}`,
          },
          body: JSON.stringify({
            contractAddress: spellAddress,
            network: 'ethereum',
            functionName: 'cast',
            functionArgs: '[]',
            abi: JSON.stringify(SPELL_ABI),
            simulate: true,
          }),
        })

        if (res.ok) {
          const body = await res.json()
          return {
            success: true,
            simulatedVia: 'keeperhub',
            details: body,
          }
        } else {
          const errorText = await res.text()
          // If server error or revert reported by KeeperHub simulation
          return {
            success: false,
            error: errorText,
            simulatedVia: 'keeperhub',
          }
        }
      } catch (err: any) {
        logger.warn({ err: err.message }, 'KeeperHub API simulation request failed, trying viem fallback')
      }
    }

    // 2. Viem simulateContract fallback
    try {
      const sim = await this.client.simulateContract({
        address: spellAddress,
        abi: SPELL_ABI,
        functionName: 'cast',
      })
      return {
        success: true,
        simulatedVia: 'viem',
        details: sim,
      }
    } catch (err: any) {
      return {
        success: false,
        error: err?.shortMessage ?? err?.message ?? 'Simulation reverted',
        simulatedVia: 'viem',
      }
    }
  }

  /**
   * Score spell based on simulation and projected state
   */
  scoreSpell(state: ProjectedChainState, simulation: SimulationResult): ScoreAssessment {
    const reasons: string[] = []
    let score: SimulationScore = 'GREEN'

    // Critical Red Criteria
    if (!simulation.success) {
      score = 'RED'
      reasons.push(`Simulation reverted or failed: ${simulation.error ?? 'unknown error'}`)
    }

    if (state.vatHeadroomUsds <= 0) {
      score = 'RED'
      reasons.push('Vat debt ceiling is completely exhausted (headroom <= 0)')
    }

    if (state.ethPriceUsd <= 0 || state.oracleAgeSeconds > 24 * 3600) {
      score = 'RED'
      reasons.push('Chainlink ETH/USD oracle offline or returned invalid price')
    }

    // Yellow Criteria (only if not already RED)
    if (score !== 'RED') {
      if (state.gasTrend.averageGwei > 100) {
        score = 'YELLOW'
        reasons.push(`High average gas price: ${state.gasTrend.averageGwei.toFixed(2)} gwei`)
      }

      if (state.gasTrend.stddevGwei > 30) {
        score = 'YELLOW'
        reasons.push(`High gas price volatility: stddev ${state.gasTrend.stddevGwei.toFixed(2)} gwei`)
      }

      if (state.vatHeadroomUsds < 100_000_000) {
        score = 'YELLOW'
        reasons.push(`Low Vat debt ceiling headroom: ${(state.vatHeadroomUsds / 1e6).toFixed(2)}M USDS`)
      }

      if (state.oracleAgeSeconds > 3 * 3600) {
        score = 'YELLOW'
        reasons.push(`Chainlink price feed stale: ${Math.floor(state.oracleAgeSeconds / 60)} minutes old`)
      }
    }

    if (reasons.length === 0) {
      reasons.push('Clean simulation, normal gas conditions, ample debt headroom, fresh oracle feed')
    }

    return {
      score,
      reasons,
      state,
      simulation,
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
