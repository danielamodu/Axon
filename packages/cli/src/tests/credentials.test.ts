import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  loadCredentials,
  saveCredentials,
  clearCredentials,
  maskApiKey,
  type AxonCredentials,
} from '../credentials.js'

describe('CLI Credentials Manager', () => {
  let tempFile: string

  beforeEach(() => {
    tempFile = path.join(os.tmpdir(), `axon-test-creds-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
  })

  afterEach(() => {
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile)
    }
  })

  it('returns null when credentials file does not exist', () => {
    expect(loadCredentials(tempFile)).toBeNull()
  })

  it('saves and loads credentials correctly', () => {
    const creds: AxonCredentials = {
      orgId: 'org_test_123',
      orgName: 'Maker Ops',
      apiKey: 'axon_live_abcdef1234567890abcdef1234567890',
      email: 'ops@maker.test',
      createdAt: new Date().toISOString(),
    }

    saveCredentials(creds, tempFile)
    expect(fs.existsSync(tempFile)).toBe(true)

    const loaded = loadCredentials(tempFile)
    expect(loaded).toEqual(creds)
  })

  it('clears credentials', () => {
    const creds: AxonCredentials = {
      orgId: 'org_test_clear',
      orgName: 'Clear Ops',
      apiKey: 'axon_live_xyz9876543210',
    }

    saveCredentials(creds, tempFile)
    expect(loadCredentials(tempFile)).not.toBeNull()

    clearCredentials(tempFile)
    expect(loadCredentials(tempFile)).toBeNull()
  })

  it('masks API keys securely', () => {
    expect(maskApiKey('axon_live_abcdef12345678904a9f')).toBe('axon_live_...4a9f')
    expect(maskApiKey('short')).toBe('****')
    expect(maskApiKey('')).toBe('****')
  })
})
