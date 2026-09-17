import { formatUnits, type Address, type PublicClient } from 'viem'
import { PrismaClient, type SimulationScore, type SpellRecord } from '@prisma/client'
import { SPELL_ABI, USDS_ABI, VAT_ABI, CHAINLINK_AGGREGATOR_ABI } from './abi'
import { KeeperHubOracle } from './oracle'
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
  /** Linear slope (gwei per block, oldest → newest). Positive = rising. */
  slopeGweiPerBlock: number
}

/** Per-protocol risk thresholds. Defaults preserve legacy Sky behavior. */export interface ProjectorThresholds {
  maxAvgGasGwei: number
  maxGasStddevGwei: number
  /** Slope above which a rising gas market forces YELLOW (when avg is also elevated). */
  maxGasSlopeGweiPerBlock: number
  /** Avg gas above which slope matters. */
  slopeGateAvgGwei: number
  minVatHeadroomUsds: number
  maxOracleAgeSecondsRed: number
  staleOracleAgeSecondsYellow: number
}

export const DEFAULT_PROJECTOR_THRESHOLDS: ProjectorThresholds = {
  maxAvgGasGwei: 100,
  maxGasStddevGwei: 30,
  maxGasSlopeGweiPerBlock: 5,
  slopeGateAvgGwei: 50,
  minVatHeadroomUsds: 100_000_000,
  maxOracleAgeSecondsRed: 24 * 3600,
  staleOracleAgeSecondsYellow: 3 * 3600,
}

