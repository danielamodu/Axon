import { describe, it, expect, vi } from 'vitest'
import { DirectExecutor } from '@keeperhub/sdk'
import { KeeperHubOracle } from '../oracle'

function mockDirect(result: unknown, throws?: Error) {
  const khClient = {
    rawRequest: throws ? vi.fn().mockRejectedValue(throws) : vi.fn().mockResolvedValue(result),
  }
  return new DirectExecutor(khClient as any)
}

describe('KeeperHubOracle', () => {
  it('is unconfigured without a key and reads return null', async () => {
    const oracle = new KeeperHubOracle()
    expect(oracle.isConfigured).toBe(false)
    expect(
      await oracle.readContract({ address: '0xabc', network: 'ethereum', functionName: 'totalSupply' })
    ).toBeNull()
  })

  it('returns string read results via KeeperHub', async () => {
    const oracle = new KeeperHubOracle(mockDirect({ result: '4982145892000000000000000000000' }))
    expect(oracle.isConfigured).toBe(true)
    const out = await oracle.readContract({
      address: '0xabc',
      network: 'ethereum',
      functionName: 'totalSupply',
    })
    expect(out).toBe('4982145892000000000000000000000')
  })

  it('normalizes numeric and array results to strings', async () => {
    const num = new KeeperHubOracle(mockDirect({ result: 42 }))
    expect(
      await num.readContract({ address: '0xabc', network: 'ethereum', functionName: 'f' })
    ).toBe('42')

    const arr = new KeeperHubOracle(mockDirect({ result: ['1', '2'] }))
    expect(
      await arr.readContract({ address: '0xabc', network: 'ethereum', functionName: 'f' })
    ).toBe('1')
  })

  it('returns null (viem fallback signal) when KeeperHub throws', async () => {
    const oracle = new KeeperHubOracle(mockDirect(null, new Error('unreachable')))
    const out = await oracle.readContract({
      address: '0xabc',
      network: 'ethereum',
      functionName: 'totalSupply',
    })
    expect(out).toBeNull()
  })

  it('parses tuple reads in ABI order', async () => {
    const oracle = new KeeperHubOracle(
      mockDirect({ result: ['8723947563', '245075000000', '1750000000', '1750000012', '8723947563'] })
    )
    const tuple = await oracle.readContractTuple({
      address: '0xabc',
      network: 'ethereum',
      functionName: 'latestRoundData',
    })
    expect(tuple).toEqual(['8723947563', '245075000000', '1750000000', '1750000012', '8723947563'])
  })

  it('tracks batch oracle mode explicitly', () => {
    const oracle = new KeeperHubOracle()
    expect(oracle.keeperHubOracleMode).toBe(false)
    oracle.setBatchMode(true)
    expect(oracle.keeperHubOracleMode).toBe(true)
    oracle.setBatchMode(false)
    expect(oracle.keeperHubOracleMode).toBe(false)
  })
})
