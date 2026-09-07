import 'dotenv/config'
import { GovernanceWatcher } from './watcher'
import { StateProjector } from './projector'
import { ConflictDetector } from './conflict-detector'
import { ExecutionEngine } from './executor'
import { NotificationDispatcher } from './notifications'
import { RegistryWriter } from './registry-writer'
import { WebhookServer } from './webhook-server'
import { logger } from './logger'

const rpcUrl = process.env.ETH_RPC_URL
if (!rpcUrl) throw new Error('ETH_RPC_URL not set')

const watcher = new GovernanceWatcher(rpcUrl)
const projector = new StateProjector(watcher.getClient(), watcher.getPrisma())
const conflictDetector = new ConflictDetector(watcher.getPrisma())
const notify = new NotificationDispatcher()
const registryWriter = new RegistryWriter()
const executor = new ExecutionEngine(watcher.getClient(), watcher.getPrisma(), notify, undefined, registryWriter)
const webhookServer = new WebhookServer(registryWriter)

let shuttingDown = false

async function shutdown() {
  if (shuttingDown) return
  shuttingDown = true

  logger.info('Shutting down services...')
  watcher.stop()
  projector.stop()
  conflictDetector.stop()
  executor.stop()

  // Wait for the current execution to complete before exiting
  logger.info('Waiting for in-flight execution to finish...')
  await executor.drain()

  // Stop webhook server
  await webhookServer.stop().catch(() => {})

  logger.info('All services stopped. Exiting.')
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

Promise.all([
  watcher.start(),
  projector.start(),
  conflictDetector.start(),
  executor.start(),
  webhookServer.start(),
]).catch((err) => {
  logger.error({ err }, 'Fatal error in services')
  process.exit(1)
})
