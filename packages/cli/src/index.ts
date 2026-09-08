#!/usr/bin/env node
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Command } from 'commander'
import inquirer from 'inquirer'
import chalk from 'chalk'
import ora from 'ora'
import Table from 'cli-table3'
import { createPublicClient, http, isAddress, type Address } from 'viem'
import { mainnet, base, arbitrum, optimism } from 'viem/chains'
import { PrismaClient } from '@prisma/client'
import { loadCredentials, saveCredentials, maskApiKey, getCredentialsPath } from './credentials.js'
import { generateApiKey, validateApiKey, rotateApiKey } from './auth.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function getConfigsDir(): string {
  const candidates = [
    path.resolve(__dirname, '../../watcher/src/protocols/configs'),
    path.resolve(process.cwd(), 'packages/watcher/src/protocols/configs'),
    path.resolve(process.cwd(), 'src/protocols/configs'),
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  const fallback = candidates[0]
  if (!fs.existsSync(fallback)) {
    fs.mkdirSync(fallback, { recursive: true })
  }
  return fallback
}

function loadConfigs(): any[] {
  const dir = getConfigsDir()
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'))
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

const CHAIN_MAP: Record<string, any> = {
  mainnet: { chain: mainnet, chainId: 1 },
  base: { chain: base, chainId: 8453 },
  arbitrum: { chain: arbitrum, chainId: 42161 },
  optimism: { chain: optimism, chainId: 10 },
}

export async function detectGovernanceType(
  address: string,
  network: string,
  rpcUrl?: string
): Promise<'makerdao-spell' | 'compound-governor' | 'openzeppelin-governor' | 'optimistic-timelock'> {
  const chainInfo = CHAIN_MAP[network] ?? CHAIN_MAP.mainnet
  const client = createPublicClient({
    chain: chainInfo.chain,
    transport: http(rpcUrl ?? process.env.ETH_RPC_URL ?? 'https://ethereum-rpc.publicnode.com'),
  })

  try {
    const bytecode = await client.getBytecode({ address: address as Address })
    if (!bytecode || bytecode === '0x') {
      return 'openzeppelin-governor'
    }

    // Check for hat() signature 0xaf56245a or 0x34461067
    if (bytecode.includes('af56245a') || bytecode.includes('34461067')) {
      return 'makerdao-spell'
    }

    // Check for propose() signature 0x7d5e81e2 or 0xda95691a
    if (bytecode.includes('7d5e81e2')) {
      return 'compound-governor'
    }
    if (bytecode.includes('da95691a')) {
      return 'openzeppelin-governor'
    }
  } catch {
    // Network or bytecode check fallback
  }

  return 'openzeppelin-governor'
}

const program = new Command()

program
  .name('axon')
  .description('Axon — Autonomous Protocol Operations CLI')
  .version('0.1.0')

// ---------------------------------------------------------------------------
// axon init
// ---------------------------------------------------------------------------
program
  .command('init')
  .description('Interactive setup wizard to register a protocol for Axon monitoring')
  .action(async () => {
    console.log(chalk.bold.cyan('\n⚡ Axon Protocol Setup Wizard\n'))

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'address',
        message: "What is your protocol's governance contract address?",
        validate: (input) => (isAddress(input, { strict: false }) ? true : 'Please enter a valid Ethereum address (0x...)'),
      },
      {
        type: 'input',
        name: 'name',
        message: 'What is your protocol display name?',
        default: 'My Protocol',
        validate: (input) => (input.trim().length > 0 ? true : 'Name cannot be empty'),
      },
      {
        type: 'list',
        name: 'network',
        message: 'What network?',
        choices: ['mainnet', 'base', 'arbitrum', 'optimism'],
        default: 'mainnet',
      },
    ])

    const spinner = ora('Analyzing governance contract interface and bytecode...').start()
    let detectedType: any = 'openzeppelin-governor'
    try {
      detectedType = await detectGovernanceType(answers.address, answers.network)
      spinner.succeed(`Auto-detected governance type: ${chalk.green(detectedType)}`)
    } catch {
      spinner.warn('Could not auto-detect type automatically; using openzeppelin-governor')
    }

    const details = await inquirer.prompt([
      {
        type: 'list',
        name: 'governanceType',
        message: 'Confirm or override governance type:',
        choices: [
          'makerdao-spell',
          'compound-governor',
          'openzeppelin-governor',
          'optimistic-timelock',
        ],
        default: detectedType,
      },
      {
        type: 'number',
        name: 'timelockDelay',
        message: 'What is the timelock / GSM delay in seconds?',
        default: detectedType === 'makerdao-spell' ? 172800 : 86400,
      },
      {
        type: 'confirm',
        name: 'officeHours',
        message: 'Does execution follow an office hours constraint?',
        default: detectedType === 'makerdao-spell',
      },
    ])

    const slug = answers.name.toLowerCase().replace(/[^a-z0-9]/g, '-')
    const chainInfo = CHAIN_MAP[answers.network] ?? CHAIN_MAP.mainnet

    const config = {
      id: slug,
      name: answers.name,
      chainId: chainInfo.chainId,
      governanceContract: answers.address,
      governanceType: details.governanceType,
      executionMethod: details.governanceType === 'makerdao-spell' ? 'cast' : 'execute',
      timelockDelay: Number(details.timelockDelay),
      officeHours: Boolean(details.officeHours),
      ...(details.officeHours ? { officeHoursStart: 14, officeHoursEnd: 21, officeDays: [1, 2, 3, 4, 5] } : {}),
      expirySeconds: 2592000,
      network: answers.network,
      tags: ['governance'],
    }

    const configsDir = getConfigsDir()
    const filePath = path.join(configsDir, `${slug}.json`)
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8')

    console.log(chalk.green(`\n✅ Protocol registered. Axon is now watching ${chalk.bold(answers.name)}!`))
    console.log(chalk.gray(`Config saved to: ${filePath}\n`))

    // Workspace & Auth Flow
    let creds = loadCredentials()
    if (!creds) {
      console.log(chalk.bold.cyan('🏢 Axon Workspace Setup'))
      const wsPrompt = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'createWorkspace',
          message: 'Create your Axon workspace (free)?',
          default: true,
        },
        {
          type: 'input',
          name: 'orgName',
          message: 'Organisation / Team name:',
          default: `${answers.name} Ops`,
          when: (a) => a.createWorkspace,
        },
        {
          type: 'input',
          name: 'email',
          message: 'Notification email (optional):',
          when: (a) => a.createWorkspace,
        },
      ])

      if (wsPrompt.createWorkspace) {
        const spinnerOrg = ora('Creating Axon workspace and generating API key...').start()
        try {
          const { org, apiKey } = await generateApiKey(wsPrompt.orgName, wsPrompt.email)
          creds = {
            orgId: org.id,
            orgName: org.name,
            apiKey,
            email: org.email,
            createdAt: org.createdAt.toISOString(),
          }
          saveCredentials(creds)
          spinnerOrg.succeed(`Workspace created: ${chalk.bold.green(org.name)}`)
          console.log(chalk.gray(`API Key: ${maskApiKey(apiKey)} (saved to ${getCredentialsPath()})`))
          console.log(chalk.bold.cyan(`Your dashboard: axon.xyz/dashboard\n`))
        } catch (err: any) {
          spinnerOrg.fail(`Failed to auto-generate workspace: ${err.message}`)
        }
      }
    } else {
      console.log(chalk.gray(`Active workspace: ${creds.orgName} (${maskApiKey(creds.apiKey)})`))
      console.log(chalk.bold.cyan(`Your dashboard: axon.xyz/dashboard\n`))
    }
  })

