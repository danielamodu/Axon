import { describe, it, expect } from 'vitest'
import { loadAllConfigs, sanitize } from '../index'

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
