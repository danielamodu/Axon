# Axon

Autonomous protocol operations infrastructure.
Governance decisions execute themselves.

Axon is an autonomous governance and protocol operations pipeline designed for decentralized protocols (such as Sky Protocol, Aave, and Compound). It continuously monitors governance contracts, projects chain state, detects execution conflicts, executes approved spells with reliability guarantees via KeeperHub workflows, and logs immutable execution proofs to an onchain registry on Base.

---

## Quick Start

### Install CLI
```bash
# Build & link CLI locally
npm run build:cli
npm install -g ./packages/cli
```

### Register your protocol (auto-detects governance type)
```bash
axon init
```

### Check status
```bash
axon status
```

### View execution queue & history
```bash
axon queue
axon history --limit 10
```

---

## MCP Integration

Add to your `mcp_config.json`:
```json
{
  "mcpServers": {
    "axon": {
      "command": "npx",
      "args": ["tsx", "packages/mcp-server/src/index.ts"],
      "env": {
        "DATABASE_URL": "your-database-url"
      }
    }
  }
}
```

Then ask your AI agent:
- *"What spells are queued on Sky Protocol right now?"*
- *"What's the simulation score for spell 0x900c...?"*
- *"Register Aave governance for monitoring."*
- *"Show me the execution history and reliability stats for Sky."*

---

## Supported Protocols
- **Sky Protocol** (active)
- **Aave** (monitoring)
- **Compound** (monitoring)

---

## Supported Governance Types
- **MakerDAO Spell pattern** (`makerdao-spell`)
- **Compound Governor** (`compound-governor`)
- **OpenZeppelin Governor** (`openzeppelin-governor`)
- **Optimistic Timelock** (`optimistic-timelock`)

---

## Architecture Overview

```
+---------------------+
|  GovernanceWatcher  |  polls governance contract (e.g. Chief.hat()) → QUEUED
+----------+----------+
           │
           ▼
+------------------------+
|    StateProjector      |  every 60s → SIMULATING → READY / HELD
+----------+-------------+  (gas trend, USDS supply, Vat headroom, Chainlink)
           │
           ▼
+------------------------+
|   ConflictDetector     |  every 30s → CLEAR or CONFLICT
+----------+-------------+  (PARAMETER_OVERLAP, ORDERING_DEPENDENCY, RACE_CONDITION)
           │
           ▼
+----------------------------------+
|      ExecutionEngine             |  every 30s → EXECUTING → EXECUTED / FAILED
|  └─ RegistryWriter.log()  ───────┼──→  AxonRegistry on Base (post-execution)
+----------------------------------+
           ▲
           │  POST /webhook/execution
+-------------------------+
|   WebhookServer (:3001) |  KeeperHub node 7 webhook handler
+-------------------------+
```

---

## Project Structure

```
axon/
├── packages/
│   ├── watcher/          # Governance Watcher, Protocol Registry, State Projector,
│   │                     # Conflict Detector, Execution Engine, Registry Writer
│   ├── contracts/        # AxonRegistry.sol on Base, Foundry tests, Deploy script
│   ├── shared/           # Shared types, ABIs, protocol addresses, and constants
│   ├── mcp-server/       # Model Context Protocol (MCP) server for AI agents
│   └── cli/              # One-command CLI (axon init, status, queue, history, simulate)
├── apps/
│   └── dashboard/        # Next.js frontend (scaffold, Phase 6)
├── deploy-registry.ps1   # Base Sepolia / Base mainnet deployment script
├── package.json          # npm workspaces root
└── .env.example          # Environment variables template
```

---

## Testing

Axon maintains a comprehensive test suite across Solidity and TypeScript:

```bash
# Run watcher & pipeline unit tests (79 tests)
npm --workspace=packages/watcher run test -- --run

# Run MCP server tests (3 tests)
npm --workspace=@axon/mcp-server run test -- --run

# Run CLI tests (3 tests)
npm --workspace=@axon/cli run test -- --run

# Run smart contract Foundry tests & fuzzing (12 tests)
cd packages/contracts
forge test -vv
```

Total: **97 tests passing**.

---

## Deployed Contracts

| Network | Contract | Address |
|---|---|---|
| **Base Sepolia** | `AxonRegistry` | [`0xBf4bc8ACCbd771AeFC68de80a4ED3fa5442DD70B`](https://sepolia.basescan.org/address/0xBf4bc8ACCbd771AeFC68de80a4ED3fa5442DD70B) |

---

## License

MIT
