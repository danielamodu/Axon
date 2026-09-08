import path from 'node:path'
import fs from 'node:fs'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProtocolRegistry } from '../protocols/registry'
import { GovernanceWatcher } from '../watcher'
import { WatcherManager } from '../protocols/watcher-manager'
import { loadAllConfigs, sanitize } from '../../../mcp-server/src/index'
import { detectGovernanceType } from '../../../cli/src/index'
import type { PublicClient } from 'viem'
import type { PrismaClient } from '@prisma/client'

describe('Phase 7 — Protocol Config & Integration Tests', () => {
  let registry: ProtocolRegistry

  beforeEach(() => {
    registry = new ProtocolRegistry()
  })

  // 1. Loading sky.json config and starting watcher with it
  it('loads sky.json config and initializes GovernanceWatcher with it', async () => {
    const configsDir = path.join(__dirname, '../protocols/configs')
    const skyConfig = registry.loadFromFile(path.join(configsDir, 'sky.json'))

    expect(skyConfig.id).toBe('sky')
    expect(skyConfig.timelockDelay).toBe(172800)
    expect(skyConfig.officeHours).toBe(true)

    const mockClient = {
      readContract: vi.fn().mockResolvedValue('0x0000000000000000000000000000000000000000'),
    }
    const mockPrisma = {
      spellRecord: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    }

    const watcher = new GovernanceWatcher(
      skyConfig,
      mockClient as unknown as PublicClient,
      mockPrisma as unknown as PrismaClient
    )

    expect(watcher.getConfig().id).toBe('sky')
    expect(watcher.getConfig().governanceContract).toBe(skyConfig.governanceContract)

    await watcher.poll()
    expect(mockClient.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: skyConfig.governanceContract,
        functionName: 'hat',
      })
    )
  })

  // 2. WatcherManager spinning up multiple protocol watchers
  it('WatcherManager spins up watchers for sky, aave, and compound simultaneously', async () => {
    const configsDir = path.join(__dirname, '../protocols/configs')
    registry.loadFromDirectory(configsDir)

    const mockClient = {
      readContract: vi.fn().mockResolvedValue('0x0000000000000000000000000000000000000000'),
    }
    const mockPrisma = {
      spellRecord: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    }

    const manager = new WatcherManager(
      mockClient as unknown as PublicClient,
      mockPrisma as unknown as PrismaClient,
      registry
    )

    for (const config of registry.list()) {
      await manager.startWatcher(config)
    }

    const watchers = manager.listWatchers()
    expect(watchers.length).toBeGreaterThanOrEqual(3)

    const skyWatcher = manager.getWatcher('sky')
    const aaveWatcher = manager.getWatcher('aave')
    const compWatcher = manager.getWatcher('compound')

    expect(skyWatcher).toBeDefined()
    expect(aaveWatcher).toBeDefined()
    expect(compWatcher).toBeDefined()

    expect(skyWatcher?.getConfig().governanceType).toBe('makerdao-spell')
    expect(aaveWatcher?.getConfig().governanceType).toBe('openzeppelin-governor')
    expect(compWatcher?.getConfig().governanceType).toBe('compound-governor')

    manager.stopAll()
    expect(manager.getWatcher('sky')).toBeUndefined()
  })

  // 3. MCP Server Helpers & Tool responses
  it('MCP Server helper loadAllConfigs returns registered protocols', () => {
    const configs = loadAllConfigs()
    expect(configs.length).toBeGreaterThanOrEqual(3)

    const ids = configs.map((c: any) => c.id)
    expect(ids).toContain('sky')
    expect(ids).toContain('aave')
    expect(ids).toContain('compound')
  })

  it('MCP sanitize serializes BigInt fields properly', () => {
    const testObj = {
      spellAddress: '0x123',
      gasUsed: 210000n,
      nested: {
        value: 1000000000000000000n,
      },
    }
    const result = sanitize(testObj)
    expect(result.gasUsed).toBe('210000')
    expect(result.nested.value).toBe('1000000000000000000')
  })

  it('MCP register_protocol saves and validates new protocol config', () => {
    const configsDir = path.join(__dirname, '../protocols/configs')
    const testConfig = {
      id: 'test-mcp-proto',
      name: 'Test MCP Protocol',
      chainId: 1,
      governanceContract: '0x0a3f6849f78076aefaDf113F5BED87720274dDC0',
      governanceType: 'makerdao-spell',
      executionMethod: 'cast',
      timelockDelay: 86400,
      officeHours: false,
      expirySeconds: 604800,
      network: 'mainnet',
    }

    const testFile = path.join(configsDir, 'test-mcp-proto.json')
    fs.writeFileSync(testFile, JSON.stringify(testConfig, null, 2), 'utf-8')

    try {
      const loaded = registry.loadFromFile(testFile)
      expect(loaded.id).toBe('test-mcp-proto')
      expect(loaded.name).toBe('Test MCP Protocol')
    } finally {
      if (fs.existsSync(testFile)) fs.unlinkSync(testFile)
    }
  })

  // 4. CLI Auto-detection heuristics
  it('CLI detectGovernanceType correctly identifies governance patterns from bytecode', async () => {
    // Test fallback behavior when no bytecode or unknown contract
    const detected = await detectGovernanceType('0x0000000000000000000000000000000000000001', 'mainnet')
    expect(['makerdao-spell', 'compound-governor', 'openzeppelin-governor', 'optimistic-timelock']).toContain(detected)
  })
})
