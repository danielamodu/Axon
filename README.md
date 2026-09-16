# Axon

Autonomous protocol operations infrastructure. Governance decisions execute themselves.

Axon is an autonomous execution and operations pipeline for decentralized protocols. It monitors onchain governance contracts, projects chain state prior to execution, detects parameter and ordering conflicts between proposals, enforces timelock delays and office-hour safety windows, executes spells via KeeperHub with full preflight simulation, and records immutable execution proofs to an onchain registry on Base.

---

## Key Capabilities

- **Config-Driven Multi-Protocol Support**: Pluggable adapters for MakerDAO/Sky spells, OpenZeppelin Governor, Compound Governor, and Optimistic Timelocks. Add any protocol via a single JSON configuration file.
- **Predictive State Projector**: Pre-computes chain state at the scheduled execution window (ETH gas volatility, debt ceiling headroom, USDS supply, and Chainlink reference feeds) and assigns safety scores (GREEN, YELLOW, RED).
- **Three-Vector Conflict Detector**: Compares queued actions against active and recently executed spells to prevent parameter collisions, ordering dependencies, and execution race conditions.
- **Guaranteed Execution via KeeperHub**: Enforces GSM timelocks, office hours constraints (e.g. Mon-Fri 14:00-21:00 UTC), and execution preflights before broadcasting.
- **Onchain Execution Registry**: Deployed on Base Sepolia (`AxonRegistry.sol`), logging gas used, simulation score, protocol address, spell contract, and transaction hash.
- **Model Context Protocol (MCP) Server**: Provides 7 tools for AI agents (Claude, Cursor, Antigravity) to monitor queues, inspect simulations, review reliability metrics, and register protocols.
- **Unified Developer CLI**: Full-featured `axon` command-line tool with interactive governance detection wizards, queue inspection, manual simulation, and credential management.
- **Multi-Tenant Authentication & Dashboard**: API key authentication (`axon_live_...`) with organization scoping across the database, CLI, MCP server, and Next.js operations console.

---

## Architecture and Execution Pipeline

```
┌─────────────────────────┐
│   Governance Watchers   │  Polls governance contracts (hat(), propose(), etc.)
└────────────┬────────────┘
             │  status: QUEUED
             ▼
┌─────────────────────────┐
│     State Projector     │  Projects gas trend, Vat headroom, stable supply
└────────────┬────────────┘  Runs simulate:true → scores GREEN / YELLOW / RED
             │  status: READY (or HELD)
             ▼
┌─────────────────────────┐
│    Conflict Detector    │  Evaluates parameter overlap, ordering, and race conditions
└────────────┬────────────┘  Outputs conflictStatus: CLEAR or CONFLICT
             │  status: READY, conflictStatus: CLEAR
             ▼
┌─────────────────────────┐
│    Execution Engine     │  Enforces office hours and execution windows
└────────────┬────────────┘  Executes via KeeperHub → status: EXECUTING → EXECUTED
             │
             ├─────────────────────────────────────────┐
             ▼                                         ▼
┌─────────────────────────┐               ┌─────────────────────────┐
│  AxonRegistry on Base   │               │ Notification Dispatcher │
│  (onchain proof log)    │               │ (Discord / Webhooks)    │
└─────────────────────────┘               └─────────────────────────┘
```

### Lifecycle States

| Status | Description |
| :--- | :--- |
| `QUEUED` | Detected by governance watcher; timelock delay countdown initialized. |
| `SIMULATING` | State projection and preflight call currently underway. |
| `READY` | Preflight succeeded and state score is GREEN or YELLOW. Window assigned. |
| `HELD` | Preflight simulation failed or risk thresholds exceeded (RED). Paused. |
| `CONFLICT` | Collides with another queued action or recent execution. Operator alert raised. |
| `EXECUTING` | Handed to KeeperHub executor during valid execution window. |
| `EXECUTED` | Transaction confirmed onchain and recorded to Base AxonRegistry. |
| `FAILED` | Onchain transaction reverted or dropped. Incident alert dispatched. |

---

## Supported Protocols and Governance Architectures

