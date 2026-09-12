import { describe, it, expect, vi } from 'vitest'
import { KeeperHubScheduler, SCHEDULER_INTERVAL_SECONDS } from '../kh-scheduler'
import type { ProtocolConfig } from '../protocols/types'

const skyConfig: ProtocolConfig = {
  id: 'sky',
  name: 'Sky Protocol',
  chainId: 1,
  governanceContract: '0x0a3f6849f78076aefaDf113F5BED87720274dDC0',
  governanceType: 'makerdao-spell',
  executionMethod: 'cast',
  timelockDelay: 172800,
  officeHours: true,
  expirySeconds: 2592000,
  network: 'mainnet',
}

describe('KeeperHubScheduler (F3)', () => {
  it('builds a 12-second schedule detector workflow', () => {
    const scheduler = new KeeperHubScheduler()
    const input = scheduler.buildDetectorWorkflow(skyConfig, 'http://localhost:3001')

    expect(input.name).toBe('axon-governance-detector-sky')
    expect(input.nodes).toHaveLength(3)
    const trigger = input.nodes!.find((n) => n.id === 'schedule')!
    expect(trigger.type).toBe('trigger')
    expect((trigger.data!.config as any).intervalSeconds).toBe(SCHEDULER_INTERVAL_SECONDS)
    expect(SCHEDULER_INTERVAL_SECONDS).toBe(12)
  })

  it('reads hat() for makerdao spells and posts hat changes to the webhook', () => {
    const scheduler = new KeeperHubScheduler()
    const input = scheduler.buildDetectorWorkflow(skyConfig, 'https://axon.example.com/')

    const read = input.nodes!.find((n) => n.id === 'read-hat')!
    expect((read.data!.config as any).functionName).toBe('hat')
    expect((read.data!.config as any).contractAddress).toBe(skyConfig.governanceContract)

    const report = input.nodes!.find((n) => n.id === 'report-hat')!
    expect((report.data!.config as any).url).toBe('https://axon.example.com/webhook/hat-change')
    const body = JSON.parse((report.data!.config as any).body)
    expect(body.protocolId).toBe('sky')
    expect(body.timelockDelay).toBe(172800)
  })

  it('is a no-op without a KeeperHub key', async () => {
    const scheduler = new KeeperHubScheduler()
    expect(scheduler.isConfigured).toBe(false)
    expect(await scheduler.startScheduler(skyConfig, 'http://localhost:3001')).toBeNull()
  })

  it('creates and tracks one workflow per protocol', async () => {
    const khClient = { createWorkflow: vi.fn().mockResolvedValue({ id: 'wf-sched-sky' }), deleteWorkflow: vi.fn() }
    const scheduler = new KeeperHubScheduler(khClient as any)

    const first = await scheduler.startScheduler(skyConfig, 'http://localhost:3001')
    const second = await scheduler.startScheduler(skyConfig, 'http://localhost:3001')
    expect(first).toBe('wf-sched-sky')
    expect(second).toBe('wf-sched-sky')
    expect(khClient.createWorkflow).toHaveBeenCalledOnce()
    expect(scheduler.workflowIdFor('sky')).toBe('wf-sched-sky')

    await scheduler.stopScheduler('sky')
    expect(khClient.deleteWorkflow).toHaveBeenCalledWith('wf-sched-sky')
    expect(scheduler.workflowIdFor('sky')).toBeUndefined()
  })
})
