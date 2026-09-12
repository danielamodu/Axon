import { describe, it, expect, vi, afterEach } from 'vitest'
import { ExecutionEngine, getPaymentMode, X402_FEE_USDC } from '../executor'

const oldMode = process.env.PAYMENT_MODE
afterEach(() => {
  if (oldMode === undefined) delete process.env.PAYMENT_MODE
  else process.env.PAYMENT_MODE = oldMode
})

function liveEngine() {
  const mockKhClient: any = {
    createWorkflow: vi.fn().mockResolvedValue({ id: 'wf-pay' }),
    rawRequest: vi.fn().mockResolvedValue({ ok: true, result: { valid: true } }),
    executeWorkflow: vi.fn().mockResolvedValue({ executionId: 'ex-pay-1' }),
  }
  const mockPrisma: any = { spellRecord: { update: vi.fn() } }
  const engine = new ExecutionEngine({} as any, mockPrisma, {} as any, mockKhClient)
  return { engine, mockKhClient }
}

const spell: any = {
  spellAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  actions: [],
  simulationScore: 'GREEN',
}

describe('Phase 9 F6 — native x402 in workflow graph', () => {
  it('defaults to native payment mode', () => {
    delete process.env.PAYMENT_MODE
    expect(getPaymentMode()).toBe('native')
    expect(X402_FEE_USDC).toBe('0.05')
  })

  it('uses gateway mode only when explicitly configured', () => {
    process.env.PAYMENT_MODE = 'gateway'
    expect(getPaymentMode()).toBe('gateway')
  })

  it('prepends Node 0 x402 verification in native mode', async () => {
    delete process.env.PAYMENT_MODE
    const { engine, mockKhClient } = liveEngine()
    await engine.buildAndRegisterWorkflow(spell)

    const input = mockKhClient.createWorkflow.mock.calls[0][0]
    const ids = input.nodes.map((n: any) => n.id)
    expect(ids).toContain('x402-payment-verify')
    expect(ids.length).toBe(11)

    const node0 = input.nodes.find((n: any) => n.id === 'x402-payment-verify')
    expect(node0.data.tags).toEqual(['axon:x402-payment'])
    expect(JSON.parse(node0.data.config.body).amount).toBe('0.05')

    const edgeTargets = Object.fromEntries(input.edges.map((e: any) => [e.source + '->' + e.id, e.target]))
    expect(input.edges.find((e: any) => e.source === 'trigger' && e.target === 'x402-payment-verify')).toBeDefined()
    expect(input.edges.find((e: any) => e.source === 'x402-payment-verify' && e.target === 'read-hat')).toBeDefined()
    expect(edgeTargets).toBeDefined()
  })

  it('omits Node 0 in gateway mode', async () => {
    process.env.PAYMENT_MODE = 'gateway'
    const { engine, mockKhClient } = liveEngine()
    await engine.buildAndRegisterWorkflow(spell)

    const input = mockKhClient.createWorkflow.mock.calls[0][0]
    const ids = input.nodes.map((n: any) => n.id)
    expect(ids).not.toContain('x402-payment-verify')
    expect(ids.length).toBe(10)
  })

  it('passes the payment reference on trigger in native mode', async () => {
    delete process.env.PAYMENT_MODE
    const { engine, mockKhClient } = liveEngine()
    const id = await engine.triggerWorkflow('wf-pay', spell, undefined, {
      x402PaymentReference: spell.spellAddress,
      x402AmountUsdc: '0.05',
    })
    expect(id).toBe('ex-pay-1')
    const input = mockKhClient.executeWorkflow.mock.calls[0][1]
    expect(input.payment).toEqual({
      x402PaymentReference: spell.spellAddress,
      x402AmountUsdc: '0.05',
    })
  })
})
