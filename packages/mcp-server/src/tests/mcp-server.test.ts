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
})
