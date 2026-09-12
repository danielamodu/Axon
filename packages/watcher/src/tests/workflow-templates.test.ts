import { describe, it, expect, vi } from 'vitest'
import { WorkflowTemplateFactory, templateSpecFor } from '../workflow-templates'
import type { ProtocolConfig } from '../protocols/types'

function configFor(governanceType: ProtocolConfig['governanceType']): ProtocolConfig {
  return {
    id: 'test-proto',
    name: 'Test Protocol',
    chainId: 1,
    governanceContract: '0x0a3f6849f78076aefaDf113F5BED87720274dDC0',
    governanceType,
    executionMethod: 'cast',
    timelockDelay: 172800,
    officeHours: false,
    expirySeconds: 2592000,
    network: 'mainnet',
  }
}

describe('WorkflowTemplateFactory (F4)', () => {
  const types: ProtocolConfig['governanceType'][] = [
    'makerdao-spell',
    'compound-governor',
    'openzeppelin-governor',
    'optimistic-timelock',
  ]

  it.each(types)('generates the guard→simulate→execute→verify shape for %s', (governanceType) => {
    const input = WorkflowTemplateFactory.generateTemplate(configFor(governanceType))
    const ids = input.nodes!.map((n) => n.id)
    for (const id of [
      'trigger', 'read-state', 'check-state', 'simulate-execute', 'check-simulation',
      'notify-failure', 'execute-action', 'verify-state', 'notify-registry', 'notify-success',
    ]) {
      expect(ids).toContain(id)
    }
    expect(input.edges!.length).toBeGreaterThanOrEqual(9)
  })

  it('uses makerdao spell semantics for makerdao-spell', () => {
    const spec = templateSpecFor('makerdao-spell')
    expect(spec.templateName).toBe('axon-makerdao-spell-execution')
    expect(spec.readFunction).toBe('hat')
    expect(spec.executeFunction).toBe('cast')
    const input = WorkflowTemplateFactory.generateTemplate(configFor('makerdao-spell'))
    expect(input.name).toContain('axon-makerdao-spell-execution')
  })

  it('uses proposal state machines for governor types', () => {
    expect(templateSpecFor('compound-governor').expectedState).toContain('4')
    expect(templateSpecFor('compound-governor').executedState).toContain('5')
    expect(templateSpecFor('openzeppelin-governor').expectedState).toContain('5')
    expect(templateSpecFor('openzeppelin-governor').executedState).toContain('7')
    expect(templateSpecFor('optimistic-timelock').readFunction).toBe('isOperationReady')
  })

  it('tags every node with axon: metadata', () => {
    const input = WorkflowTemplateFactory.generateTemplate(configFor('openzeppelin-governor'))
    for (const n of input.nodes!) {
      const tags = (n.data as any)?.tags
      expect(Array.isArray(tags)).toBe(true)
      expect(tags[0].startsWith('axon:')).toBe(true)
    }
    const exec = input.nodes!.find((n) => n.id === 'execute-action')!
    expect((exec.data as any).tags).toEqual(['axon:governance-execution'])
  })

  it('targets the protocol contract on the right chain', () => {
    const cfg = { ...configFor('compound-governor'), chainId: 8453, governanceContract: '0xc0Da02939E1441F497fd74F78cE7Decb17B66529' }
    const input = WorkflowTemplateFactory.generateTemplate(cfg)
    const exec = input.nodes!.find((n) => n.id === 'execute-action')!
    expect((exec.data as any).config.contractAddress).toBe(cfg.governanceContract)
    expect((exec.data as any).config.chainId).toBe('8453')
  })

  it('publishes to KeeperHub and lists on the marketplace', async () => {
    const khClient = {
      createWorkflow: vi.fn().mockResolvedValue({ id: 'wf-tpl-1' }),
      rawRequest: vi.fn().mockResolvedValue({ ok: true }),
    }
    const out = await WorkflowTemplateFactory.publishTemplate(khClient as any, configFor('makerdao-spell'))
    expect(out?.templateId).toBe('wf-tpl-1')
    expect(out?.templateUrl).toBe('https://app.keeperhub.com/workflows/wf-tpl-1')
    expect(khClient.rawRequest).toHaveBeenCalledWith(
      '/workflows/wf-tpl-1/list',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('returns null when KeeperHub is unreachable', async () => {
    const khClient = {
      createWorkflow: vi.fn().mockRejectedValue(new Error('down')),
      rawRequest: vi.fn(),
    }
    const out = await WorkflowTemplateFactory.publishTemplate(khClient as any, configFor('makerdao-spell'))
    expect(out).toBeNull()
  })
})
