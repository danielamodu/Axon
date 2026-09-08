import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export interface AxonCredentials {
  orgId: string
  orgName: string
  apiKey: string
  email?: string | null
  createdAt?: string
}

export function getCredentialsDir(): string {
  const dir = path.join(os.homedir(), '.axon')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

export function getCredentialsPath(): string {
  return path.join(getCredentialsDir(), 'credentials.json')
}

export function loadCredentials(customPath?: string): AxonCredentials | null {
  const filePath = customPath ?? getCredentialsPath()
  if (!fs.existsSync(filePath)) return null
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(raw) as AxonCredentials
  } catch {
    return null
  }
}

export function saveCredentials(creds: AxonCredentials, customPath?: string): void {
  const filePath = customPath ?? getCredentialsPath()
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(filePath, JSON.stringify(creds, null, 2), 'utf-8')
}

export function clearCredentials(customPath?: string): void {
  const filePath = customPath ?? getCredentialsPath()
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
  }
}

export function maskApiKey(key: string): string {
  if (!key || key.length < 8) return '****'
  const prefix = key.slice(0, 10)
  const suffix = key.slice(-4)
  return `${prefix}...${suffix}`
}
