export const SKY_CHIEF_ADDRESS = '0x0a3f6849f78076aefaDf113F5BED87720274dDC0' as const

// GSM Pause Delay — 48 hours in seconds
export const GSM_PAUSE_DELAY_SECONDS = 48 * 60 * 60

// Office hours: Monday–Friday, 14:00–21:00 UTC
export const OFFICE_HOURS = {
  startHour: 14,
  endHour: 21,
  activeDays: [1, 2, 3, 4, 5],
} as const

// Spell expiry — 30 days
export const SPELL_EXPIRY_SECONDS = 30 * 24 * 60 * 60

// Key Protocol Contracts (Ethereum mainnet)
export const USDS_TOKEN_ADDRESS = '0xdC035D45d973E3EC169d2276DDab16f1e407384F' as const
export const SKY_VAT_ADDRESS = '0x35D1b3F3D7966A1DFe207aa4514C12a259A0492B' as const
export const CHAINLINK_ETH_USD_ADDRESS = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419' as const

// Base Registry
export const BASE_CHAIN_ID = 8453
export const BASE_SEPOLIA_CHAIN_ID = 84532
export const AXON_REGISTRY_ADDRESS = '0xBf4bc8ACCbd771AeFC68de80a4ED3fa5442DD70B' as const
