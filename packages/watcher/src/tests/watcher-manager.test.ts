import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WatcherManager } from '../protocols/watcher-manager'
import { ProtocolRegistry } from '../protocols/registry'
import { ProtocolConfig } from '../protocols/types'
import type { PublicClient } from 'viem'
import type { PrismaClient } from '@prisma/client'

describe('WatcherManager', () => {
  let manager: WatcherManager
  let registry: ProtocolRegistry
  let mockClient: any
  let mockPrisma: any

  beforeEach(() => {
    registry = new ProtocolRegistry()
    mockClient = {
      readContract: vi.fn().mockResolvedValue('0x0000000000000000000000000000000000000000'),
    }
    mockPrisma = {
      spellRecord: {
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
    }

    manager = new WatcherManager(
      mockClient as unknown as PublicClient,
      mockPrisma as unknown as PrismaClient,
      registry
    )
  })

  it('registers and starts a watcher for a protocol', async () => {
    const config: ProtocolConfig = {
      id: 'mock-sky',
      name: 'Mock Sky',
      chainId: 1,
      governanceContract: '0x0a3f6849f78076aefaDf113F5BED87720274dDC0',
      governanceType: 'makerdao-spell',
      executionMethod: 'cast',
      timelockDelay: 3600,
      officeHours: false,
      expirySeconds: 86400,
      network: 'mainnet',
    }

    const watcher = await manager.registerAndWatch(config)
    expect(watcher).toBeDefined()
    expect(watcher.getConfig().id).toBe('mock-sky')
    expect(manager.getWatcher('mock-sky')).toBe(watcher)

    const list = manager.listWatchers()
    expect(list).toHaveLength(1)
    expect(list[0].protocol.id).toBe('mock-sky')
    expect(list[0].running).toBe(true)
  })

  it('stops a specific watcher', async () => {
    const config: ProtocolConfig = {
      id: 'proto-stop',
      name: 'Stop Me',
      chainId: 1,
      governanceContract: '0x0a3f6849f78076aefaDf113F5BED87720274dDC0',
      governanceType: 'makerdao-spell',
      executionMethod: 'cast',
      timelockDelay: 3600,
      officeHours: false,
      expirySeconds: 86400,
      network: 'mainnet',
    }

    await manager.registerAndWatch(config)
    expect(manager.getWatcher('proto-stop')).toBeDefined()

    manager.stopWatcher('proto-stop')
    expect(manager.getWatcher('proto-stop')).toBeUndefined()
  })

  it('loads configs and manages multiple watchers', async () => {
    const c1: ProtocolConfig = {
      id: 'p1',
      name: 'P1',
      chainId: 1,
      governanceContract: '0x0a3f6849f78076aefaDf113F5BED87720274dDC0',
      governanceType: 'makerdao-spell',
      executionMethod: 'cast',
      timelockDelay: 3600,
      officeHours: false,
      expirySeconds: 86400,
      network: 'mainnet',
    }
    const c2: ProtocolConfig = {
      id: 'p2',
      name: 'P2',
      chainId: 1,
      governanceContract: '0x9AEE0B04504CeF83A65AC3f0e838D0593BCb2BC7',
      governanceType: 'openzeppelin-governor',
      executionMethod: 'execute',
      timelockDelay: 3600,
      officeHours: false,
      expirySeconds: 86400,
      network: 'mainnet',
    }

    registry.register(c1)
    registry.register(c2)

    await manager.startWatcher(c1)
    await manager.startWatcher(c2)

    expect(manager.listWatchers()).toHaveLength(2)
    expect(manager.getWatcher('p1')).toBeDefined()
    expect(manager.getWatcher('p2')).toBeDefined()

    manager.stopAll()
    expect(manager.getWatcher('p1')).toBeUndefined()
    expect(manager.getWatcher('p2')).toBeUndefined()
  })
})
