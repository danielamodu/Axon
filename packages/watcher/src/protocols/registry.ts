import fs from 'node:fs'
import path from 'node:path'
import { ProtocolConfig, ProtocolConfigSchema } from './types'

export class ProtocolRegistry {
  private configs: Map<string, ProtocolConfig> = new Map()

  validate(config: unknown): ProtocolConfig {
    return ProtocolConfigSchema.parse(config)
  }

  register(config: ProtocolConfig): ProtocolConfig {
    const validated = this.validate(config)
    this.configs.set(validated.id, validated)
    return validated
  }

  get(id: string): ProtocolConfig | undefined {
    return this.configs.get(id)
  }

  list(): ProtocolConfig[] {
    return Array.from(this.configs.values())
  }

  loadFromFile(filePath: string): ProtocolConfig {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw)
    return this.register(parsed)
  }

  loadFromDirectory(dirPath: string): ProtocolConfig[] {
    if (!fs.existsSync(dirPath)) {
      return []
    }
    const files = fs.readdirSync(dirPath)
    const loaded: ProtocolConfig[] = []
    for (const file of files) {
      if (file.endsWith('.json')) {
        const fullPath = path.join(dirPath, file)
        try {
          const config = this.loadFromFile(fullPath)
          loaded.push(config)
        } catch (err) {
          // Skip or let caller know
          throw new Error(`Failed to load protocol config from ${file}: ${(err as Error).message}`)
        }
      }
    }
    return loaded
  }

  clear(): void {
    this.configs.clear()
  }
}

// Global default singleton registry
export const protocolRegistry = new ProtocolRegistry()
