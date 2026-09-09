import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'http'
import { AddressInfo } from 'net'
import { getApiBase, meViaApi, signupViaApi } from '../index.js'

describe('axon init remote auth (Phase 10)', () => {
  it('defaults API base to localhost:3000', () => {
    const prev = process.env.AXON_API_BASE_URL
    delete process.env.AXON_API_BASE_URL
    expect(getApiBase()).toBe('http://localhost:3000')
    if (prev !== undefined) process.env.AXON_API_BASE_URL = prev
  })

  it('signupViaApi returns null when the API is unreachable (offline fallback)', async () => {
    const remote = await signupViaApi('http://127.0.0.1:9', {
      orgName: 'Offline Org',
      email: 'off@example.com',
      password: 'password12',
    })
    expect(remote).toBeNull()
  })

  it('meViaApi returns null when the API is unreachable', async () => {
    expect(await meViaApi('http://127.0.0.1:9', 'axon_live_x')).toBeNull()
  })

  describe('against a stub API', () => {
    let server: Server
    let base = ''
    let lastSignupBody: any = null

    beforeAll(async () => {
      server = createServer((req, res) => {
        if (req.url === '/api/auth/signup' && req.method === 'POST') {
          let raw = ''
          req.on('data', (c) => (raw += c))
          req.on('end', () => {
            lastSignupBody = JSON.parse(raw)
            res.writeHead(201, { 'Content-Type': 'application/json' })
            res.end(
              JSON.stringify({ apiKey: 'axon_live_stub123', orgId: 'org_stub', orgName: 'Stub Org' })
            )
          })
          return
        }
        if (req.url === '/api/auth/me') {
          const ok = req.headers.authorization === 'Bearer axon_live_stub123'
          res.writeHead(ok ? 200 : 401, { 'Content-Type': 'application/json' })
          res.end(
            JSON.stringify(
              ok
                ? { orgId: 'org_stub', orgName: 'Stub Org', email: 'a@b.xyz' }
                : { error: 'Unauthorized' }
            )
          )
          return
        }
        res.writeHead(404)
        res.end()
      })
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    })

    afterAll(async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      )
    })

    it('signupViaApi posts the workspace payload and returns the key', async () => {
      const remote = await signupViaApi(base, {
        orgName: 'Stub Org',
        email: 'a@b.xyz',
        password: 'password12',
        governanceContract: '0x0a3f6849f78076aefaDf113F5BED87720274dDC0',
        network: 'mainnet',
      })
      expect(remote?.apiKey).toBe('axon_live_stub123')
      expect(lastSignupBody.governanceContract).toBe(
        '0x0a3f6849f78076aefaDf113F5BED87720274dDC0'
      )
      expect(lastSignupBody.network).toBe('mainnet')
    })

    it('meViaApi validates a good key and rejects a bad one', async () => {
      const good = await meViaApi(base, 'axon_live_stub123')
      expect(good?.orgName).toBe('Stub Org')
      expect(await meViaApi(base, 'axon_live_wrong')).toBeNull()
    })
  })
})