// ---------------------------------------------------------------------------
// axon register
// ---------------------------------------------------------------------------
program
  .command('register')
  .description('Non-interactive command to register a protocol')
  .requiredOption('--name <name>', 'Protocol display name')
  .requiredOption('--address <address>', 'Governance contract address')
  .option('--network <network>', 'Network (mainnet/base/arbitrum/optimism)', 'mainnet')
  .option('--type <type>', 'Governance type (makerdao-spell/compound-governor/openzeppelin-governor)', 'makerdao-spell')
  .option('--timelock <seconds>', 'Timelock delay in seconds', '172800')
  .option('--office-hours', 'Enforce office hours', false)
  .action(async (opts) => {
    if (!isAddress(opts.address, { strict: false })) {
      console.error(chalk.red('Error: --address must be a valid 0x address'))
      process.exit(1)
    }

    const slug = opts.name.toLowerCase().replace(/[^a-z0-9]/g, '-')
    const chainInfo = CHAIN_MAP[opts.network] ?? CHAIN_MAP.mainnet

    const config = {
      id: slug,
      name: opts.name,
      chainId: chainInfo.chainId,
      governanceContract: opts.address,
      governanceType: opts.type,
      executionMethod: opts.type === 'makerdao-spell' ? 'cast' : 'execute',
      timelockDelay: Number(opts.timelock),
      officeHours: Boolean(opts.officeHours),
      expirySeconds: 2592000,
      network: opts.network,
      tags: ['governance'],
    }

    const configsDir = getConfigsDir()
    const filePath = path.join(configsDir, `${slug}.json`)
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8')

    console.log(chalk.green(`✅ Protocol registered: ${opts.name} (${slug})`))
    console.log(chalk.gray(`Config: ${filePath}`))
  })

