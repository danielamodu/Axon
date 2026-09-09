import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PaymentProcessor, createX402Client } from '../payment.js'

describe('Phase 8 — x402 Payment Processing & Gateway Client', () => {
  let mockPrisma: any
  let mockNotify: any

  const dummyOrg = {
    id: 'org-test-1',
    name: 'Sky Ecosystem',
    usdcBalance: 5.0,
    totalFeesCharged: 0.25,
  }

  beforeEach(() => {
    mockPrisma = {
      organisation: {
        findUnique: vi.fn().mockResolvedValue(dummyOrg),
        findFirst: vi.fn().mockResolvedValue(dummyOrg),
        update: vi.fn().mockResolvedValue(dummyOrg),
      },
      executionPayment: {
        create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'pay-123', ...data })),
        findUnique: vi.fn(),
      },
    }
    mockNotify = {
      notifyPaymentSettled: vi.fn().mockResolvedValue(undefined),
      notifyLowBalance: vi.fn().mockResolvedValue(undefined),
    }
  })

  it('PaymentProcessor defaults to simulated mode', () => {
    delete process.env.PAYMENT_MODE
    const processor = new PaymentProcessor(mockPrisma as any, mockNotify as any)
    expect(processor.getMode()).toBe('simulated')
  })

  it('PaymentProcessor settles simulated payment with 0x402b prefix', async () => {
    const processor = new PaymentProcessor(mockPrisma as any, mockNotify as any)
    const res = await processor.processPayment('0x900c952c676595DdB392FA6349aD5f0674a67Eeb', dummyOrg.id, true)

    expect(res.success).toBe(true)
    expect(res.mode).toBe('simulated')
    expect(res.feeUsdc).toBe(0.05)
    expect(res.paymentTxHash).toMatch(/^0x402b[0-9a-f]{56}$/)
    expect(res.settledAt).toBeInstanceOf(Date)
  })

  it('PaymentProcessor creates ExecutionPayment database record', async () => {
    const processor = new PaymentProcessor(mockPrisma as any, mockNotify as any)
    await processor.processPayment('0x900c952c676595DdB392FA6349aD5f0674a67Eeb', dummyOrg.id, true)

    expect(mockPrisma.executionPayment.create).toHaveBeenCalledOnce()
    const callArgs = mockPrisma.executionPayment.create.mock.calls[0][0]
    expect(callArgs.data.spellAddress).toBe('0x900c952c676595DdB392FA6349aD5f0674a67Eeb')
    expect(callArgs.data.feeUsdc).toBe(0.05)
    expect(callArgs.data.status).toBe('SETTLED')
  })

  it('PaymentProcessor deducts fee and updates totalFeesCharged on organisation', async () => {
    const processor = new PaymentProcessor(mockPrisma as any, mockNotify as any)
    await processor.processPayment('0x900c952c676595DdB392FA6349aD5f0674a67Eeb', dummyOrg.id, true)

    expect(mockPrisma.organisation.update).toHaveBeenCalledOnce()
    const updateArgs = mockPrisma.organisation.update.mock.calls[0][0]
    expect(updateArgs.where.id).toBe(dummyOrg.id)
    expect(updateArgs.data.usdcBalance).toBe(4.95)
    expect(updateArgs.data.totalFeesCharged).toBe(0.3)
  })

  it('PaymentProcessor dispatches notifyPaymentSettled notification', async () => {
    const processor = new PaymentProcessor(mockPrisma as any, mockNotify as any)
    await processor.processPayment('0x900c952c676595DdB392FA6349aD5f0674a67Eeb', dummyOrg.id, true)

    expect(mockNotify.notifyPaymentSettled).toHaveBeenCalledOnce()
    const notifyArgs = mockNotify.notifyPaymentSettled.mock.calls[0][0]
    expect(notifyArgs.spellAddress).toBe('0x900c952c676595DdB392FA6349aD5f0674a67Eeb')
    expect(notifyArgs.feeUsdc).toBe(0.05)
  })

  it('PaymentProcessor sends low balance notification without blocking execution when balance < 0.05', async () => {
    mockPrisma.organisation.findUnique.mockResolvedValue({
      ...dummyOrg,
      usdcBalance: 0.01,
    })

    const processor = new PaymentProcessor(mockPrisma as any, mockNotify as any)
    const res = await processor.processPayment('0x900c952c676595DdB392FA6349aD5f0674a67Eeb', dummyOrg.id, true)

    expect(mockNotify.notifyLowBalance).toHaveBeenCalledOnce()
    expect(res.success).toBe(true)
    expect(res.paymentTxHash).toBeDefined()
  })

  it('createX402Client wraps fetch with payment logic in simulated mode', async () => {
    process.env.PAYMENT_MODE = 'simulated'
    const origFetch = global.fetch
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ ok: true, executionId: 'kh-exec-1', paymentSettled: true }),
    })
    ;(global as any).fetch = mockFetch

    const x402Client = createX402Client({ maxPaymentUsdc: 0.1 })
    const res = await x402Client.post('http://localhost:3003/execute/spell', { spellAddress: '0x900c' })

    ;(global as any).fetch = origFetch

    expect(res.executionId).toBe('kh-exec-1')
    expect(res.paymentSettled).toBe(true)
  })

  it('createX402Client responds to 402 challenge with payment authorization header', async () => {
    process.env.PAYMENT_MODE = 'simulated'
    const origFetch = global.fetch
    let callCount = 0

    const mockFetch = vi.fn().mockImplementation(async (url, init) => {
      callCount++
      if (callCount === 1) {
        return {
          status: 402,
          ok: false,
          headers: new Headers({
            'WWW-Authenticate': 'x402 realm="Axon Execution", token="USDC", amount="0.05"',
          }),
          json: async () => ({ error: 'Payment Required', amountUsdc: 0.05 }),
        }
      }
      return {
        status: 200,
        ok: true,
        headers: new Headers(),
        json: async () => ({
          success: true,
          executionId: 'kh-exec-retry',
          txHash: '0xsimulatedpayment',
          paymentSettled: true,
        }),
      }
    })
    ;(global as any).fetch = mockFetch

    const x402Client = createX402Client({ maxPaymentUsdc: 0.1 })
    const res = await x402Client.post('http://localhost:3003/execute/spell', { spellAddress: '0x900c' })

    ;(global as any).fetch = origFetch

    expect(callCount).toBe(2)
    expect(res.paymentSettled).toBe(true)
    const finalCallInit = mockFetch.mock.calls[1][1]
    expect(finalCallInit.headers['Authorization']).toContain('x402-payment')
  })

  it('createX402Client falls back gracefully when gateway fetch fails', async () => {
    process.env.PAYMENT_MODE = 'simulated'
    const origFetch = global.fetch
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network offline'))
    ;(global as any).fetch = mockFetch

    const x402Client = createX402Client({ maxPaymentUsdc: 0.05 })
    const res = await x402Client.post('http://localhost:3003/execute/spell', { spellAddress: '0x900c' })

    ;(global as any).fetch = origFetch

    expect(res.success).toBe(true)
    expect(res.paymentSettled).toBe(true)
    expect(res.executionId).toMatch(/^gateway-exec-/)
  })
})

