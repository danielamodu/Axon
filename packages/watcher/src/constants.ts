export const SKY_CHIEF_ADDRESS = '0x0a3f6849f78076aefaDf113F5BED87720274dDC0' as const

// GSM Pause Delay — 48 hours in seconds
export const GSM_PAUSE_DELAY_SECONDS = 48 * 60 * 60

// Office hours: Monday–Friday, 14:00–21:00 UTC
export const OFFICE_HOURS = {
  startHour: 14,
  endHour: 21,
  // 1 = Monday, 5 = Friday (getUTCDay: 0=Sun, 1=Mon ... 6=Sat)
  activeDays: [1, 2, 3, 4, 5],
} as const

// Spell expiry — 30 days
export const SPELL_EXPIRY_SECONDS = 30 * 24 * 60 * 60

// Polling interval — 12 seconds (one Ethereum block)
export const POLL_INTERVAL_MS = 12_000

// Projector polling interval — 60 seconds
export const PROJECTOR_POLL_INTERVAL_MS = 60_000

// Key Protocol Contracts (Ethereum mainnet)
export const USDS_TOKEN_ADDRESS = '0xdC035D45d973E3EC169d2276DDab16f1e407384F' as const
export const SKY_VAT_ADDRESS = '0x35D1b3F3D7966A1DFe207aa4514C12a259A0492B' as const
export const CHAINLINK_ETH_USD_ADDRESS = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419' as const

// Executor polling interval — 30 seconds
export const EXECUTOR_POLL_INTERVAL_MS = 30_000

// Gas price safety ceiling — halt execution above this gwei threshold
export const MAX_GAS_PRICE_GWEI = 100

// ---------------------------------------------------------------------------
// Phase 5 — Onchain Registry (Base)
// ---------------------------------------------------------------------------

// Chain IDs
export const BASE_CHAIN_ID = 8453
export const BASE_SEPOLIA_CHAIN_ID = 84532

// AxonRegistry contract address on Base (filled after deployment)
export const AXON_REGISTRY_ADDRESS = (process.env.AXON_REGISTRY_ADDRESS ?? '') as `0x${string}`

// Webhook server port for POST /webhook/execution
export const WEBHOOK_SERVER_PORT = Number(process.env.WEBHOOK_SERVER_PORT ?? 3001)

// AxonRegistry ABI — minimal surface needed by RegistryWriter
export const AXON_REGISTRY_ABI = [
  {
    name: 'logExecution',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'protocol',         type: 'address' },
      { name: 'spellAddress',     type: 'address' },
      { name: 'actionType',       type: 'bytes32' },
      { name: 'txHash',           type: 'bytes32' },
      { name: 'executedAt',       type: 'uint256' },
      { name: 'gasUsed',          type: 'uint256' },
      { name: 'executor',         type: 'address' },
      { name: 'simulationScore',  type: 'uint8'   },
    ],
    outputs: [],
  },
  {
    name: 'getRecord',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'protocol',        type: 'address' },
          { name: 'spellAddress',    type: 'address' },
          { name: 'actionType',      type: 'bytes32' },
          { name: 'txHash',          type: 'bytes32' },
          { name: 'executedAt',      type: 'uint256' },
          { name: 'gasUsed',         type: 'uint256' },
          { name: 'executor',        type: 'address' },
          { name: 'simulationScore', type: 'uint8'   },
        ],
      },
    ],
  },
  {
    name: 'recordCount',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'ExecutionLogged',
    type: 'event',
    inputs: [
      { name: 'protocol',         type: 'address', indexed: true  },
      { name: 'spell',            type: 'address', indexed: true  },
      { name: 'txHash',           type: 'bytes32', indexed: false },
      { name: 'executedAt',       type: 'uint256', indexed: false },
      { name: 'simulationScore',  type: 'uint8',   indexed: false },
    ],
  },
] as const
