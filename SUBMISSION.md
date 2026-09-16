# Axon — DoraHacks: KeeperHub Agent Economy Hackathon

> Bounty: https://dorahacks.io/hackathon/agent-economy/detail
> Track: Main — Best Integration into a Live Project
> Demo video: VIDEO_URL (recording done, uploading to YouTube)

## Which project did you integrate with, and what does the integration do?

**Axon** (https://github.com/danielamodu/Axon) — live at
https://axon-production-d089.up.railway.app — is an autonomous governance
operations pipeline for DeFi protocols (Sky/Aave/Compound). It watches
governance contracts, simulates execution safety, detects conflicts between
proposals, enforces timelocks and office hours, executes spells, and writes
immutable proofs to `AxonRegistry` on Base Sepolia.

**KeeperHub is the execution layer inside it** — not a wrapper, the load-bearing
middle of the pipeline (walkthrough: `walkthrough.md`, "Phase 9: KeeperHub
Maximum Depth"):

1. **Oracle** — USDS supply, Vat debt, Chainlink price read through KeeperHub
   Direct Execution API (viem strictly fallback; per-read source tracked).
2. **Dual detection** — a KeeperHub schedule-trigger workflow polls governance
   state alongside the local watcher; first detector wins, dedup by record.
3. **Workflow templates** — per-governor-type guard → simulate → execute →
   verify graphs, published to the KeeperHub marketplace.
4. **Per-protocol agentic wallets** — scoped KeeperHub wallets so one
   protocol's transactions never spend another's.
5. **Native x402 in-graph** — payment verification as Node 0 of the execution
   workflow (atomic with execution).
6. **Bidirectional sync** — KeeperHub stage webhooks drive Axon states
   (`started → EXECUTING`, `completed → EXECUTED`, `failed → FAILED`).

## Which KeeperHub surfaces did you use?

Direct Execution API (reads + `simulate:true` preflights), schedule triggers,
workflow create/execute/status/logs, marketplace publish, per-protocol wallets,
webhook sync, x402 payment verification. Audit trail of every run is stored on
the spell record and surfaced in the dashboard + MCP server.

## Testnet or mainnet?

Testnet for proofs (Base Sepolia `AxonRegistry`); mainnet Ethereum for
governance reads (Sky Chief `hat()`, Vat, USDS, Chainlink). Execution targets
mainnet spells through the same safety gates.

## Transaction executed through KeeperHub

- KH_EXecuted proof on the current registry: _PENDING — needs a workflow:create
  scoped key; will replace this line with the tx link before Sep 18 12:00 CEST._
- Historical KeeperHub-executed proof (previous registry, Phase 9):
  https://sepolia.basescan.org/tx/0x97c0d6dede89c98cc4917d250256735c95c01afe61791cd6f360016e713b0bb7
- Redeploy self-test proof (backend writer path, record #0):
  https://sepolia.basescan.org/tx/0x17ba599153a2fa135e5b091a436fbae3bfb2ff17375b66eb9cce751b4dca4187

## What still breaks or is unfinished? (candid)

- The configured KeeperHub key is read-scoped: workflow creation returns
  `unauthorized`, so execution currently fails closed instead of executing.
  One scoped key flips observe → live.
- Conflict fingerprints are keyword heuristics, not decoded-calldata analysis.
- The projector assesses current state + gas slope; it does not time-travel to
  the execution window.
- `AxonRegistry` source verification was submitted via Etherscan V2; badge
  pending confirmation on BaseScan.
- Live mainnet execution has never fired end-to-end (no real spell has queued
  during the build window) — dry-runs are explicitly marked and never forged.

## Live deployment

| Surface | URL |
| :--- | :--- |
| Dashboard (UI + API) | https://axon-production-d089.up.railway.app |
| Watcher pipeline | https://axonwatcher-production.up.railway.app/health |
| Registry (Base Sepolia) | https://sepolia.basescan.org/address/0x2C56618a6A89f04764e1De25A3F9D1C3Bf1471E2 |

## Verification

- Watcher/pipeline, MCP, CLI, gateway, dashboard suites green; Foundry unit +
  fuzz 17/17.
- Railway autodeploys from `main`; infra in `.railway/railway.ts`.

## Repo

https://github.com/danielamodu/Axon

## Contact

- Email: _TODO_
- X/Discord: _TODO_
