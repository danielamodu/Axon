import { describe, it, expect } from 'vitest'
import { buildSimulationState, loadAllConfigs, sanitize } from '../index'

describe('@axon/mcp-server', () => {
  it('loads default protocol configs', () => {
    const configs = loadAllConfigs()
    expect(configs.length).toBeGreaterThanOrEqual(3)
    const sky = configs.find((c: any) => c.id === 'sky')
    expect(sky).toBeDefined()
    expect(sky.governanceType).toBe('makerdao-spell')
  })

  it('sanitizes objects with BigInt properly', () => {
    const input = {
      gas: 500000n,
      val: 'test',
      nested: { b: 123n },
    }
    const clean = sanitize(input)
    expect(clean.gas).toBe('500000')
    expect(clean.nested.b).toBe('123')
  })

  it('contains expected protocol definitions for Sky, Aave, and Compound', () => {
    const configs = loadAllConfigs()
    const ids = configs.map((c: any) => c.id)
    expect(ids).toContain('sky')
    expect(ids).toContain('aave')
    expect(ids).toContain('compound')
  })

  it('rejects unauthenticated requests when AXON_API_KEY is not set', async () => {
    const { authenticateMcp } = await import('../index.js')
    const oldKey = process.env.AXON_API_KEY
    delete process.env.AXON_API_KEY
    try {
      const res = await authenticateMcp()
      expect(res.authorized).toBe(false)
      expect(res.error).toContain('Unauthorized. Set AXON_API_KEY.')
    } finally {
      if (oldKey) process.env.AXON_API_KEY = oldKey
    }
  })

  it('authenticates valid key in test mode', async () => {
    const { authenticateMcp } = await import('../index.js')
    const res = await authenticateMcp('test-key')
    expect(res.authorized).toBe(true)
    expect(res.org).toBeDefined()
    expect(res.org?.id).toBe('test_org_default')
  })
})

describe('buildSimulationState', () => {
  const stored = JSON.stringify({
    score: 'GREEN',
    reasons: ['Clean simulation'],
    projectedAt: '2026-09-10T12:00:00.000Z',
    gasTrend: { averageGwei: 8.4, stddevGwei: 1.2, recentBlocks: [8, 9, 8] },
    usdsTotalSupply: 4982145892.42,
    vatHeadroomUsds: 520000000,
    ethPriceUsd: 2450.75,
    oracleAgeSeconds: 12,
    simulation: { success: true, simulatedVia: 'viem' },
  })

  it('returns the stored live projection when present', () => {
    const view = buildSimulationState('0xabc', {
      protocolId: 'sky',
      status: 'READY',
      simulationScore: 'GREEN',
      conflictDetail: stored,
    })
    expect(view.projectionAvailable).toBe(true)
    expect(view.avgGasGwei).toBe(8.4)
    expect(view.vatHeadroomUsds).toBe(520000000)
    expect(view.simulatedVia).toBe('viem')
    expect(view.simulationSuccess).toBe(true)
  })

  it('says so explicitly when no projection exists yet', () => {
    const view = buildSimulationState('0xabc', {
      protocolId: 'sky',
      status: 'QUEUED',
      simulationScore: null,
      conflictDetail: null,
    })
    expect(view.projectionAvailable).toBe(false)
    expect(view.note).toContain('not been simulated')
    expect(view.avgGasGwei).toBeUndefined()
  })

  it('handles unknown spells without inventing data', () => {
    const view = buildSimulationState('0xmissing', null)
    expect(view.projectionAvailable).toBe(false)
    expect(view.status).toBe('UNKNOWN')
  })

  it('handles unparseable stored projections', () => {
    const view = buildSimulationState('0xabc', {
      protocolId: 'sky',
      status: 'READY',
      simulationScore: 'GREEN',
      conflictDetail: '{not json',
    })
    expect(view.projectionAvailable).toBe(false)
    expect(view.note).toContain('could not be parsed')
  })

  it('never contains the legacy hardcoded studio values', () => {
    const raw = JSON.stringify(
      buildSimulationState('0xabc', { protocolId: 'sky', status: 'QUEUED', conflictDetail: null })
    )
    expect(raw).not.toContain('4982145892.42')
  })
})