| Protocol | Governance Type | Execution Method | Timelock | Office Hours | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Sky Protocol** | `makerdao-spell` | `cast` | 48 hours | Mon-Fri 14:00-21:00 UTC | ACTIVE |
| **Aave** | `openzeppelin-governor` | `execute` | 24 hours | None | MONITORING |
| **Compound** | `compound-governor` | `queue-execute` | 48 hours | None | MONITORING |

Supported governance types:
- `makerdao-spell`: Executive spell pattern via `hat()` change detection and `cast()`.
- `openzeppelin-governor`: Standard proposal lifecycle (`Propose`, `Queue`, `Execute`).
- `compound-governor`: Timelock-governed proposal lifecycle (`queueTransaction`, `executeTransaction`).
- `optimistic-timelock`: Challenge-window timelocks with veto safeguards.

---

## Quick Start

### 1. Prerequisites

- Node.js 20+
- PostgreSQL database (e.g. Neon serverless Postgres)
- Foundry (optional, for smart contract verification)

### 2. Setup Repository

```bash
git clone https://github.com/danielamodu/Axon.git
cd Axon
npm install
```

Configure your `.env` file:
```bash
cp .env.example .env
```

Ensure the following variables are set in `.env`:
```env
DATABASE_URL="postgresql://user:pass@host/db?sslmode=require"
ETH_RPC_URL="https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY"
BASE_SEPOLIA_RPC="https://sepolia.base.org"
AXON_REGISTRY_ADDRESS="0x2C56618a6A89f04764e1De25A3F9D1C3Bf1471E2"
```

Push the database schema to your PostgreSQL instance:
```bash
npm run db:push
```

---

## Axon CLI

Build and link the command-line interface:
```bash
npm run build:cli
npm install -g ./packages/cli
```

### Interactive Setup Wizard
Initialize a protocol and set up an organization workspace in one command. The wizard inspects the target address bytecode, detects the governance framework, and configures the monitoring parameters:
```bash
axon init
```

### Non-Interactive Registration
```bash
axon register \
  --name "Uniswap Governance" \
  --address 0x1a9C8182C09F50C8318d769245beA52c32BE35BC \
  --network mainnet \
  --type openzeppelin-governor \
  --timelock 172800
```

### Authentication and Key Management
Credentials are encrypted and saved locally to `~/.axon/credentials.json`:
```bash
# Authenticate or create a workspace
axon login

# Check active workspace and masked key
axon whoami

# Rotate organization API key
axon keys generate
```

### Operational Commands
```bash
# View all monitored protocols, active queue, and recent executions
axon status

# Inspect active spells waiting in the execution queue
axon queue

# Filter queue by protocol
axon queue --protocol sky

# View historical executions with gas usage and tx hashes
axon history --limit 20

# Run a dry-run state projection and simulation against a spell address
axon simulate 0xdB1Cd464522A0789E2861611fa429f42B3e6B079
```

---

## Model Context Protocol (MCP) Server

Axon includes a dedicated Model Context Protocol server exposing operations data directly to AI agents.

### MCP Configuration

Add the server to your agent's configuration file (e.g., Claude Desktop, Antigravity, Cursor):

```json
{
  "mcpServers": {
    "axon": {
      "command": "node",
      "args": ["packages/mcp-server/dist/index.js"],
      "env": {
        "DATABASE_URL": "postgresql://...",
        "AXON_API_KEY": "axon_live_your_api_key_here"
      }
    }
  }
}
```

The MCP server runs in stdio mode for local IDE agents and simultaneously starts a secure HTTP gateway on port `3002`.

### Available MCP Tools

1. `get_queue`: Retrieves spells currently in the execution pipeline with status, simulation score, and execution windows. Scoped to the authenticated organization.
2. `get_execution_history`: Returns confirmed protocol executions including transaction hashes, gas consumed, and timestamps.
3. `get_protocol_stats`: Returns reliability percentages, average delay hours beyond earliest execution, and total executions.
4. `get_active_spell`: Returns the current active spell contract and metadata for a specific protocol.
5. `register_protocol`: Dynamically registers and persists a new protocol configuration for monitoring.
6. `get_simulation_state`: Returns projected gas volatility, USDS supply, Vat headroom, and simulation preflight checks.
7. `list_protocols`: Returns all protocols monitored by the authenticated workspace.