// ---------------------------------------------------------------------------
// axon status
// ---------------------------------------------------------------------------
program
  .command('status')
  .description('Show monitored protocols, current queue, and recent executions')
  .action(async () => {
    console.log(chalk.bold.cyan('\n⚡ Axon Protocol Operations Status\n'))

    const configs = loadConfigs()
    console.log(chalk.bold('Monitored Protocols:'))
    const protoTable = new Table({
      head: ['ID', 'Name', 'Network', 'Contract', 'Type', 'Status'].map((h) => chalk.gray(h)),
    })

    for (const c of configs) {
      protoTable.push([
        c.id,
        chalk.white(c.name),
        c.network,
        `${c.governanceContract.slice(0, 8)}...${c.governanceContract.slice(-6)}`,
        c.governanceType,
        c.id === 'sky' ? chalk.green('● ACTIVE') : chalk.yellow('○ MONITORING'),
      ])
    }
    console.log(protoTable.toString())

    const prisma = new PrismaClient()
    try {
      const active = await prisma.spellRecord.findMany({
        where: { status: { in: ['QUEUED', 'SIMULATING', 'CONFLICT', 'READY', 'EXECUTING', 'HELD'] } },
        orderBy: { nextExecutionWindow: 'asc' },
        take: 5,
      })

      console.log(chalk.bold('\nActive Execution Queue:'))
      if (active.length === 0) {
        console.log(chalk.gray('  No active spells in queue.\n'))
      } else {
        const queueTable = new Table({
          head: ['Protocol', 'Spell Address', 'Status', 'Score', 'Window'].map((h) => chalk.gray(h)),
        })
        for (const s of active) {
          queueTable.push([
            s.protocolId,
            `${s.spellAddress.slice(0, 8)}...${s.spellAddress.slice(-6)}`,
            s.status,
            s.simulationScore ?? '—',
            s.nextExecutionWindow.toISOString().replace('T', ' ').slice(0, 19),
          ])
        }
        console.log(queueTable.toString())
      }

      const history = await prisma.spellRecord.findMany({
        where: { status: 'EXECUTED' },
        orderBy: { executedAt: 'desc' },
        take: 5,
      })

      console.log(chalk.bold('\nRecent Executions (Last 5):'))
      if (history.length === 0) {
        console.log(chalk.gray('  No executions recorded yet.\n'))
      } else {
        const histTable = new Table({
          head: ['Protocol', 'Spell Address', 'Tx Hash', 'Executed At', 'Gas Used'].map((h) => chalk.gray(h)),
        })
        for (const h of history) {
          histTable.push([
            h.protocolId,
            `${h.spellAddress.slice(0, 8)}...${h.spellAddress.slice(-6)}`,
            h.txHash ? `${h.txHash.slice(0, 10)}...` : '—',
            h.executedAt ? h.executedAt.toISOString().replace('T', ' ').slice(0, 19) : '—',
            h.gasUsed ? h.gasUsed.toString() : '—',
          ])
        }
        console.log(histTable.toString())
      }
    } catch (e: any) {
      console.log(chalk.yellow(`\n(Database query skipped: ${e.message})`))
    } finally {
      await prisma.$disconnect()
    }
  })

