import { PrismaClient, type SpellRecord } from '@prisma/client'
import { logger } from './logger'

export type ConflictType = 'PARAMETER_OVERLAP' | 'ORDERING_DEPENDENCY' | 'RACE_CONDITION'

export interface ConflictRecord {
  conflictType: ConflictType
  conflictingSpellAddress: string
  reason: string
  details?: Record<string, unknown>
}

export interface ConflictCheckResult {
  hasConflict: boolean
  conflicts: ConflictRecord[]
  fingerprint: string[]
}

const TWO_HOURS_MS = 2 * 60 * 60 * 1000
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
const CONFLICT_POLL_INTERVAL_MS = 30_000

/**
 * Extracts normalized parameter fingerprints from a spell's description and actions
 */
export function extractParameterFingerprint(description: string, actions?: unknown): Set<string> {
  const fingerprint = new Set<string>()
  const text = (description || '').toLowerCase()

  // 1. Stability fee / duty
  if (text.includes('stability fee') || /\bduty\b/.test(text)) {
    fingerprint.add('stability_fee')
  }

  // 2. Debt ceiling / line
  if (text.includes('debt ceiling') || /\bline\b/.test(text)) {
    fingerprint.add('debt_ceiling')
  }

  // 3. Savings rate / DSR / SSR
  if (text.includes('savings rate') || /\bdsr\b/.test(text) || /\bssr\b/.test(text)) {
    fingerprint.add('savings_rate')
  }

  // 4. Rewards / incentives
  if (text.includes('reward') || text.includes('incentive')) {
    fingerprint.add('reward_distribution')
  }

  // 5. USDS token
  if (/\busds\b/.test(text)) {
    fingerprint.add('token_usds')
  }

  // 6. DAI token
  if (/\bdai\b/.test(text)) {
    fingerprint.add('token_dai')
  }

  // 7. Collateral ratio / liquidation ratio / mat
  if (/\bmat\b/.test(text) || text.includes('collateral ratio') || text.includes('liquidation ratio')) {
    fingerprint.add('collateral_ratio')
  }

  // 8. Specific ILK tokens (e.g. eth-a, wbtc-a, etc.)
  const ilkMatches = text.match(/\b(eth-[a-z0-9]+|wbtc-[a-z0-9]+|usdc-[a-z0-9]+|wsteth-[a-z0-9]+)\b/g)
  if (ilkMatches) {
    for (const ilk of ilkMatches) {
      fingerprint.add(`ilk:${ilk}`)
    }
  }

  // Also check action targets if available
  if (Array.isArray(actions)) {
    for (const action of actions) {
      if (typeof action?.description === 'string') {
        const subFingerprint = extractParameterFingerprint(action.description)
        subFingerprint.forEach((f) => fingerprint.add(f))
      }
    }
  }

  return fingerprint
}

/**
 * Pure function to detect conflicts for a candidate spell against a set of comparison spells
 */
export function detectConflicts(
  candidate: SpellRecord,
  comparisonSpells: SpellRecord[]
): ConflictCheckResult {
  const candidateFingerprint = extractParameterFingerprint(
    candidate.calldata ? `${candidate.calldata} ${candidate.actions}` : '',
    candidate.actions
  )
  // Merge fingerprint from actions with description if actions JSON holds description
  let candidateDesc = ''
  if (Array.isArray(candidate.actions) && candidate.actions.length > 0) {
    candidateDesc = (candidate.actions as any[])
      .map((a) => a?.description || '')
      .join(' ')
  }
  const combinedCandidateFingerprint = extractParameterFingerprint(candidateDesc, candidate.actions)
  candidateFingerprint.forEach((f) => combinedCandidateFingerprint.add(f))

  const conflicts: ConflictRecord[] = []

  for (const other of comparisonSpells) {
    if (other.id === candidate.id || other.spellAddress.toLowerCase() === candidate.spellAddress.toLowerCase()) {
      continue
    }

    let otherDesc = ''
    if (Array.isArray(other.actions) && other.actions.length > 0) {
      otherDesc = (other.actions as any[]).map((a) => a?.description || '').join(' ')
    }
    const otherFingerprint = extractParameterFingerprint(otherDesc, other.actions)

    // Conflict Type 1: PARAMETER_OVERLAP
    const overlappingParams = [...combinedCandidateFingerprint].filter((p) => otherFingerprint.has(p))
    if (overlappingParams.length > 0) {
      conflicts.push({
        conflictType: 'PARAMETER_OVERLAP',
        conflictingSpellAddress: other.spellAddress,
        reason: `Parameter overlap detected: both spells modify [${overlappingParams.join(', ')}]`,
        details: { overlappingParams, otherStatus: other.status },
      })
    }

    // Conflict Type 2: ORDERING_DEPENDENCY
    // If candidate references other's spellAddress, or other references candidate
    const candidateMentionsOther = candidateDesc.toLowerCase().includes(other.spellAddress.toLowerCase())
    const otherMentionsCandidate = otherDesc.toLowerCase().includes(candidate.spellAddress.toLowerCase())

    if (candidateMentionsOther) {
      conflicts.push({
        conflictType: 'ORDERING_DEPENDENCY',
        conflictingSpellAddress: other.spellAddress,
        reason: `Ordering dependency: Candidate spell references address of spell ${other.spellAddress} — must sequence after it`,
        details: { referenceDirection: 'candidate_references_other' },
      })
    } else if (otherMentionsCandidate && other.status !== 'EXECUTED') {
      conflicts.push({
        conflictType: 'ORDERING_DEPENDENCY',
        conflictingSpellAddress: other.spellAddress,
        reason: `Ordering dependency: Active spell ${other.spellAddress} references this candidate spell — must be sequenced`,
        details: { referenceDirection: 'other_references_candidate' },
      })
    }

    // Conflict Type 3: RACE_CONDITION
    // Only applies to active concurrent spells (READY or EXECUTING)
    if (other.status === 'READY' || other.status === 'EXECUTING') {
      const timeDiffMs = Math.abs(
        candidate.nextExecutionWindow.getTime() - other.nextExecutionWindow.getTime()
      )
      if (timeDiffMs <= TWO_HOURS_MS) {
        conflicts.push({
          conflictType: 'RACE_CONDITION',
          conflictingSpellAddress: other.spellAddress,
          reason: `Race condition: Both spells are scheduled to execute within 2 hours of each other (${Math.round(
            timeDiffMs / 60000
          )} minutes apart)`,
          details: {
            timeDiffMinutes: Math.round(timeDiffMs / 60000),
            candidateWindow: candidate.nextExecutionWindow.toISOString(),
            otherWindow: other.nextExecutionWindow.toISOString(),
          },
        })
      }
    }
  }

  return {
    hasConflict: conflicts.length > 0,
    conflicts,
    fingerprint: Array.from(combinedCandidateFingerprint),
  }
}

