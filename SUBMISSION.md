# Axon — Submission

> Fill `VIDEO_URL` with the recorded demo link before submitting.
> Bounty URL: _TODO — paste the bounty/hackathon link here._

## One-liner

Autonomous protocol operations infrastructure: governance decisions execute themselves — watched, simulated, conflict-checked, timelock-enforced, and proven onchain.

## Problem

DAO governance execution is manual, slow, and dangerous: operators babysit timelocks,
eyeball spells, coordinate execution windows over chat, and leave no verifiable trail.
A missed window or a colliding proposal can move millions with no audit log.

## Solution

Axon is a full pipeline: governance watchers detect new spells → a state projector
scores execution safety (GREEN/YELLOW/RED) → a three-vector conflict detector blocks
parameter collisions and ordering hazards → an execution engine enforces timelocks and
office hours, simulates preflight, and executes via KeeperHub → every execution is
written as an immutable proof to `AxonRegistry` on Base, and surfaced on a live
operations dashboard with an MCP server for AI agents.

## Live deployment (production, not screenshots)

| Surface | URL |
| :--- | :--- |
| Dashboard (UI + API) | https://axon-production-d089.up.railway.app |
| Watcher health | https://axonwatcher-production.up.railway.app/health |
| Dashboard health | https://axon-production-d089.up.railway.app/api/health |
| Demo video | VIDEO_URL |

## Onchain proofs (Base Sepolia — click to verify)

| Proof | Link |
| :--- | :--- |
| `AxonRegistry` (current) | https://sepolia.basescan.org/address/0x2C56618a6A89f04764e1De25A3F9D1C3Bf1471E2 |
| Deployment tx (contract creation) | https://sepolia.basescan.org/tx/0x86a4512d4fda585be3c60aaa28337e77d8ee198d2dc2808dd6ea2f90b4563a7a |
| Self-test proof, record #0 (`SELFTEST_REDEPLOY`) | https://sepolia.basescan.org/tx/0x17ba599153a2fa135e5b091a436fbae3bfb2ff17375b66eb9cce751b4dca4187 |
| Previous deployment (history) | https://sepolia.basescan.org/address/0x572436712eADc4117202D36bdaFe1c54B6231330 |

```bash
# Verify record count yourself:
cast call 0x2C56618a6A89f04764e1De25A3F9D1C3Bf1471E2 \
  "getRecordCountByProtocol(address)" \
  0x0a3f6849f78076aefaDf113F5BED87720274dDC0 \
  --rpc-url https://sepolia.base.org
```

## Architecture

```
Governance Watchers → State Projector → Conflict Detector → Execution Engine
      (hat/propose)     (gas/Vat/USDS/    (parameter/ordering/  (timelock/office-hrs/
                         Chainlink)        timing)               preflight/KeeperHub)
                                                     ├→ AxonRegistry on Base (proof)
                                                     └→ Discord / webhooks
```

Key safety properties (all enforced in code, all tested):
- Dry-runs can never forge proofs (no fake tx hashes, registry write skipped).
- Timing proximity alone never blocks the queue (WARNING, not CONFLICT).
- Retries requeue instead of head-of-line blocking the executor.
- API keys are versioned + sha256-hashed; stored values are never valid bearer.

## Verification

- Watcher/pipeline, MCP, CLI, gateway, dashboard suites green; Foundry unit + fuzz
  17/17 (`cd packages/contracts && forge test`).
- Live services healthy (see health links above); Railway autodeploys from `main`.

## Repo

https://github.com/danielamodu/Axon

## Contact

- GitHub: [@danielamodu](https://github.com/danielamodu)
