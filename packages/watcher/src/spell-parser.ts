import { createPublicClient, http, type PublicClient } from 'viem'
import { mainnet } from 'viem/chains'
import { SPELL_ABI } from './abi'
import { type SpellAction } from './types'
import { logger } from './logger'

/**
 * Read all available metadata from a spell contract
 */
export async function parseSpell(
  client: PublicClient,
  spellAddress: `0x${string}`
): Promise<{
  officeHoursActive: boolean
  nextCastTime: Date
  expiration: Date
  done: boolean
  description: string
  actions: SpellAction[]
}> {
  logger.info({ spellAddress }, 'Parsing spell contract')

  // Multicall — read everything in one round trip
  const results = await Promise.allSettled([
    client.readContract({
      address: spellAddress,
      abi: SPELL_ABI,
      functionName: 'officeHours',
    }),
    client.readContract({
      address: spellAddress,
      abi: SPELL_ABI,
      functionName: 'nextCastTime',
    }),
    client.readContract({
      address: spellAddress,
      abi: SPELL_ABI,
      functionName: 'expiration',
    }),
    client.readContract({
      address: spellAddress,
      abi: SPELL_ABI,
      functionName: 'done',
    }),
    client.readContract({
      address: spellAddress,
      abi: SPELL_ABI,
      functionName: 'description',
    }),
  ])

  // Safe extraction — older spells may not have all fields
  const officeHoursActive = results[0].status === 'fulfilled'
    ? Boolean(results[0].value)
    : true // default: assume office hours active (safer)

  const nextCastTime = results[1].status === 'fulfilled'
    ? new Date(Number(results[1].value) * 1000)
    : new Date(Date.now() + 48 * 60 * 60 * 1000) // fallback: now + 48h

  const expiration = results[2].status === 'fulfilled'
    ? new Date(Number(results[2].value) * 1000)
    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // fallback: now + 30d

  const done = results[3].status === 'fulfilled'
    ? Boolean(results[3].value)
    : false

  const description = results[4].status === 'fulfilled'
    ? String(results[4].value)
    : 'Unknown spell'

  logger.info({
    spellAddress,
    officeHoursActive,
    nextCastTime: nextCastTime.toISOString(),
    expiration: expiration.toISOString(),
    done,
    description: description.slice(0, 100),
  }, 'Spell parsed')

  // Actions: parsed from description for now
  // Full calldata decoding added in Phase 2
  const actions: SpellAction[] = [{
    target: spellAddress,
    signature: 'cast()',
    calldata: '0x',
    description,
  }]

  return {
    officeHoursActive,
    nextCastTime,
    expiration,
    done,
    description,
    actions,
  }
}