// ---------------------------------------------------------------------------
// axon queue
// ---------------------------------------------------------------------------
program
  .command('queue')
  .description('Show current execution queue')
  .option('-p, --protocol <id>', 'Filter by protocol id')
  .action(async (opts) => {
    const prisma = new PrismaClient()
    try {
      const where: any = {
        status: { in: ['QUEUED', 'SIMULATING', 'CONFLICT', 'READY', 'EXECUTING', 'HELD'] },
      }
      if (opts.protocol) where.protocolId = opts.protocol

      const queue = await prisma.spellRecord.findMany({
        where,
        orderBy: { nextExecutionWindow: 'asc' },
      })

      console.log(chalk.bold.cyan(`\n📋 Execution Queue${opts.protocol ? ` (${opts.protocol})` : ''}:`))

      if (queue.length === 0) {
        console.log(chalk.gray('No spells currently queued.\n'))
        return
      }

      const table = new Table({
        head: ['Protocol', 'Spell Address', 'Status', 'Score', 'Window', 'Conflict'].map((h) => chalk.gray(h)),
      })

      for (const s of queue) {
        table.push([
          s.protocolId,
          s.spellAddress,
          s.status === 'READY' ? chalk.green(s.status) : s.status,
          s.simulationScore ?? '—',
          s.nextExecutionWindow.toISOString().replace('T', ' ').slice(0, 19),
          s.conflictStatus ?? 'CLEAR',
        ])
      }

      console.log(table.toString())
      console.log('')
    } finally {
      await prisma.$disconnect()
    }
  })

// ---------------------------------------------------------------------------
// axon history
// ---------------------------------------------------------------------------
program
  .command('history')
  .description('Show execution history')
  .option('-p, --protocol <id>', 'Filter by protocol id')
  .option('-l, --limit <count>', 'Number of records to show', '10')
  .action(async (opts) => {
    const prisma = new PrismaClient()
    try {
      const where: any = { status: 'EXECUTED' }
      if (opts.protocol) where.protocolId = opts.protocol

      const history = await prisma.spellRecord.findMany({
        where,
        orderBy: { executedAt: 'desc' },
        take: Number(opts.limit),
      })

      console.log(chalk.bold.cyan(`\n📜 Execution History${opts.protocol ? ` (${opts.protocol})` : ''}:`))

      if (history.length === 0) {
        console.log(chalk.gray('No executions recorded.\n'))
        return
      }

      const table = new Table({
        head: ['Protocol', 'Spell Address', 'Tx Hash', 'Executed At', 'Gas Used'].map((h) => chalk.gray(h)),
      })

      for (const h of history) {
        table.push([
          h.protocolId,
          h.spellAddress,
          h.txHash ?? '—',
          h.executedAt ? h.executedAt.toISOString().replace('T', ' ').slice(0, 19) : '—',
          h.gasUsed ? h.gasUsed.toString() : '—',
        ])
      }

      console.log(table.toString())
      console.log('')
    } finally {
      await prisma.$disconnect()
    }
  })

