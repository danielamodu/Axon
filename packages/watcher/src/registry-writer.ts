import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hash,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base, baseSepolia } from 'viem/chains'
import {
  AXON_REGISTRY_ADDRESS,
  AXON_REGISTRY_ABI,
  BASE_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
} from './constants'
import { logger } from './logger'

export interface RegistryEntry {
  protocol: Address
  spellAddress: Address
  actionType: string          // human-readable; hashed to bytes32
  txHash: string              // mainnet Ethereum tx hash (hex); hashed to bytes32
  executedAt: Date
  gasUsed: bigint
  executor: Address
  simulationScore: 0 | 1 | 2  // 0=RED 1=YELLOW 2=GREEN
  keeperHubExecutionId?: string
}

export class RegistryWriter {
  private walletClient: ReturnType<typeof createWalletClient> | null = null
  private publicClient: ReturnType<typeof createPublicClient> | null = null
  private registryAddress: Address | null = null
  private chainId: number

  constructor(privateKey?: string, rpcUrl?: string, registryAddress?: string) {
    this.chainId = process.env.BASE_REGISTRY_CHAIN_ID === String(BASE_SEPOLIA_CHAIN_ID)
      ? BASE_SEPOLIA_CHAIN_ID
      : BASE_CHAIN_ID

    const pk = privateKey ?? process.env.BASE_REGISTRY_PRIVATE_KEY
    const defaultRpc = this.chainId === BASE_SEPOLIA_CHAIN_ID
      ? (process.env.BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org')
      : (process.env.BASE_RPC_URL ?? 'https://mainnet.base.org')
    const rpc = rpcUrl ?? defaultRpc
    const regAddr = registryAddress ?? process.env.AXON_REGISTRY_ADDRESS

    if (!pk || !rpc || !regAddr) {
      logger.warn(
        {
          hasPrivateKey: !!pk,
          hasRpc: !!rpc,
          hasRegistryAddress: !!regAddr,
        },
        'RegistryWriter: missing config — registry writes will be no-ops'
      )
      return
    }

    if (!regAddr.startsWith('0x') || regAddr.length !== 42) {
      logger.warn({ registryAddress: regAddr }, 'RegistryWriter: invalid AXON_REGISTRY_ADDRESS format — skipping')
      return
    }

    const chain = this.chainId === BASE_SEPOLIA_CHAIN_ID ? baseSepolia : base
    const account = privateKeyToAccount(pk as Hash)

    this.walletClient = createWalletClient({ account, chain, transport: http(rpc) })
    this.publicClient = createPublicClient({ chain, transport: http(rpc) })
    this.registryAddress = regAddr as Address

    logger.info(
      { registryAddress: regAddr, chainId: this.chainId, executor: account.address },
      'RegistryWriter initialised'
    )
  }

  get isConfigured(): boolean {
    return !!(this.walletClient && this.publicClient && this.registryAddress)
  }

  /**
   * Write a confirmed execution to AxonRegistry on Base.
   * Returns the Base tx hash, or null in no-op mode.
   */
  async log(entry: RegistryEntry): Promise<Hash | null> {
    if (!this.isConfigured) {
      logger.info(
        { spellAddress: entry.spellAddress },
        'RegistryWriter: no-op mode — skipping registry write'
      )
      return null
    }

    const registryAddress = this.registryAddress!
    const walletClient = this.walletClient!
    const publicClient = this.publicClient!

    // Encode the mainnet tx hash as bytes32
    const txHashBytes32 = this.hexToBytes32(entry.txHash)
    // Encode the actionType string as bytes32, including keeperHubExecutionId if present
    const rawActionType = entry.keeperHubExecutionId
      ? `KH:${entry.keeperHubExecutionId}`
      : entry.actionType
    const actionTypeBytes32 = this.stringToBytes32(rawActionType)

    logger.info(
      { spellAddress: entry.spellAddress, txHash: entry.txHash },
      '📝 Writing execution record to AxonRegistry on Base'
    )

    try {
      const hash = await walletClient.writeContract({
        address: registryAddress,
        abi: AXON_REGISTRY_ABI,
        functionName: 'logExecution',
        args: [
          entry.protocol,
          entry.spellAddress,
          actionTypeBytes32,
          txHashBytes32,
          BigInt(Math.floor(entry.executedAt.getTime() / 1000)),
          entry.gasUsed,
          entry.executor,
          entry.simulationScore,
        ],
      })

      logger.info({ baseTxHash: hash, spellAddress: entry.spellAddress }, '✅ AxonRegistry.logExecution submitted')

      // Wait for one confirmation
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 })

      logger.info(
        {
          baseTxHash: hash,
          blockNumber: receipt.blockNumber.toString(),
          gasUsed: receipt.gasUsed.toString(),
          spellAddress: entry.spellAddress,
        },
        '✅ Registry write confirmed on Base'
      )

      return hash
    } catch (err: any) {
      logger.error(
        { err: err.message, spellAddress: entry.spellAddress },
        '❌ RegistryWriter: logExecution transaction failed'
      )
      // Non-fatal — execution already recorded in Postgres; Base registry is supplementary
      return null
    }
  }

  // ---------------------------------------------------------------------------
  // Encoding helpers
  // ---------------------------------------------------------------------------

  /** Pad/truncate a hex string (with or without 0x) to bytes32 */
  hexToBytes32(hex: string): `0x${string}` {
    const clean = hex.startsWith('0x') ? hex.slice(2) : hex
    const padded = clean.padEnd(64, '0').slice(0, 64)
    return `0x${padded}` as `0x${string}`
  }

  /** UTF-8 string → bytes32 (right-padded with zeroes) */
  stringToBytes32(str: string): `0x${string}` {
    const bytes = Buffer.from(str, 'utf8').slice(0, 32)
    const padded = Buffer.concat([bytes, Buffer.alloc(32 - bytes.length)])
    return `0x${padded.toString('hex')}` as `0x${string}`
  }
}