---

## Operations Dashboard

Axon includes an operations console built with Next.js App Router in `apps/dashboard`.

### Features
- **Authentication**: Key-based entry storing credentials in secure storage and validating against `/api/auth/verify`.
- **Live Queue Table**: Real-time spell status, simulation score badges, and upcoming execution windows.
- **Execution Log**: Comprehensive ledger with direct transaction links and gas consumption.
- **Zero AI-Slop Design**: Follows strict design guidelines. Clean typography, deliberate spacing, no purple gradients, no extraneous icons, and zero layout shifting.

### Running the Dashboard
```bash
# Build production bundle
npm run build:dashboard

# Start development server on port 3000
npm run dev:dashboard
```

Navigate to `http://localhost:3000` and enter your Axon API key (generated via `axon login` or `axon init`).

---

## Smart Contracts & Base Deployment

The onchain audit log contract is deployed and verified on Base Sepolia.

### Contract Overview

`AxonRegistry.sol` provides an immutable onchain registry of protocol operations:
```solidity
struct ExecutionRecord {
    address protocol;
    address spellAddress;
    bytes32 actionType;
    bytes32 txHash;
    uint256 executedAt;
    uint256 gasUsed;
    address executor;
    uint8 simulationScore; // 0=RED, 1=YELLOW, 2=GREEN
}
```

### Deployed Addresses

| Network | Contract | Address | Explorer |
| :--- | :--- | :--- | :--- |
| **Base Sepolia** | `AxonRegistry` | `0x2C56618a6A89f04764e1De25A3F9D1C3Bf1471E2` | [BaseScan](https://sepolia.basescan.org/address/0x2C56618a6A89f04764e1De25A3F9D1C3Bf1471E2) |

> Reads: `getRecordsByProtocol` is O(matches) via a per-protocol index.
> For dashboards use `getRecordsByProtocolPaginated(protocol, limit, offset)` (newest-first)
> with `getRecordCountByProtocol`.

### Security notes

- API keys are stored hashed (`sha256`, `axon_live_<32hex>`). The plaintext is shown once at
  `generate`/`rotate` time. Pre-hash rows still validate via a legacy fallback — re-rotate to migrate.
- Dry-runs never forge proofs: no `txHash` is faked, `keeperHubStatus` is `'dry-run'`,
  and the registry writer is skipped. Filter `dry-run` rows out of operator history views.
- Conflict timing proximity alone is a `WARNING` (stored in `conflictDetail.warnings`) and never
  blocks `READY`. Only parameter overlap / ordering dependencies set `CONFLICT`.

---

## Test Suite & Verification

Axon maintains test suites across unit, integration, simulation, CLI, MCP, and Foundry contracts.
Run them directly — do not rely on hardcoded counts in docs (they drift):

```bash
# Run watcher & pipeline test suites
npm run test:watcher

# Run MCP server tests
npm run test:mcp

# Run CLI unit & credentials tests
npm run test:cli

# Run everything (watcher + mcp + cli + gateway + dashboard)
npm run test:all

# Run Foundry contract unit & fuzz tests
cd packages/contracts
forge test -vv
```

---

## Monorepo Layout

```
axon/
├── apps/
│   └── dashboard/        # Next.js App Router operations dashboard & API routes
├── packages/
│   ├── contracts/        # AxonRegistry.sol, Foundry tests, deployment scripts
│   ├── shared/           # Protocol ABIs, addresses, and shared interfaces
│   ├── watcher/          # Core pipeline: WatcherManager, StateProjector,
│   │                     # ConflictDetector, ExecutionEngine, RegistryWriter
│   ├── mcp-server/       # Model Context Protocol server (stdio & HTTP :3002)
│   └── cli/              # axon CLI (init, login, whoami, keys, status, queue)
├── package.json          # Root workspace configuration
└── README.md
```

---

## Deployments

The dashboard (API + UI) runs as one container on Railway with autodeploys
from `main`. Push → build (`Dockerfile`) → healthcheck (`/api/health`).
Infra lives in `.railway/railway.ts`; secrets stay in Railway, never in git.

Live: `https://axon-production-d089.up.railway.app`

## License

MIT
