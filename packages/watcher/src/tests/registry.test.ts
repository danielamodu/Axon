import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RegistryWriter } from '../registry-writer'
import { WebhookServer } from '../webhook-server'

// ---------------------------------------------------------------------------
// RegistryWriter tests
// ---------------------------------------------------------------------------

describe('RegistryWriter', () => {
  describe('constructor / isConfigured', () => {
    it('is NOT configured when no env vars are set', () => {
      // Clear relevant env vars for this test
      const origPrivKey = process.env.BASE_REGISTRY_PRIVATE_KEY
      const origRpc = process.env.BASE_RPC_URL
      const origAddr = process.env.AXON_REGISTRY_ADDRESS
      delete process.env.BASE_REGISTRY_PRIVATE_KEY
      delete process.env.BASE_RPC_URL
      delete process.env.AXON_REGISTRY_ADDRESS

      const writer = new RegistryWriter(undefined, undefined, undefined)
      expect(writer.isConfigured).toBe(false)

      process.env.BASE_REGISTRY_PRIVATE_KEY = origPrivKey
      process.env.BASE_RPC_URL = origRpc
      process.env.AXON_REGISTRY_ADDRESS = origAddr
    })

    it('is NOT configured when registry address is invalid', () => {
      const writer = new RegistryWriter(
        '0x' + 'aa'.repeat(32),
        'https://sepolia.base.org',
        'not-an-address'
      )
      expect(writer.isConfigured).toBe(false)
    })

    it('returns null from log() when not configured', async () => {
      const writer = new RegistryWriter(undefined, undefined, undefined)
      const result = await writer.log({
        protocol:        '0x0000000000000000000000000000000000000001',
        spellAddress:    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        actionType:      'GOVERNANCE_CAST',
        txHash:          '0xaabbccdd',
        executedAt:      new Date(),
        gasUsed:         150000n,
        executor:        '0x0000000000000000000000000000000000000002',
        simulationScore: 2,
      })
      expect(result).toBeNull()
    })
  })

  describe('hexToBytes32', () => {
    it('pads a short hex to 64 chars', () => {
      const writer = new RegistryWriter()
      const result = writer.hexToBytes32('0xabcd')
      expect(result).toBe('0x' + 'abcd' + '0'.repeat(60))
    })

    it('truncates a hex longer than 64 chars', () => {
      const writer = new RegistryWriter()
      const long = '0x' + 'aa'.repeat(35)  // 70 hex chars
      const result = writer.hexToBytes32(long)
      expect(result.length).toBe(66) // 0x + 64 chars
    })

    it('handles a 32-byte hash (64 hex chars) unchanged', () => {
      const writer = new RegistryWriter()
      const hash = '0x' + 'ab'.repeat(32)
      const result = writer.hexToBytes32(hash)
      expect(result).toBe(hash)
    })

    it('strips 0x prefix before padding', () => {
      const writer = new RegistryWriter()
      const result = writer.hexToBytes32('1234')
      expect(result).toBe('0x' + '1234' + '0'.repeat(60))
    })
  })

  describe('stringToBytes32', () => {
    it('encodes a short string padded to 32 bytes', () => {
      const writer = new RegistryWriter()
      const result = writer.stringToBytes32('GOVERNANCE_CAST')
      expect(result).toHaveLength(66) // 0x + 64 hex chars
      expect(result.startsWith('0x')).toBe(true)
      // Verify the encoded string starts with the correct bytes
      const text = Buffer.from(result.slice(2), 'hex').toString('utf8').replace(/\0+$/, '')
      expect(text).toBe('GOVERNANCE_CAST')
    })

    it('truncates strings longer than 32 bytes', () => {
      const writer = new RegistryWriter()
      const longStr = 'A'.repeat(50)
      const result = writer.stringToBytes32(longStr)
      expect(result).toHaveLength(66)
    })

    it('produces a 0x-prefixed hex string of exactly 66 chars', () => {
      const writer = new RegistryWriter()
      expect(writer.stringToBytes32('hello').length).toBe(66)
      expect(writer.stringToBytes32('').length).toBe(66)
    })
  })
})

// ---------------------------------------------------------------------------
// WebhookServer tests
// ---------------------------------------------------------------------------

describe('WebhookServer', () => {
  let server: WebhookServer
  let mockWriter: RegistryWriter
  const TEST_PORT = 13001

  beforeEach(() => {
    mockWriter = {
      isConfigured: false,
      log: vi.fn().mockResolvedValue(null),
    } as unknown as RegistryWriter

    server = new WebhookServer(mockWriter, TEST_PORT)
  })

  afterEach(async () => {
    await server.stop().catch(() => {})
  })

  it('starts and responds to GET /health with 200', async () => {
    await server.start()

    const res = await fetch(`http://localhost:${TEST_PORT}/health`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.service).toBe('axon-webhook')
  })

  it('returns 404 for unknown routes', async () => {
    await server.start()

    const res = await fetch(`http://localhost:${TEST_PORT}/unknown`)
    expect(res.status).toBe(404)
  })

  it('returns 400 when POST /webhook/execution body is missing spellAddress', async () => {
    await server.start()

    const res = await fetch(`http://localhost:${TEST_PORT}/webhook/execution`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txHash: '0xabc' }),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/spellAddress/)
  })

  it('returns 400 when POST /webhook/execution body is missing txHash', async () => {
    await server.start()

    const res = await fetch(`http://localhost:${TEST_PORT}/webhook/execution`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spellAddress: '0xaaa' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid JSON', async () => {
    await server.start()

    const res = await fetch(`http://localhost:${TEST_PORT}/webhook/execution`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })
    expect(res.status).toBe(400)
  })

  it('calls writer.log with correct fields on valid POST /webhook/execution', async () => {
    await server.start()

    const payload = {
      spellAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      txHash: '0x' + 'ab'.repeat(32),
      gasUsed: '150000',
      simulationScore: 'GREEN',
      executedAt: new Date().toISOString(),
    }

    const res = await fetch(`http://localhost:${TEST_PORT}/webhook/execution`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.spellAddress).toBe(payload.spellAddress)

    expect(mockWriter.log).toHaveBeenCalledOnce()
    const call = (mockWriter.log as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.spellAddress).toBe(payload.spellAddress)
    expect(call.txHash).toBe(payload.txHash)
    expect(call.gasUsed).toBe(150000n)
    expect(call.simulationScore).toBe(2) // GREEN → 2
  })

  it('maps RED simulationScore to 0 in registry entry', async () => {
    await server.start()

    await fetch(`http://localhost:${TEST_PORT}/webhook/execution`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spellAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        txHash: '0xdeadbeef',
        simulationScore: 'RED',
      }),
    })

    const call = (mockWriter.log as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.simulationScore).toBe(0)
  })

  it('maps YELLOW simulationScore to 1 in registry entry', async () => {
    await server.start()

    await fetch(`http://localhost:${TEST_PORT}/webhook/execution`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spellAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        txHash: '0xdeadbeef',
        simulationScore: 'YELLOW',
      }),
    })

    const call = (mockWriter.log as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.simulationScore).toBe(1)
  })
})