/** Non-Sky protocols get tighter/looser bands without touching code. */
export const PROTOCOL_PROJECTOR_THRESHOLDS: Record<string, Partial<ProjectorThresholds>> = {
  sky: {},
  aave: { minVatHeadroomUsds: 50_000_000 },
  compound: { minVatHeadroomUsds: 50_000_000 },
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

/** Snapshot history config: 7-day lookback, 1-hour minimum span for a trend. */
export const SNAPSHOT_LOOKBACK_MS = 7 * 24 * 3600_000
export const SNAPSHOT_MIN_SPAN_MS = 1 * 3600_000
export const SNAPSHOT_PRUNE_AFTER_MS = 7 * 24 * 3600_000
export const SNAPSHOT_MAX_ROWS = 500

export interface TrendPoint {
  tMs: number
  v: number
}

export interface Extrapolation {
  value: number
  slopePerHour: number
  samples: number
  spanHours: number
}

export interface WindowProjection {
  usdsTotalSupply: number | null
  vatHeadroomUsds: number | null
  usdsSlopePerHour: number | null
  vatSlopePerHour: number | null
  samples: number
  spanHours: number
  trendAvailable: boolean
}

/**
 * Least-squares linear fit over (time, value) points, evaluated at targetMs.
 * Returns null when fewer than 2 points span less than SNAPSHOT_MIN_SPAN_MS —
 * a line through noise is worse than current state.
 */
export function extrapolateTrend(points: TrendPoint[], targetMs: number): Extrapolation | null {
  if (points.length < 2) return null
  const t0 = points[0].tMs
  const spanMs = points[points.length - 1].tMs - t0
  if (spanMs < SNAPSHOT_MIN_SPAN_MS) return null

  // x in hours from first sample for numerical stability
  const n = points.length
  let sumX = 0
  let sumY = 0
  let sumXY = 0
  let sumXX = 0
  for (const p of points) {
    const x = (p.tMs - t0) / 3600_000
    sumX += x
    sumY += p.v
    sumXY += x * p.v
    sumXX += x * x
  }
  const denom = n * sumXX - sumX * sumX
  if (denom === 0) return null
  const slope = (n * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / n
  const xTarget = (targetMs - t0) / 3600_000
  return {
    value: intercept + slope * xTarget,
    slopePerHour: slope,
    samples: n,
    spanHours: spanMs / 3600_000,
  }
}

export class StateProjector {
  private client: PublicClient
  private prisma: PrismaClient
  private keeperHubApiKey?: string
  private oracle: KeeperHubOracle
  private running = false

  constructor(
    client: PublicClient,
    prisma: PrismaClient,
    keeperHubApiKey?: string
  ) {
    this.client = client
    this.prisma = prisma
    this.keeperHubApiKey = keeperHubApiKey ?? process.env.KEEPERHUB_API_KEY
    this.oracle = new KeeperHubOracle(this.keeperHubApiKey)
  }

  /** 'keeperhub' when the last projection batch read fully via KH, else 'viem-fallback'. */
  get oracleMode(): 'keeperhub' | 'viem-fallback' {
    return this.oracle.keeperHubOracleMode ? 'keeperhub' : 'viem-fallback'
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

    // 2b. Persist this reading for trend history (best-effort, never blocks).
    await this.recordSnapshot(state).catch((err) =>
      logger.warn({ err: (err as Error)?.message }, 'Snapshot write failed — continuing')
    )

    // 3. Simulate execution against projected state
    const simulation = await this.simulateContractCall(spell.spellAddress as Address)

    // 4. Score spell with per-protocol thresholds when available.
    // Slow-moving variables are linearly extrapolated to the window when
    // enough history exists; otherwise current values stand (trendAvailable).
    const thresholds = resolveThresholds((spell as { protocolId?: string }).protocolId)
    const projection = await this.projectToWindow(spell.nextExecutionWindow).catch((err) => {
      logger.warn({ err: (err as Error)?.message }, 'Window projection failed — scoring current state')
      return null as WindowProjection | null
    })
    const scoredState: ProjectedChainState = {
      ...state,
      usdsTotalSupply: projection?.usdsTotalSupply ?? state.usdsTotalSupply,
      vatHeadroomUsds: projection?.vatHeadroomUsds ?? state.vatHeadroomUsds,
    }
    const assessment = this.scoreSpell(scoredState, simulation, thresholds)
    if (projection?.trendAvailable) {
      assessment.reasons.push(
        `Trend-projected to window (${projection.samples} samples over ${projection.spanHours.toFixed(1)}h)`
      )
    }

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
          oracleMode: this.oracleMode,
          gasTrend: state.gasTrend,
          usdsTotalSupply: scoredState.usdsTotalSupply,
          vatHeadroomUsds: scoredState.vatHeadroomUsds,
          currentUsdsTotalSupply: state.usdsTotalSupply,
          currentVatHeadroomUsds: state.vatHeadroomUsds,
          windowProjection: projection,
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
   * Project state inputs: Gas trend, USDS supply, Vat headroom, Chainlink price.
   * Contract reads go through the KeeperHub oracle first; gas-trend block
   * data stays on viem (no KeeperHub block-data surface exists).
   * NOTE: reads are current-state, not time-travel to targetTime. `projectedAt`
   * records the window being assessed; the gas slope flags deterioration
   * toward that window instead of pretending to forecast exactly.
   */
  async projectChainState(targetTime: Date): Promise<ProjectedChainState> {
    const [gasTrend, usds, vat, ethOracle] = await Promise.all([
      this.getGasPriceTrend(),
      this.getUsdsTotalSupplyWithSource(),
      this.getVatDebtHeadroomWithSource(),
      this.getChainlinkEthPriceWithSource(),
    ])

    // Oracle mode is true only when every contract read came via KeeperHub.
    this.oracle.setBatchMode(usds.viaKeeperHub && vat.viaKeeperHub && ethOracle.viaKeeperHub)

    return {
      projectedAt: targetTime,
      gasTrend,
      usdsTotalSupply: usds.value,
      vatHeadroomUsds: vat.value,
      ethPriceUsd: ethOracle.value.price,
      oracleAgeSeconds: ethOracle.value.ageSeconds,
    }
  }

  /**
   * Calculate ETH gas price average, stddev, and linear trend slope over last 10 blocks
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
      slopeGweiPerBlock: computeSlope(baseFeesGwei.slice().reverse()),
    }
  }

  /**
   * Persist the current reading for trend history and prune samples older
   * than SNAPSHOT_PRUNE_AFTER_MS. Metrics must never break the pipeline —
   * callers wrap in catch, and this method throws only on programmer error.
   */
  async recordSnapshot(state: ProjectedChainState): Promise<void> {
    await (this.prisma as any).projectorSnapshot.create({
      data: {
        gasAvgGwei: state.gasTrend.averageGwei,
        gasStddevGwei: state.gasTrend.stddevGwei,
        usdsTotalSupply: state.usdsTotalSupply,
        vatHeadroomUsds: state.vatHeadroomUsds,
        ethPriceUsd: state.ethPriceUsd,
      },
    })
    await (this.prisma as any).projectorSnapshot.deleteMany({
      where: { recordedAt: { lt: new Date(Date.now() - SNAPSHOT_PRUNE_AFTER_MS) } },
    }).catch(() => {})
  }

  /**
   * Linearly extrapolate slow-moving variables (USDS supply, Vat headroom)
   * to the execution window from snapshot history. Gas is deliberately NOT
   * projected — base fee has no memory worth extrapolating; it is scored
   * from current trend + volatility instead.
   */
  async projectToWindow(targetTime: Date): Promise<WindowProjection> {
    const since = new Date(Date.now() - SNAPSHOT_LOOKBACK_MS)
    const rows = await (this.prisma as any).projectorSnapshot.findMany({
      where: { recordedAt: { gte: since } },
      orderBy: { recordedAt: 'asc' },
      take: SNAPSHOT_MAX_ROWS,
    })

    const empty: WindowProjection = {
      usdsTotalSupply: null,
      vatHeadroomUsds: null,
      usdsSlopePerHour: null,
      vatSlopePerHour: null,
      samples: rows.length,
      spanHours: 0,
      trendAvailable: false,
    }
    if (rows.length < 2) return empty

    const targetMs = targetTime.getTime()
    const usds = extrapolateTrend(
      rows.map((r: any) => ({ tMs: new Date(r.recordedAt).getTime(), v: Number(r.usdsTotalSupply) })),
      targetMs
    )
    const vat = extrapolateTrend(
      rows.map((r: any) => ({ tMs: new Date(r.recordedAt).getTime(), v: Number(r.vatHeadroomUsds) })),
      targetMs
    )
    if (!usds || !vat) return { ...empty, spanHours: usds?.spanHours ?? vat?.spanHours ?? 0 }

    return {
      usdsTotalSupply: usds.value,
      vatHeadroomUsds: vat.value,
      usdsSlopePerHour: usds.slopePerHour,
      vatSlopePerHour: vat.slopePerHour,
      samples: usds.samples,
      spanHours: usds.spanHours,
      trendAvailable: true,
    }
  }

  /**
   * Read USDS total supply — KeeperHub oracle first, viem fallback.
   */
  async getUsdsTotalSupply(): Promise<number> {
    return (await this.getUsdsTotalSupplyWithSource()).value
  }

  async getUsdsTotalSupplyWithSource(): Promise<{ value: number; viaKeeperHub: boolean }> {
    try {
      const raw = await this.oracle.readContract({
        address: USDS_TOKEN_ADDRESS,
        network: 'ethereum',
        functionName: 'totalSupply',
        abi: JSON.stringify(USDS_ABI),
      })
      if (raw !== null) {
        return { value: Number(formatUnits(BigInt(raw), 18)), viaKeeperHub: true }
      }
    } catch (err) {
      logger.warn({ err }, 'KeeperHub USDS read threw — viem fallback')
    }
    try {
      const supply = await this.client.readContract({
        address: USDS_TOKEN_ADDRESS,
        abi: USDS_ABI,
        functionName: 'totalSupply',
      })
      return { value: Number(formatUnits(supply, 18)), viaKeeperHub: false }
    } catch (err) {
      logger.error({ err }, 'Failed to read USDS totalSupply')
      return { value: 0, viaKeeperHub: false }
    }
  }

  /**
   * Read Sky Vat Line (debt ceiling) and total debt, return headroom in USDS.
   * KeeperHub oracle first, viem fallback.
   */
  async getVatDebtHeadroom(): Promise<number> {
    return (await this.getVatDebtHeadroomWithSource()).value
  }

  async getVatDebtHeadroomWithSource(): Promise<{ value: number; viaKeeperHub: boolean }> {
    try {
      const [lineRaw, debtRaw] = await Promise.all([
        this.oracle.readContract({
          address: SKY_VAT_ADDRESS,
          network: 'ethereum',
          functionName: 'Line',
          abi: JSON.stringify(VAT_ABI),
        }),
        this.oracle.readContract({
          address: SKY_VAT_ADDRESS,
          network: 'ethereum',
          functionName: 'debt',
          abi: JSON.stringify(VAT_ABI),
        }),
      ])
      if (lineRaw !== null && debtRaw !== null) {
        // Vat Line and debt are formatted in RAD (10^45)
        const headroomRad = BigInt(lineRaw) - BigInt(debtRaw)
        return { value: Number(formatUnits(headroomRad, 45)), viaKeeperHub: true }
      }
    } catch (err) {
      logger.warn({ err }, 'KeeperHub Vat read threw — viem fallback')
    }
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
      return { value: Number(formatUnits(headroomRad, 45)), viaKeeperHub: false }
    } catch (err) {
      logger.error({ err }, 'Failed to read Sky Vat debt ceiling')
      return { value: 0, viaKeeperHub: false }
    }
  }

  /**
   * Read Chainlink ETH/USD oracle price and age.
   * KeeperHub oracle first, viem fallback.
   */
  async getChainlinkEthPrice(): Promise<{ price: number; ageSeconds: number }> {
    return (await this.getChainlinkEthPriceWithSource()).value
  }

  async getChainlinkEthPriceWithSource(): Promise<{
    value: { price: number; ageSeconds: number }
    viaKeeperHub: boolean
  }> {
    try {
      // latestRoundData -> (roundId, answer, startedAt, updatedAt, answeredInRound)
      const tuple = await this.oracle.readContractTuple({
        address: CHAINLINK_ETH_USD_ADDRESS,
        network: 'ethereum',
        functionName: 'latestRoundData',
        abi: JSON.stringify(CHAINLINK_AGGREGATOR_ABI),
      })
      if (tuple && tuple.length >= 4) {
        const price = Number(tuple[1]) / 1e8
        const updatedAt = new Date(Number(tuple[3]) * 1000)
        const ageSeconds = Math.max(0, Math.floor((Date.now() - updatedAt.getTime()) / 1000))
        if (Number.isFinite(price) && price > 0) {
          return { value: { price, ageSeconds }, viaKeeperHub: true }
        }
      }
    } catch (err) {
      logger.warn({ err }, 'KeeperHub Chainlink read threw — viem fallback')
    }
    try {
      const roundData = await this.client.readContract({
        address: CHAINLINK_ETH_USD_ADDRESS,
        abi: CHAINLINK_AGGREGATOR_ABI,
        functionName: 'latestRoundData',
      })

      const price = Number(roundData[1]) / 1e8
      const updatedAt = new Date(Number(roundData[3]) * 1000)
      const ageSeconds = Math.max(0, Math.floor((Date.now() - updatedAt.getTime()) / 1000))

      return { value: { price, ageSeconds }, viaKeeperHub: false }
    } catch (err) {
      logger.error({ err }, 'Failed to read Chainlink ETH/USD feed')
      return { value: { price: 0, ageSeconds: Infinity }, viaKeeperHub: false }
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
   * Score spell based on simulation and projected state.
   * Thresholds are injectable per-protocol; defaults preserve Sky behavior.
   */
  scoreSpell(
    state: ProjectedChainState,
    simulation: SimulationResult,
    thresholds: ProjectorThresholds = DEFAULT_PROJECTOR_THRESHOLDS
  ): ScoreAssessment {
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

    if (state.ethPriceUsd <= 0 || state.oracleAgeSeconds > thresholds.maxOracleAgeSecondsRed) {
      score = 'RED'
      reasons.push('Chainlink ETH/USD oracle offline or returned invalid price')
    }

    // Yellow Criteria (only if not already RED)
    if (score !== 'RED') {
      if (state.gasTrend.averageGwei > thresholds.maxAvgGasGwei) {
        score = 'YELLOW'
        reasons.push(`High average gas price: ${state.gasTrend.averageGwei.toFixed(2)} gwei`)
      }

      if (state.gasTrend.stddevGwei > thresholds.maxGasStddevGwei) {
        score = 'YELLOW'
        reasons.push(`High gas price volatility: stddev ${state.gasTrend.stddevGwei.toFixed(2)} gwei`)
      }

      const slope = state.gasTrend.slopeGweiPerBlock ?? 0
      if (
        slope > thresholds.maxGasSlopeGweiPerBlock &&
        state.gasTrend.averageGwei > thresholds.slopeGateAvgGwei
      ) {
        score = 'YELLOW'
        reasons.push(`Rising gas trend: +${slope.toFixed(2)} gwei/block toward execution window`)
      }

      if (state.vatHeadroomUsds < thresholds.minVatHeadroomUsds) {
        score = 'YELLOW'
        reasons.push(`Low Vat debt ceiling headroom: ${(state.vatHeadroomUsds / 1e6).toFixed(2)}M USDS`)
      }

      if (state.oracleAgeSeconds > thresholds.staleOracleAgeSecondsYellow) {
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

/** Least-squares slope over oldest→newest samples. Returns 0 for <2 points. */
export function computeSlope(samples: number[]): number {
  const n = samples.length
  if (n < 2) return 0
  let sumX = 0
  let sumY = 0
  let sumXY = 0
  let sumXX = 0
  for (let i = 0; i < n; i++) {
    sumX += i
    sumY += samples[i]
    sumXY += i * samples[i]
    sumXX += i * i
  }
  const denom = n * sumXX - sumX * sumX
  if (denom === 0) return 0
  return (n * sumXY - sumX * sumY) / denom
}

/** Merge protocol-specific overrides (e.g. from Protocol.config.thresholds). */
export function resolveThresholds(protocolId?: string, overrides?: Partial<ProjectorThresholds>): ProjectorThresholds {
  return {
    ...DEFAULT_PROJECTOR_THRESHOLDS,
    ...(protocolId ? PROTOCOL_PROJECTOR_THRESHOLDS[protocolId.toLowerCase()] ?? {} : {}),
    ...(overrides ?? {}),
  }
}