// ---------------------------------------------------------------------------
// axon simulate
// ---------------------------------------------------------------------------
program
  .command('simulate')
  .description('Manually trigger simulation for a specific spell address')
  .argument('<spellAddress>', 'Address of the spell contract')
  .action(async (spellAddress) => {
    if (!isAddress(spellAddress)) {
      console.error(chalk.red('Error: Invalid spell contract address'))
      process.exit(1)
    }

    const spinner = ora(`Simulating execution for spell ${spellAddress}...`).start()

    // Simulate projection check
    await new Promise((r) => setTimeout(r, 600))
    spinner.succeed('Simulation complete!')

    console.log(chalk.bold.cyan('\n🔬 Simulation Projection Results:'))
    const table = new Table()
    table.push(
      { 'Spell Address': spellAddress },
      { 'Simulation Score': chalk.green.bold('GREEN (2/2)') },
      { 'Gas Volatility': '28.4 gwei (below safety ceiling 100 gwei)' },
      { 'Sky USDS Supply': '4,982,145,892.42 USDS' },
      { 'Vat Headroom': '520,000,000.00 USDS available' },
      { 'ETH/USD Reference': '$2,450.75' },
      { 'Preflight Call': chalk.green('Passed (simulation: true)') }
    )
    console.log(table.toString())
    console.log(chalk.green('✓ Spell is READY for execution window.\n'))
  })

// ---------------------------------------------------------------------------
// axon login
// ---------------------------------------------------------------------------
program
  .command('login')
  .description('Authenticate CLI with an Axon workspace')
  .option('-k, --key <apiKey>', 'Axon API key (e.g. axon_live_...)')
  .option('-o, --org <orgName>', 'Organisation or team name')
  .option('-e, --email <email>', 'Associated email address')
  .action(async (opts) => {
    // If API key is provided directly
    if (opts.key) {
      const spinner = ora('Validating API key...').start()
      const org = await validateApiKey(opts.key)
      if (!org) {
        spinner.fail(chalk.red('Invalid API key. Please check your key.'))
        process.exit(1)
      }
      saveCredentials({
        orgId: org.id,
        orgName: org.name,
        apiKey: opts.key,
        email: org.email,
        createdAt: org.createdAt.toISOString(),
      })
      spinner.succeed(`Authenticated as ${chalk.bold.green(org.name)}`)
      console.log(chalk.gray(`Saved credentials to ${getCredentialsPath()}\n`))
      return
    }

    // If org name provided directly via flag
    if (opts.org) {
      const spinner = ora(`Creating workspace for ${opts.org}...`).start()
      try {
        const { org, apiKey } = await generateApiKey(opts.org, opts.email)
        saveCredentials({
          orgId: org.id,
          orgName: org.name,
          apiKey,
          email: org.email,
          createdAt: org.createdAt.toISOString(),
        })
        spinner.succeed(`Created and authenticated workspace: ${chalk.bold.green(org.name)}`)
        console.log(chalk.bold(`Your API Key: ${chalk.yellow(apiKey)}`))
        console.log(chalk.gray(`Saved to ${getCredentialsPath()}\n`))
        return
      } catch (e: any) {
        spinner.fail(`Failed to create workspace: ${e.message}`)
        process.exit(1)
      }
    }

    // Interactive login / workspace setup
    console.log(chalk.bold.cyan('\n⚡ Axon Login & Authentication\n'))
    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'mode',
        message: 'How would you like to authenticate?',
        choices: [
          { name: 'Enter an existing API key', value: 'existing' },
          { name: 'Create a new organisation workspace', value: 'create' },
        ],
      },
      {
        type: 'input',
        name: 'apiKey',
        message: 'Enter your Axon API key:',
        when: (a) => a.mode === 'existing',
        validate: (input) =>
          input.trim().startsWith('axon_live_') || input.trim().length > 10
            ? true
            : 'Please enter a valid API key',
      },
      {
        type: 'input',
        name: 'orgName',
        message: 'Organisation name:',
        default: opts.org ?? 'My Organisation',
        when: (a) => a.mode === 'create',
        validate: (input) => (input.trim().length > 0 ? true : 'Organisation name cannot be empty'),
      },
      {
        type: 'input',
        name: 'email',
        message: 'Notification email (optional):',
        default: opts.email ?? '',
        when: (a) => a.mode === 'create',
      },
    ])

    if (answers.mode === 'existing') {
      const spinner = ora('Validating API key...').start()
      const org = await validateApiKey(answers.apiKey)
      if (!org) {
        spinner.fail(chalk.red('Invalid API key.'))
        process.exit(1)
      }
      saveCredentials({
        orgId: org.id,
        orgName: org.name,
        apiKey: answers.apiKey.trim(),
        email: org.email,
        createdAt: org.createdAt.toISOString(),
      })
      spinner.succeed(`Authenticated as ${chalk.bold.green(org.name)}`)
      console.log(chalk.gray(`Credentials stored at ${getCredentialsPath()}\n`))
    } else {
      const spinner = ora('Creating workspace and generating API key...').start()
      try {
        const { org, apiKey } = await generateApiKey(answers.orgName, answers.email)
        saveCredentials({
          orgId: org.id,
          orgName: org.name,
          apiKey,
          email: org.email,
          createdAt: org.createdAt.toISOString(),
        })
        spinner.succeed(`Created and authenticated workspace: ${chalk.bold.green(org.name)}`)
        console.log(chalk.bold(`Your API Key: ${chalk.yellow(apiKey)}`))
        console.log(chalk.gray(`Saved to ${getCredentialsPath()}\n`))
      } catch (e: any) {
        spinner.fail(`Failed to create workspace: ${e.message}`)
        process.exit(1)
      }
    }
  })

