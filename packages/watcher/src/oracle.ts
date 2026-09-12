import { KeeperHubClient, DirectExecutor, isReadResult } from '@keeperhub/sdk'
import { logger } from './logger'

/**
 * Phase 9, Feature 1 — KeeperHub as blockchain oracle.
 *
 * Contract reads (USDS totalSupply, Vat Line/debt, Chainlink latestRoundData)
 * go through KeeperHub's Direct Execution API first. viem is strictly a
 * fallback when KeeperHub is unreachable or returns an unreadable result.
 *
 * Gas-trend block data stays on viem: the KeeperHub SDK exposes no block-data
 * surface (only contract calls, transfers and workflows), so there is nothing
 * to route through. This is a documented limitation, not a silent exception.
 */
export class KeeperHubOracle {
  private direct: DirectExecutor | null = null
  /** True when the last batch of contract reads all succeeded via KeeperHub. */
  keeperHubOracleMode = false

  constructor(apiKeyOrClient?: string | KeeperHubClient | DirectExecutor) {
    const key = typeof apiKeyOrClient === 'string' ? apiKeyOrClient : undefined
    if (apiKeyOrClient instanceof DirectExecutor) {
      // Injected directly (tests and advanced embedding)
      this.direct = apiKeyOrClient
      return
    }
    const client =
      typeof apiKeyOrClient === 'object' && apiKeyOrClient !== null
        ? (apiKeyOrClient as KeeperHubClient)
        : key
          ? new KeeperHubClient({ apiKey: key })
          : undefined
    if (client) {
      this.direct = new DirectExecutor(client)
    }
  }

  get isConfigured(): boolean {
    return this.direct !== null
  }

  /**
   * Read a view/pure function through KeeperHub. Returns the raw result
   * string on success, null when KeeperHub is unconfigured, unreachable,
   * or returns something unparseable (caller falls back to viem).
   */
  async readContract(options: {
    address: string
    network: string
    functionName: string
    functionArgs?: string
    abi?: string
  }): Promise<string | null> {
    if (!this.direct) return null
    try {
      const res = await this.direct.callContract({
        contractAddress: options.address,
        network: options.network,
        functionName: options.functionName,
        functionArgs: options.functionArgs ?? '[]',
        abi: options.abi,
      })
      if (!isReadResult(res)) return null
      const r = (res as { result: unknown }).result
      if (typeof r === 'string') return r
      if (typeof r === 'number' || typeof r === 'bigint') return String(r)
      if (Array.isArray(r)) return String(r[0] ?? '')
      if (r && typeof r === 'object') {
        const vals = Object.values(r as Record<string, unknown>)
        if (vals.length > 0 && (typeof vals[0] === 'string' || typeof vals[0] === 'number' || typeof vals[0] === 'bigint')) {
          return String(vals[0])
        }
      }
      return null
    } catch (err: any) {
      logger.warn({ err: err?.message, fn: options.functionName }, 'KeeperHub oracle read failed — viem fallback')
      return null
    }
  }

  /** Mark a projection batch: true only if every contract read came via KH. */
  setBatchMode(allViaKeeperHub: boolean): void {
    this.keeperHubOracleMode = allViaKeeperHub
    if (allViaKeeperHub) {
      logger.info('🔮 State projected via KeeperHub oracle')
    }
  }

  /**
   * Tuple-valued read (e.g. Chainlink latestRoundData). Returns all result
   * fields as strings in ABI order, or null on any failure.
   */
  async readContractTuple(options: {
    address: string
    network: string
    functionName: string
    functionArgs?: string
    abi?: string
  }): Promise<string[] | null> {
    if (!this.direct) return null
    try {
      const res = await this.direct.callContract({
        contractAddress: options.address,
        network: options.network,
        functionName: options.functionName,
        functionArgs: options.functionArgs ?? '[]',
        abi: options.abi,
      })
      if (!isReadResult(res)) return null
      const r = (res as { result: unknown }).result
      const toStr = (v: unknown): string | null =>
        typeof v === 'string' ? v
        : typeof v === 'number' || typeof v === 'bigint' ? String(v)
        : null
      if (Array.isArray(r)) {
        const out = r.map(toStr)
        return out.every((v) => v !== null) ? (out as string[]) : null
      }
      if (r && typeof r === 'object') {
        const vals = Object.values(r as Record<string, unknown>).map(toStr)
        return vals.length > 0 && vals.every((v) => v !== null) ? (vals as string[]) : null
      }
      const single = toStr(r)
      return single !== null ? [single] : null
    } catch (err: any) {
      logger.warn({ err: err?.message, fn: options.functionName }, 'KeeperHub oracle tuple read failed — viem fallback')
      return null
    }
  }
}
