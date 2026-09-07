# Axon

**Autonomous Protocol Operations Infrastructure**

Axon is an autonomous governance and protocol operations pipeline designed for decentralized protocols (such as Sky Protocol / MakerDAO). It continuously monitors governance contracts, projects chain state, detects execution conflicts, executes approved spells with reliability guarantees via KeeperHub workflows, and logs immutable execution proofs to an onchain registry on Base.

---

## Architecture Overview

```
+---------------------+
|  GovernanceWatcher  |  polls Chief.hat() every 12s → QUEUED
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
│   ├── watcher/          # Governance Watcher, State Projector, Conflict Detector,
│   │                     # Execution Engine, Registry Writer, Webhook Server
│   ├── contracts/        # AxonRegistry.sol, Foundry tests, Deploy script
│   └── shared/           # Shared types, ABIs, protocol addresses, and constants
├── apps/
│   └── dashboard/        # Next.js frontend (scaffold, Phase 6)
├── deploy-registry.ps1   # Base Sepolia / Base mainnet deployment script
├── package.json          # npm workspaces root
└── .env.example          # Environment variables template
```

---

## Pipeline Phases

- **Phase 0 — Foundations:** Monorepo configuration, npm workspaces, Prisma schema on PostgreSQL, viem integration.
- **Phase 1 — Governance Watcher:** Continuous polling of `Chief.hat()`, multi-call spell parameter extraction, office-hours calculator, and Postgres persistence.
- **Phase 2 — State Projector:** 10-block gas volatility projections, Sky USDS supply, Sky Vat debt ceiling headroom, Chainlink ETH/USD risk assessment, simulation scoring (GREEN / YELLOW / RED).
- **Phase 3 — Conflict Detector:** Comprehensive collision analysis checking parameter overlap, ordering dependencies, and 2-hour race conditions against active and past (7-day) spells.
- **Phase 4 — KeeperHub Execution Engine:** Autonomous execution lifecycle including hat guard verification, fresh pre-flight simulation, 7-node KeeperHub workflow execution, phased confirmation backoff (up to 30 min), retry-once logic, Discord notifications, and marketplace listing.
- **Phase 5 — Onchain Registry:** Immutable append-only `AxonRegistry.sol` deployed on Base Sepolia (`0xBf4bc8ACCbd771AeFC68de80a4ED3fa5442DD70B`), native Node.js webhook server, and Viem `RegistryWriter`.

---

## Testing

Axon maintains a comprehensive test suite across Solidity and TypeScript:

```bash
# Run watcher & pipeline unit tests (66 tests)
npm --workspace=packages/watcher run test -- --run

# Run smart contract Foundry tests & fuzzing (12 tests)
cd packages/contracts
forge test -vv
```

Total: **78 tests passing**.

---

## Deployed Contracts

| Network | Contract | Address |
|---|---|---|
| **Base Sepolia** | `AxonRegistry` | [`0xBf4bc8ACCbd771AeFC68de80a4ED3fa5442DD70B`](https://sepolia.basescan.org/address/0xBf4bc8ACCbd771AeFC68de80a4ED3fa5442DD70B) |

---

## License

MIT
