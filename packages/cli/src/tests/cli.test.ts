import { describe, it, expect } from 'vitest'
import { program, detectGovernanceType } from '../index'

describe('@axon/cli', () => {
  it('defines the expected CLI commands', () => {
    const commandNames = program.commands.map((c) => c.name())
    expect(commandNames).toContain('init')
    expect(commandNames).toContain('register')
    expect(commandNames).toContain('status')
    expect(commandNames).toContain('queue')
    expect(commandNames).toContain('history')
    expect(commandNames).toContain('simulate')
  })

  it('detectGovernanceType returns a recognized governance type', async () => {
    const type = await detectGovernanceType('0x0a3f6849f78076aefaDf113F5BED87720274dDC0', 'mainnet')
    expect(['makerdao-spell', 'compound-governor', 'openzeppelin-governor', 'optimistic-timelock']).toContain(type)
  })

  it('detectGovernanceType returns openzeppelin-governor for empty contract', async () => {
    const type = await detectGovernanceType('0x0000000000000000000000000000000000000000', 'mainnet')
    expect(type).toBe('openzeppelin-governor')
  })
})
