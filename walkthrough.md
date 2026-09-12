# Axon — Phase 9 Walkthrough: KeeperHub Maximum Depth

Phase 9 makes KeeperHub so deeply embedded in Axon that the system cannot
function without it. Six features, all live in this repo.

## Feature 1 — KeeperHub as Blockchain Oracle

`packages/watcher/src/oracle.ts` (`KeeperHubOracle`) routes contract reads
(USDS `totalSupply`, Vat `Line`/`debt`, Chainlink `latestRoundData`) through
KeeperHub's Direct Execution API. viem is strictly a fallback when KeeperHub
is unreachable — `get*WithSource()` methods report which path served each
read, and `StateProjector.oracleMode` is `'keeperhub'` only when the whole
batch came via KeeperHub (persisted per-spell in `conflictDetail.oracleMode`,
surfaced on `GET /api/stats`).

Known limitation (documented in code, not hidden): gas-trend block data stays
on viem — the KeeperHub SDK exposes no block-data surface.

The workflow's hat-guard nodes (`read-hat`, `verify-hat`) were already
KeeperHub `web3/read-contract` calls; Phase 9 F2 tags make that visible.

## Feature 2 — Bidirectional State Sync

`POST /webhook/keeperhub` (`webhook-server.ts`) maps KeeperHub stages onto
Axon states: `started → EXECUTING`, cast-node `node_complete` → stores
`txHash`, `completed → EXECUTED`, `failed → FAILED`. Every node in the
execution graph carries an `axon:` tag (`withNodeTags` in `executor.ts`), so
KeeperHub's dashboard reads `axon:governance-execution` instead of `node_5`.

`GET /api/sync/status` reports `{ lastKeeperHubSync, pendingSyncs,
syncedExecutions, webhookEndpoint }`, derived entirely from the database.

## Feature 3 — Dual Detection

`KeeperHubScheduler` (`kh-scheduler.ts`) creates a 12-second schedule-trigger
workflow per protocol that reads governance state and POSTs
`/webhook/hat-change`. Both detectors write the same `SpellRecord` table:
first one wins, the other marks `detectionSource: 'both'`
(`watcher.ts` + webhook handler both implement a side of the dedup).
`WatcherManager` starts/stops the scheduler alongside each polling watcher.
`GET /api/stats` exposes `detectionSource` / `lastDetectedBy`.

## Feature 4 — Protocol-Specific Workflow Templates

`WorkflowTemplateFactory` (`workflow-templates.ts`) generates a
guard → simulate → execute → verify graph per governor type
(`makerdao-spell`, `compound-governor`, `openzeppelin-governor`,
`optimistic-timelock`), each ending in registry webhook + discord success +
`4a` failure branch, all nodes tagged. `publishTemplate` lists them on the
KeeperHub marketplace. `WatcherManager.registerAndWatch` + `ensureAllTemplates`
publish on registration/boot and store `keeperHubTemplateId/Url` on the
`Protocol` row (surfaced on `GET /api/protocols` and the protocol page).

## Feature 5 — Per-Protocol Agentic Wallets

`ProtocolWalletManager` (`protocol-wallets.ts`) provisions scoped wallets
(`cast()`/`execute()`/`queue()` on the protocol's contract, 0.1 ETH/tx,
0.5 ETH/day) and persists `keeperHubWalletId/Address` on the `Protocol` row.
The executor threads the protocol's `walletId` into workflow creation and the
execute trigger — transactions never spend another protocol's scope. Absent a
wallet endpoint or key, execution falls back to the shared wallet (logged).
The protocol page shows the wallet with a KeeperHub link.

## Feature 6 — Native x402 in the Graph

`PAYMENT_MODE=native` (default) prepends Node 0 (`x402-payment-verify`,
0.05 USDC on Base) to every workflow; the trigger passes a payment reference
for in-graph verification, making payment atomic with execution.
`PAYMENT_MODE=gateway` preserves the legacy separate x402 gateway call.
11 nodes native, 10 gateway.

## Verification

```bash
npx tsx scripts/verify-execution.ts   # read-only: prints the six ✅ lines
npm run test:all                       # 210+ tests
cd packages/contracts && forge test    # 15 tests
```

## Submission proof

KeeperHub-executed `logExecution` on Base Sepolia AxonRegistry
`0x572436712eADc4117202D36bdaFe1c54B6231330`:
https://sepolia.basescan.org/tx/0x97c0d6dede89c98cc4917d250256735c95c01afe61791cd6f360016e713b0bb7
