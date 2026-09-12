import { describe, it, expect, vi } from 'vitest'
import { ProtocolWalletManager } from '../protocol-wallets'
import { ExecutionEngine } from '../executor'
import type { ProtocolConfig } from '../protocols/types'

const cfg: ProtocolConfig = {
  id: 'sky',
  name: 'Sky Protocol',
  chainId: 1,
  governanceContract: '0x0a3f6849f78076aefaDf113F5BED87720274dDC0',
  governanceType: 'makerdao-spell',
  executionMethod: 'cast',
  timelockDelay: 172800,
  officeHours: false,
  expirySeconds: 2592000,
  network: 'mainnet',
}

function mockPrisma(rows: Record<string, any> = {}) {
  return {
    protocol: {
      findFirst: vi.fn().mockImplementation(async (args: any) => rows[args.where.id] ?? null),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  }
}

describe('ProtocolWalletManager (F5)', () => {
  it('provisions a scoped wallet and persists it on registration', async () => {
    const khClient = {
      rawRequest: vi.fn().mockResolvedValue({ walletId: 'w-sky-1', address: '0xwallet000000000000000000000000000000000001' }),
    }
    const prisma: any = mockPrisma()
    const manager = new ProtocolWalletManager(khClient as any, prisma)

    const wallet = await manager.provisionWallet('sky', cfg)

    expect(wallet?.walletId).toBe('w-sky-1')
    expect(khClient.rawRequest).toHaveBeenCalledWith(
      '/api/wallets',
      expect.objectContaining({ method: 'POST' })
    )
    const body = JSON.parse(khClient.rawRequest.mock.calls[0][1].body)
    expect(body.scopes[0].allowedContracts).toEqual([cfg.governanceContract])
    expect(body.scopes[0].allowedFunctions).toEqual(['cast()', 'execute()', 'queue()'])
    expect(prisma.protocol.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sky' },
        data: expect.objectContaining({ keeperHubWalletId: 'w-sky-1' }),
      })
    )
  })

  it('returns null without a KeeperHub key (shared wallet fallback)', async () => {
    const manager = new ProtocolWalletManager()
    expect(manager.isConfigured).toBe(false)
    expect(await manager.provisionWallet('sky', cfg)).toBeNull()
  })

  it('returns null when the wallet endpoint is unavailable', async () => {
    const khClient = { rawRequest: vi.fn().mockRejectedValue(new Error('404')) }
    const manager = new ProtocolWalletManager(khClient as any, mockPrisma() as any)
    expect(await manager.provisionWallet('sky', cfg)).toBeNull()
  })

  it('reads back the stored wallet, or null when absent', async () => {
    const withWallet = new ProtocolWalletManager({} as any, mockPrisma({
      sky: { id: 'sky', keeperHubWalletId: 'w-sky-1', keeperHubWalletAddress: '0xwallet1' },
    }) as any)
    expect(await withWallet.getWallet('sky')).toEqual({ walletId: 'w-sky-1', address: '0xwallet1' })

    const without = new ProtocolWalletManager({} as any, mockPrisma() as any)
    expect(await without.getWallet('nope')).toBeNull()
  })
})

describe('Executor protocol-scoped wallet threading (F5)', () => {
  it('embeds the protocol walletId in the execute node, not the shared wallet', async () => {
    const khClient = {
      createWorkflow: vi.fn().mockResolvedValue({ id: 'wf-wallet' }),
      rawRequest: vi.fn().mockResolvedValue({ ok: true, result: { valid: true } }),
    }
    const mockPrisma: any = { spellRecord: { update: vi.fn() } }
    const engine = new ExecutionEngine(
      {} as any,
      mockPrisma,
      { notifyExecutionStarted: vi.fn() } as any,
      khClient as any
    )
    const spell: any = {
      spellAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      actions: [],
      simulationScore: 'GREEN',
    }

    await engine.buildAndRegisterWorkflow(spell, 'w-sky-1')

    const input = khClient.createWorkflow.mock.calls[0][0]
    const execNode = input.nodes.find((n: any) => n.id === 'execute-cast')
    expect(execNode.data.config.walletId).toBe('w-sky-1')
    expect(input.description).toContain('w-sky-1')
  })

  it('omits walletId when no protocol wallet exists (shared wallet)', async () => {
    const khClient = {
      createWorkflow: vi.fn().mockResolvedValue({ id: 'wf-shared' }),
      rawRequest: vi.fn().mockResolvedValue({ ok: true, result: { valid: true } }),
    }
    const mockPrisma: any = { spellRecord: { update: vi.fn() } }
    const engine = new ExecutionEngine({} as any, mockPrisma, {} as any, khClient as any)
    const spell: any = {
      spellAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      actions: [],
      simulationScore: 'GREEN',
    }

    await engine.buildAndRegisterWorkflow(spell)

    const input = khClient.createWorkflow.mock.calls[0][0]
    const execNode = input.nodes.find((n: any) => n.id === 'execute-cast')
    expect(execNode.data.config.walletId).toBeUndefined()
  })
})