export class ConflictDetector {
  private prisma: PrismaClient
  private running = false

  constructor(prisma: PrismaClient) {
    this.prisma = prisma
  }

  async start(): Promise<void> {
    this.running = true
    logger.info('Conflict Detector service started')

    while (this.running) {
      try {
        await this.poll()
      } catch (err) {
        logger.error({ err }, 'Conflict Detector poll error — continuing')
      }
      await sleep(CONFLICT_POLL_INTERVAL_MS)
    }
  }

  stop(): void {
    this.running = false
    logger.info('Conflict Detector service stopped')
  }

  /**
   * Poll for READY spells that require conflict evaluation or re-evaluation
   */
  async poll(): Promise<SpellRecord[]> {
    // Find all READY spells where conflictStatus is null or need evaluation
    const candidates = await this.prisma.spellRecord.findMany({
      where: {
        status: 'READY',
        conflictStatus: null,
      },
      orderBy: { calledAt: 'asc' },
    })

    if (candidates.length === 0) {
      logger.debug('No unverified READY spells found for conflict check')
      return []
    }

    const processed: SpellRecord[] = []
    for (const candidate of candidates) {
      const updated = await this.checkSpell(candidate.id)
      if (updated) processed.push(updated)
    }

    return processed
  }

  /**
   * Run conflict detection on a specific spell by ID
   */
  async checkSpell(spellId: string): Promise<SpellRecord | null> {
    const candidate = await this.prisma.spellRecord.findUnique({
      where: { id: spellId },
    })

    if (!candidate) {
      logger.warn({ spellId }, 'Spell not found for conflict check')
      return null
    }

    const now = new Date()
    const sevenDaysAgo = new Date(now.getTime() - SEVEN_DAYS_MS)

    // Compare against:
    // 1. All other READY or EXECUTING spells in active queue
    // 2. All EXECUTED spells from the last 7 days
    const comparisonSpells = await this.prisma.spellRecord.findMany({
      where: {
        id: { not: candidate.id },
        OR: [
          { status: { in: ['READY', 'EXECUTING'] } },
          {
            status: 'EXECUTED',
            OR: [
              { executedAt: { gte: sevenDaysAgo } },
              { createdAt: { gte: sevenDaysAgo } },
            ],
          },
        ],
      },
    })

    const result = detectConflicts(candidate, comparisonSpells)

    if (result.hasConflict) {
      logger.warn(
        {
          spellAddress: candidate.spellAddress,
          conflictsCount: result.conflicts.length,
          conflicts: result.conflicts,
        },
        '🚨 Conflict detected — updating spell status to CONFLICT'
      )

      const updated = await this.prisma.spellRecord.update({
        where: { id: candidate.id },
        data: {
          status: 'CONFLICT',
          conflictStatus: 'CONFLICT',
          conflictDetail: JSON.stringify({
            hasConflict: true,
            evaluatedAt: now.toISOString(),
            fingerprint: result.fingerprint,
            conflicts: result.conflicts,
          }),
        },
      })
      return updated
    } else {
      logger.info(
        {
          spellAddress: candidate.spellAddress,
          fingerprint: result.fingerprint,
        },
        '✅ Conflict check clear — spell remains READY for execution'
      )

      const updated = await this.prisma.spellRecord.update({
        where: { id: candidate.id },
        data: {
          conflictStatus: 'CLEAR',
          conflictDetail: JSON.stringify({
            hasConflict: false,
            evaluatedAt: now.toISOString(),
            fingerprint: result.fingerprint,
            conflicts: [],
          }),
        },
      })
      return updated
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
