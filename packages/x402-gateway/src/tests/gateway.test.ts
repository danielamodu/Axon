import { describe, it, expect, vi } from 'vitest'
import { app } from '../index.js'

describe('x402 Gateway Microservice', () => {
  it('GET /health returns 200 OK with status', async () => {
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('ok')
  })

  it('POST /execute/spell without payment credentials returns 402 Payment Required', async () => {
    const res = await app.request('/execute/spell', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spellAddress: '0x900c952c676595DdB392FA6349aD5f0674a67Eeb' }),
    })

    expect(res.status).toBe(402)
    expect(res.headers.get('X-402-Required')).toBe('true')
    expect(res.headers.get('X-402-Price')).toBe('$0.05')
    expect(res.headers.get('X-402-Network')).toBe('base')
    expect(res.headers.get('X-402-Pay-To')).toBeDefined()

    const body = await res.json()
    expect(body.error).toBe('Payment Required')
    expect(body.price).toBe('0.05 USDC')
    expect(body.network).toBe('base')
    expect(body.instructions).toContain('EIP-3009')
  })

  it('POST /execute/spell with Authorization header executes and returns 200 with settlement receipt', async () => {
    const res = await app.request('/execute/spell', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'x402-payment simulated-auth-test',
      },
      body: JSON.stringify({ spellAddress: '0x900c952c676595DdB392FA6349aD5f0674a67Eeb' }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.paymentSettled).toBe(true)
    expect(body.feeUsdc).toBe(0.05)
    expect(body.executionId).toMatch(/^kh-exec-/)
    expect(body.txHash).toBeDefined()
    expect(body.paymentTxHash).toMatch(/^0x402b/)
  })

  it('POST /execute/spell accepts x-payment-signature as valid authorization', async () => {
    const res = await app.request('/execute/spell', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-payment-signature': '0xsignature1234567890abcdef',
      },
      body: JSON.stringify({ spellAddress: '0x900c952c676595DdB392FA6349aD5f0674a67Eeb' }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.paymentSettled).toBe(true)
  })

  it('POST /execute/custom-action without payment returns 402 challenge', async () => {
    const res = await app.request('/execute/custom-action', {
      method: 'POST',
    })
    expect(res.status).toBe(402)
    const body = await res.json()
    expect(body.error).toBe('Payment Required')
  })

  it('POST /execute/spell passes through x-payment-mode header', async () => {
    const res = await app.request('/execute/spell', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'x402-payment live-auth-test',
        'x-payment-mode': 'live',
      },
      body: JSON.stringify({ spellAddress: '0x900c952c676595DdB392FA6349aD5f0674a67Eeb' }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.mode).toBe('live')
  })

  it('unknown route returns 404 without 402 challenge', async () => {
    const res = await app.request('/unknown-endpoint')
    expect(res.status).toBe(404)
    expect(res.headers.get('X-402-Required')).toBeNull()
  })

  it('POST /execute/spell settles fee of 0.05 USDC', async () => {
    const res = await app.request('/execute/spell', {
      method: 'POST',
      headers: {
        'Authorization': 'x402-payment valid',
      },
      body: JSON.stringify({ spellAddress: '0xaaaa' }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.feeUsdc).toBe(0.05)
  })
})

