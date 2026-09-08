import path from 'node:path'
import { describe, it, expect, beforeEach } from 'vitest'
import { ProtocolRegistry } from '../protocols/registry'
import { ProtocolConfig } from '../protocols/types'

describe('ProtocolRegistry', () => {
  let registry: ProtocolRegistry

  beforeEach(() => {
    registry = new ProtocolRegistry()
  })

  it('validates a valid ProtocolConfig', () => {
    const valid: ProtocolConfig = {
      id: 'test-proto',
      name: 'Test Protocol',
      chainId: 1,
      governanceContract: '0x0a3f6849f78076aefaDf113F5BED87720274dDC0',
      governanceType: 'makerdao-spell',
      executionMethod: 'cast',
      timelockDelay: 3600,
      officeHours: true,
      officeHoursStart: 14,
      officeHoursEnd: 21,
      officeDays: [1, 2, 3, 4, 5],
      expirySeconds: 86400,
      network: 'mainnet',
      tags: ['test'],
    }
    const result = registry.validate(valid)
    expect(result.id).toBe('test-proto')
    expect(result.name).toBe('Test Protocol')
  })

  it('throws validation error for invalid address or type', () => {
    const invalid = {
      id: 'bad-proto',
      name: 'Bad Protocol',
      chainId: 1,
      governanceContract: 'not-an-address',
      governanceType: 'invalid-type',
      executionMethod: 'cast',
      timelockDelay: 3600,
      officeHours: false,
      expirySeconds: 86400,
      network: 'mainnet',
    }
    expect(() => registry.validate(invalid)).toThrow()
  })

  it('registers and retrieves configs', () => {
    const config: ProtocolConfig = {
      id: 'custom',
      name: 'Custom Protocol',
      chainId: 8453,
      governanceContract: '0x9AEE0B04504CeF83A65AC3f0e838D0593BCb2BC7',
      governanceType: 'openzeppelin-governor',
      executionMethod: 'execute',
      timelockDelay: 86400,
      officeHours: false,
      expirySeconds: 604800,
      network: 'base',
    }
    registry.register(config)
    expect(registry.get('custom')).toEqual(config)
    expect(registry.list()).toHaveLength(1)
  })

  it('loads sky.json, aave.json, and compound.json from directory', () => {
    const configsDir = path.join(__dirname, '../protocols/configs')
    const loaded = registry.loadFromDirectory(configsDir)

    expect(loaded.length).toBeGreaterThanOrEqual(3)

    const sky = registry.get('sky')
    expect(sky).toBeDefined()
    expect(sky?.governanceType).toBe('makerdao-spell')
    expect(sky?.executionMethod).toBe('cast')

    const aave = registry.get('aave')
    expect(aave).toBeDefined()
    expect(aave?.governanceType).toBe('openzeppelin-governor')
    expect(aave?.executionMethod).toBe('execute')

    const compound = registry.get('compound')
    expect(compound).toBeDefined()
    expect(compound?.governanceType).toBe('compound-governor')
    expect(compound?.executionMethod).toBe('queue-execute')
  })
})
