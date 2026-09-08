import { z } from 'zod'

export type GovernanceType =
  | 'makerdao-spell'
  | 'compound-governor'
  | 'openzeppelin-governor'
  | 'optimistic-timelock'

export interface ProtocolConfig {
  id: string                    // unique slug e.g. "sky", "aave", "compound"
  name: string                  // display name
  chainId: number               // 1 = mainnet
  governanceContract: string    // address
  governanceType: GovernanceType
  executionMethod: 'cast' | 'execute' | 'queue-execute'
  timelockDelay: number         // seconds
  officeHours: boolean          // does it have office hours constraint
  officeHoursStart?: number     // UTC hour (default 14)
  officeHoursEnd?: number       // UTC hour (default 21)
  officeDays?: number[]         // UTC days 1-5 (default Mon-Fri)
  expirySeconds: number         // how long before spell/proposal expires
  network: 'mainnet' | 'base' | 'arbitrum' | 'optimism'
  rpcUrl?: string               // override default RPC
  tags?: string[]               // e.g. ["lending", "stablecoin"]
}

export const ProtocolConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  chainId: z.number().int().positive(),
  governanceContract: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Invalid Ethereum address'),
  governanceType: z.enum([
    'makerdao-spell',
    'compound-governor',
    'openzeppelin-governor',
    'optimistic-timelock',
  ]),
  executionMethod: z.enum(['cast', 'execute', 'queue-execute']),
  timelockDelay: z.number().nonnegative(),
  officeHours: z.boolean(),
  officeHoursStart: z.number().min(0).max(23).optional(),
  officeHoursEnd: z.number().min(0).max(23).optional(),
  officeDays: z.array(z.number().min(0).max(6)).optional(),
  expirySeconds: z.number().positive(),
  network: z.enum(['mainnet', 'base', 'arbitrum', 'optimism']),
  rpcUrl: z.string().url().optional(),
  tags: z.array(z.string()).optional(),
})