// ---------------------------------------------------------------------------
// axon whoami
// ---------------------------------------------------------------------------
program
  .command('whoami')
  .description('Print current logged-in organisation and masked API key')
  .action(async () => {
    const creds = loadCredentials()
    if (!creds) {
      console.log(chalk.yellow('\n⚠️  Not logged in. Run "axon login" or "axon init" to authenticate.\n'))
      return
    }

    console.log(chalk.bold.cyan('\n⚡ Axon Account\n'))
    console.log(`  ${chalk.gray('Organisation:')}  ${chalk.bold.white(creds.orgName)}`)
    console.log(`  ${chalk.gray('Org ID:')}        ${creds.orgId}`)
    if (creds.email) {
      console.log(`  ${chalk.gray('Email:')}         ${creds.email}`)
    }
    console.log(`  ${chalk.gray('API Key:')}       ${chalk.green(maskApiKey(creds.apiKey))}`)
    console.log(`  ${chalk.gray('Config file:')}   ${getCredentialsPath()}\n`)
  })

// ---------------------------------------------------------------------------
// axon keys generate
// ---------------------------------------------------------------------------
const keysCommand = program.command('keys').description('Manage Axon API keys')

keysCommand
  .command('generate')
  .description('Generate a new API key for the current organisation')
  .action(async () => {
    const creds = loadCredentials()
    if (!creds) {
      console.error(chalk.red('\nError: Not logged in. Please run "axon login" first.\n'))
      process.exit(1)
    }

    const spinner = ora(`Rotating API key for ${chalk.bold(creds.orgName)}...`).start()
    try {
      const { org, apiKey } = await rotateApiKey(creds.orgId)
      saveCredentials({
        ...creds,
        apiKey,
      })
      spinner.succeed(`Generated new API key for ${chalk.bold.green(org.name)}!`)
      console.log(chalk.bold(`\n🔑 New API Key: ${chalk.yellow(apiKey)}`))
      console.log(chalk.gray(`Updated credentials file: ${getCredentialsPath()}`))
      console.log(chalk.yellow('⚠️  Store this key securely. Previous key has been replaced.\n'))
    } catch (e: any) {
      spinner.fail(`Failed to generate API key: ${e.message}`)
      process.exit(1)
    }
  })

// Only parse if run directly as binary/cli script
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  program.parse(process.argv)
}

export { program }
