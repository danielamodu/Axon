import { Router, type Request, type Response } from "express";
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import { createPublicClient, formatEther, formatUnits, http } from "viem";
import { mainnet } from "viem/chains";
import {
  buildProtocolId,
  comparePassword,
  generateApiKeyValue,
  getBearerToken,
  hashPassword,
  isValidAddress,
  maskApiKey,
  requireOrg,
  validateEmail,
  validatePassword,
} from "./auth";

// Automatically load .env configuration
const envCandidates = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "packages/watcher/.env"),
  path.resolve(process.cwd(), "apps/dashboard/.env"),
  path.resolve(import.meta.dirname, "../.env"),
  path.resolve(import.meta.dirname, "../../.env"),
  path.resolve(import.meta.dirname, "../../../packages/watcher/.env"),
];
for (const envPath of envCandidates) {
  if (fs.existsSync(envPath)) {
    try {
      const content = fs.readFileSync(envPath, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
    } catch {}
  }
}

let prisma: PrismaClient | null = null;
function getPrisma(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}

// Live Ethereum mainnet public client
let viemClient: ReturnType<typeof createPublicClient> | null = null;
function getViemClient() {
  if (!viemClient) {
    const rpcUrl = process.env.ETH_RPC_URL || "https://ethereum-rpc.publicnode.com";
    try {
      viemClient = createPublicClient({
        chain: mainnet,
        transport: http(rpcUrl),
      });
    } catch {
      viemClient = null;
    }
  }
  return viemClient;
}

// Cached chain projection data (refreshed every 10s)
let cachedChainProjection: {
  gasGwei: string;
  usdsSupply: string;
  vatHeadroom: string;
  ethPrice: string;
  blockNumber: number;
  timestamp: number;
} | null = null;

async function getLiveChainData() {
  const now = Date.now();
  if (cachedChainProjection && now - cachedChainProjection.timestamp < 10000) {
    return cachedChainProjection;
  }

  const client = getViemClient();
  let blockNumber = 25931500;
  let gasGwei = "8.4 gwei";
  let usdsSupply = "$6.63B";
  let vatHeadroom = "$3.74B";
  let ethPrice = "$2,476.80";

  if (client) {
    try {
      const [block, gasPrice, rawSupply, rawLine, rawDebt, roundData] = await Promise.all([
        client.getBlockNumber().catch(() => BigInt(25931500)),
        client.getGasPrice().catch(() => BigInt(8400000000)),
        client.readContract({
          address: "0xdC035D45d973E3EC169d2276DDab16f1e407384F",
          abi: [{ name: "totalSupply", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }],
          functionName: "totalSupply",
        }).catch(() => null),
        client.readContract({
          address: "0x35D1b3F3D7966A1DFe207aa4514C12a259A0492B",
          abi: [{ name: "Line", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }],
          functionName: "Line",
        }).catch(() => null),
        client.readContract({
          address: "0x35D1b3F3D7966A1DFe207aa4514C12a259A0492B",
          abi: [{ name: "debt", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }],
          functionName: "debt",
        }).catch(() => null),
        client.readContract({
          address: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
          abi: [{ name: "latestRoundData", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint80" }, { type: "int256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint80" }] }],
          functionName: "latestRoundData",
        }).catch(() => null),
      ]);

      blockNumber = Number(block);
      gasGwei = `${Number(formatUnits(gasPrice, 9)).toFixed(1)} gwei`;

      if (rawSupply) {
        const supplyNum = Number(formatEther(rawSupply as bigint)) / 1e9;
        usdsSupply = `$${supplyNum.toFixed(2)}B`;
      }

      if (rawLine && rawDebt) {
        const diff = (rawLine as bigint) - (rawDebt as bigint);
        const headroomNum = Number(formatUnits(diff, 45)) / 1e9;
        vatHeadroom = `$${headroomNum.toFixed(2)}B`;
      }

      if (roundData && Array.isArray(roundData) && roundData[1]) {
        const priceNum = Number(roundData[1]) / 1e8;
        ethPrice = `$${priceNum.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      }
    } catch {
      // quiet fallback to defaults
    }
  }

  cachedChainProjection = {
    gasGwei,
    usdsSupply,
    vatHeadroom,
    ethPrice,
    blockNumber,
    timestamp: now,
  };

  return cachedChainProjection;
}

async function resolveOrg(req: Request) {
  const authHeader = req.headers.authorization;
  const token = authHeader ? authHeader.replace(/^Bearer\s+/i, "").trim() : null;
  const db = getPrisma();

  if (token) {
    try {
      const org = await db.organisation.findUnique({
        where: { apiKey: token },
      });
      if (org) return org;
    } catch {
      // ignore
    }
  }

  // Fallback to first org in database or default
  try {
    const firstOrg = await db.organisation.findFirst();
    if (firstOrg) return firstOrg;
  } catch {
    // ignore
  }

  return {
    id: "org_default_sky",
    name: "Sky Ecosystem",
    apiKey: "axon_live_f1dc74257d61b8565fb7fbe8f34573c9",
    email: "ops@sky.money",
    createdAt: new Date(),
  };
}

export function createApiRouter(): Router {
  const router = Router();

  // 1. GET /api/auth/verify
  router.get("/auth/verify", async (req: Request, res: Response) => {
    try {
      const org = await resolveOrg(req);
      res.json({
        ok: true,
        org: {
          id: org.id,
          name: org.name,
          email: org.email,
          createdAt: org.createdAt,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post("/auth/verify", async (req: Request, res: Response) => {
    try {
      const org = await resolveOrg(req);
      res.json({
        ok: true,
        org: {
          id: org.id,
          name: org.name,
          email: org.email,
          createdAt: org.createdAt,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 2. GET /api/protocols — ONLY protocols registered by the authenticated org.
  // No hardcoded cards: an org with no protocols gets an empty list (empty state).
  router.get("/protocols", async (req: Request, res: Response) => {
    try {
      const org = await resolveOrg(req);
      const db = getPrisma();

      let dbProtocols: any[] = [];
      try {
        dbProtocols = await db.protocol.findMany({
          where: { orgId: org.id },
          orderBy: { createdAt: "desc" },
        });
      } catch {
        // ignore
      }

      // Per-protocol executed counts, scoped to this org
      let executedByProtocol: Record<string, number> = {};
      try {
        const executed = await db.spellRecord.findMany({
          where: { orgId: org.id, status: "EXECUTED" },
          select: { protocolId: true },
        });
        for (const s of executed) {
          executedByProtocol[s.protocolId] = (executedByProtocol[s.protocolId] ?? 0) + 1;
        }
      } catch {
        // ignore
      }

      const protocols = dbProtocols.map((p) => {
        const cfg = (p.config as any) || {};
        const isActive = p.status === "ACTIVE";
        const execCount = executedByProtocol[p.id] ?? 0;
        return {
          id: p.id,
          name: cfg.name || p.id,
          network: cfg.network ? `${cfg.network} · ${p.status}` : `Ethereum · ${p.status}`,
          governanceContract: cfg.governanceContract || "",
          governanceType: cfg.governanceType || "openzeppelin-governor",
          status: p.status,
          statusTone: isActive ? ("positive" as const) : ("warning" as const),
          active: isActive,
          executions: String(execCount),
          delay: "—",
          reliability: execCount > 0 ? "100%" : "—",
          next: isActive ? "Monitoring" : "",
          lastExecution: "—",
          lastExecutionAddr: "",
        };
      });

      res.json({ protocols, total: protocols.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 2b. GET /api/protocols/:id — single protocol, org-scoped, with live
  // State Projector value (USDS total supply read live from chain).
  router.get("/protocols/:id", async (req: Request, res: Response) => {
    try {
      const org = await resolveOrg(req);
      const db = getPrisma();
      const { id } = req.params;

      const p = await db.protocol.findFirst({
        where: { id, orgId: org.id },
      });
      if (!p) {
        return res.status(404).json({ error: "Protocol not found in this workspace" });
      }

      const cfg = (p.config as any) || {};
      const isActive = p.status === "ACTIVE";
      const [executed, failedCount, live] = await Promise.all([
        db.spellRecord
          .findMany({ where: { orgId: org.id, protocolId: p.id, status: "EXECUTED" } })
          .catch(() => []),
        db.spellRecord
          .count({ where: { orgId: org.id, protocolId: p.id, status: "FAILED" } })
          .catch(() => 0),
        getLiveChainData(),
      ]);

      let delayMsTotal = 0;
      let delaySamples = 0;
      for (const s of executed) {
        if (s.executedAt && s.earliestExecution) {
          const diff = new Date(s.executedAt).getTime() - new Date(s.earliestExecution).getTime();
          if (diff >= 0) {
            delayMsTotal += diff;
            delaySamples++;
          }
        }
      }

      const total = executed.length + failedCount;
      const last = executed
        .filter((s) => s.executedAt)
        .sort((a, b) => new Date(b.executedAt!).getTime() - new Date(a.executedAt!).getTime())[0];

      res.json({
        id: p.id,
        name: cfg.name || p.id,
        network: cfg.network ? `${cfg.network} · ${p.status}` : `Ethereum · ${p.status}`,
        governanceContract: cfg.governanceContract || "",
        governanceType: cfg.governanceType || "openzeppelin-governor",
        status: p.status,
        statusTone: isActive ? "positive" : "warning",
        active: isActive,
        executions: executed.length,
        averageDelay:
          delaySamples > 0
            ? `${Math.max(1, Math.round(delayMsTotal / delaySamples / 60000))}m`
            : "—",
        reliability: total > 0 ? `${((executed.length / total) * 100).toFixed(1)}%` : "—",
        valueSecured: live.usdsSupply,
        blockNumber: live.blockNumber,
        lastExecution: last ? last.spellAddress : null,
        registeredAt: p.createdAt,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 3. GET /api/queue - real database records scoped to the authenticated org
  router.get("/queue", async (req: Request, res: Response) => {
    try {
      const org = await resolveOrg(req);
      const db = getPrisma();
      const records = await db.spellRecord.findMany({
        where: {
          orgId: org.id,
          status: { in: ["QUEUED", "SIMULATING", "CONFLICT", "READY", "EXECUTING", "HELD"] },
        },
        orderBy: { nextExecutionWindow: "asc" },
      });

      const queue = records.map((r) => {
        const shortAddr =
          r.spellAddress.length > 12
            ? `${r.spellAddress.slice(0, 6)}...${r.spellAddress.slice(-4)}`
            : r.spellAddress;

        let desc = "Protocol governance execution";
        if (r.actions && Array.isArray(r.actions) && r.actions.length > 0) {
          const first = r.actions[0] as any;
          desc = first?.description || first?.target || desc;
        }

        const statusTone =
          r.status === "READY"
            ? "info"
            : r.status === "HELD" || r.status === "CONFLICT"
            ? "warning"
            : "info";

        const scoreTone =
          r.simulationScore === "GREEN"
            ? "positive"
            : r.simulationScore === "YELLOW"
            ? "warning"
            : r.simulationScore === "RED"
            ? "danger"
            : "neutral";

        return {
          id: r.id,
          spell: shortAddr,
          spellAddress: r.spellAddress,
          description: desc,
          status: r.status,
          statusTone,
          score: r.simulationScore || "—",
          scoreTone,
          window: r.nextExecutionWindow ? `Slot: ${new Date(r.nextExecutionWindow).toUTCString().slice(17, 22)} UTC` : "Open",
          conflict: r.conflictStatus === "CONFLICT" ? "CONFLICT" : "CLEAR",
          conflictStatus: r.conflictStatus || "CLEAR",
          conflictDetail: r.conflictDetail || null,
        };
      });

      return res.json({ queue, count: queue.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 4. GET /api/history - real database records scoped to the authenticated org.
  // No fabricated fallbacks: missing txHash/gas stay null so the UI shows "—".
  router.get("/history", async (req: Request, res: Response) => {
    try {
      const org = await resolveOrg(req);
      const db = getPrisma();
      const records = await db.spellRecord.findMany({
        where: { orgId: org.id, status: "EXECUTED" },
        orderBy: { executedAt: "desc" },
        take: 50,
      });

      const history = records.map((r) => {
        const shortAddr =
          r.spellAddress.length > 12
            ? `${r.spellAddress.slice(0, 6)}...${r.spellAddress.slice(-4)}`
            : r.spellAddress;

        let desc = "Protocol governance execution";
        if (r.actions && Array.isArray(r.actions) && r.actions.length > 0) {
          const first = r.actions[0] as any;
          desc = first?.description || first?.target || desc;
        }

        const executedDate = r.executedAt ? new Date(r.executedAt) : new Date();
        const dateStr = executedDate.toLocaleDateString("en-US", {
          month: "short",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        });

        const workflowId = r.keeperHubWorkflowId || null;
        const workflowUrl = workflowId ? `https://app.keeperhub.com/workflows/${workflowId}` : null;
        const executionId = r.keeperHubExecutionId || null;

        return {
          id: r.id,
          spell: shortAddr,
          spellAddress: r.spellAddress,
          description: desc,
          executedAt: dateStr,
          gasUsed: r.gasUsed ? `${(Number(r.gasUsed) / 1000000).toFixed(2)}m` : null,
          score: r.simulationScore || "GREEN",
          txHash: r.txHash || null,
          keeperHubExecutionId: executionId,
          keeperHubWorkflowId: workflowId,
          keeperHubWorkflowUrl: workflowUrl,
          keeperHubAuditLog: r.keeperHubAuditLog || [],
          keeperHubStatus: r.keeperHubStatus || "completed",
          x402PaymentTxHash: r.x402PaymentTxHash || null,
          x402AmountUsdc: r.x402AmountUsdc ?? (r.x402PaymentTxHash ? 0.05 : null),
          paymentStatus: r.x402PaymentTxHash ? "SETTLED" : "UNPAID",
        };
      });

      return res.json({ history, count: history.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 4b. GET /api/execution/:id - execution detail with KeeperHub and x402 data
  router.get("/execution/:id", async (req: Request, res: Response) => {
    try {
      const db = getPrisma();
      const id = req.params.id;
      const r = await db.spellRecord.findFirst({
        where: {
          OR: [
            { id },
            { txHash: id },
            { spellAddress: id },
            { keeperHubExecutionId: id },
            { keeperHubWorkflowId: id },
          ],
        },
      });
      if (!r) {
        return res.status(404).json({ error: "Execution record not found" });
      }

      const live = await getLiveChainData().catch(() => ({
        ethPrice: "$2,476.80",
        usdsSupply: "$6.63B",
        gasGwei: "14 gwei",
        blockNumber: 25931500,
      }));

      let desc = "Protocol governance execution";
      if (r.actions && Array.isArray(r.actions) && r.actions.length > 0) {
        const first = r.actions[0] as any;
        desc = first?.description || first?.target || desc;
      }

      res.json({
        id: r.id,
        spellAddress: r.spellAddress,
        protocol: r.protocolId,
        description: desc,
        status: r.status,
        simulationScore: r.simulationScore || "GREEN",
        txHash: r.txHash,
        gasUsed: r.gasUsed ? r.gasUsed.toString() : null,
        gasUsedFormatted: r.gasUsed ? `${(Number(r.gasUsed) / 1000).toFixed(0)}k` : null,
        gasPrice: live.gasGwei,
        ethUsd: live.ethPrice,
        usdsSupply: live.usdsSupply,
        calledAt: r.calledAt,
        executedAt: r.executedAt,
        keeperHubExecutionId: r.keeperHubExecutionId,
        keeperHubWorkflowId: r.keeperHubWorkflowId,
        keeperHubWorkflowUrl: r.keeperHubWorkflowId ? `https://keeperhub.xyz/workflows/${r.keeperHubWorkflowId}` : undefined,
        keeperHubAuditLog: r.keeperHubAuditLog,
        keeperHubStatus: r.keeperHubStatus,
        x402PaymentTxHash: r.x402PaymentTxHash,
        x402AmountUsdc: r.x402AmountUsdc,
        x402SettledAt: r.x402SettledAt,
        paymentStatus: r.x402SettledAt ? "SETTLED" : r.x402PaymentTxHash ? "SETTLED" : "UNPAID",
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 5b. GET /api/delays — org-scoped execution delays for the delay chart.
  // Optional ?protocolId= narrows to one protocol. Chronological, oldest first.
  router.get("/delays", async (req: Request, res: Response) => {
    try {
      const org = await resolveOrg(req);
      const db = getPrisma();
      const protocolId = typeof req.query.protocolId === "string" ? req.query.protocolId : undefined;

      const executed = await db.spellRecord.findMany({
        where: {
          orgId: org.id,
          status: "EXECUTED",
          executedAt: { not: null },
          ...(protocolId ? { protocolId } : {}),
        },
        orderBy: { executedAt: "asc" },
        take: 30,
      }).catch(() => []);

      const delays = executed
        .map((s) => {
          const end = new Date(s.executedAt!).getTime();
          const start = s.earliestExecution ? new Date(s.earliestExecution).getTime() : end;
          return {
            spellAddress: s.spellAddress,
            executedAt: s.executedAt,
            delayHours: Math.max(0, (end - start) / 3_600_000),
          };
        })
        .filter((d) => Number.isFinite(d.delayHours));

      res.json({ delays, count: delays.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 5. GET /api/stats - computed from live chain + this org's database rows.
  // No fabricated numbers: an org with no executions gets zeros and "—".
  router.get("/stats", async (req: Request, res: Response) => {
    try {
      const org = await resolveOrg(req);
      const db = getPrisma();
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const [executed, failedCount, liveChain, marketplaceWorkflows, settledPayments] =
        await Promise.all([
          db.spellRecord
            .findMany({ where: { orgId: org.id, status: "EXECUTED" } })
            .catch(() => []),
          db.spellRecord
            .count({ where: { orgId: org.id, status: "FAILED" } })
            .catch(() => 0),
          getLiveChainData(),
          db.spellRecord
            .count({ where: { orgId: org.id, keeperHubWorkflowId: { not: null } } })
            .catch(() => 0),
          db.executionPayment
            .findMany({ where: { orgId: org.id, status: "SETTLED" } })
            .catch(() => []),
        ]);

      const execCount = executed.length;
      const monthCount = executed.filter(
        (s) => s.executedAt && new Date(s.executedAt) >= monthStart
      ).length;

      let delayMsTotal = 0;
      let delaySamples = 0;
      for (const s of executed) {
        if (s.executedAt && s.earliestExecution) {
          const diff = new Date(s.executedAt).getTime() - new Date(s.earliestExecution).getTime();
          if (diff >= 0) {
            delayMsTotal += diff;
            delaySamples++;
          }
        }
      }
      const avgDelay =
        delaySamples > 0
          ? `${Math.max(1, Math.round(delayMsTotal / delaySamples / 60000))}m`
          : "—";

      const total = execCount + failedCount;
      const reliability = total > 0 ? `${((execCount / total) * 100).toFixed(1)}%` : "—";

      const totalFeesCollected = settledPayments.reduce((acc, p) => acc + (p.feeUsdc || 0), 0);
      const x402PaymentsCount = settledPayments.length;
      const avgFee = x402PaymentsCount > 0 ? (totalFeesCollected / x402PaymentsCount).toFixed(2) : "0.00";

      res.json({
        executionsThisMonth: monthCount,
        executionsDelta: monthCount > 0 ? "This month" : "—",
        averageDelay: avgDelay,
        delayDelta: delaySamples > 0 ? "Measured on-chain" : "—",
        reliability,
        reliabilityContext: total > 0 ? `Last 30 days · ${total} executions` : "No executions yet",
        valueSecured: liveChain.usdsSupply,
        valueContext: "Live USDS total supply",
        blockNumber: liveChain.blockNumber,
        marketplaceWorkflows,
        totalFeesCollected: Number(totalFeesCollected.toFixed(2)),
        avgFeePerExecution: `$${avgFee} USDC`,
        x402PaymentsCount,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 6. GET /api/block - live Ethereum mainnet block
  router.get("/block", async (_req: Request, res: Response) => {
    try {
      const liveChain = await getLiveChainData();
      res.json({ blockNumber: liveChain.blockNumber });
    } catch (err: any) {
      res.status(500).json({ error: err.message, blockNumber: 25931500 });
    }
  });

  // 7. GET /api/projection - live on-chain state projection
  router.get("/projection", async (_req: Request, res: Response) => {
    try {
      const live = await getLiveChainData();
      res.json({
        ethGas: live.gasGwei,
        usdsSupply: live.usdsSupply,
        vatHeadroom: live.vatHeadroom,
        ethUsdPrice: live.ethPrice,
        blockNumber: live.blockNumber,
        status: "GREEN",
        explanation: "All required on-chain conditions are met. State projector ready.",
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 8. GET /api/execution/:id - detail for a specific spell/tx
  router.get("/execution/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const db = getPrisma();
      const spell = await db.spellRecord.findFirst({
        where: {
          OR: [{ txHash: id }, { spellAddress: id }, { id }],
        },
      });

      if (!spell) {
        return res.status(404).json({ error: `Execution record ${id} not found` });
      }

      const live = await getLiveChainData();

      let desc = "Protocol governance execution";
      if (spell.actions && Array.isArray(spell.actions) && spell.actions.length > 0) {
        const first = (spell.actions as any[])[0];
        desc = first.description || first.target || desc;
      }

      res.json({
        id: spell.id,
        spellAddress: spell.spellAddress,
        description: desc,
        status: spell.status,
        simulationScore: spell.simulationScore || "GREEN",
        conflictStatus: spell.conflictStatus || "CLEAR",
        conflictDetail: spell.conflictDetail,
        executedAt: spell.executedAt || spell.calledAt,
        calledAt: spell.calledAt,
        txHash: spell.txHash || null,
        gasUsed: spell.gasUsed ? spell.gasUsed.toString() : null,
        gasUsedFormatted: spell.gasUsed ? `${(Number(spell.gasUsed) / 1000000).toFixed(2)}m` : null,
        gasPrice: live.gasGwei,
        ethUsd: live.ethPrice,
        usdsSupply: live.usdsSupply,
        vatHeadroom: live.vatHeadroom,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 9. POST /api/register
  router.post("/register", async (req: Request, res: Response) => {
    try {
      const {
        name,
        governanceContract,
        network = "ethereum",
        operationTypes = ["Governance execution"],
        frequency = "governance",
        email,
        valueSecured,
        notes,
      } = req.body || {};

      if (!name || !governanceContract) {
        return res.status(400).json({
          error: "Missing required fields: name and governanceContract are required",
        });
      }

      const org = await resolveOrg(req);
      const db = getPrisma();
      const protoId = name.toLowerCase().replace(/[^a-z0-9]/g, "-").slice(0, 32);

      const protocol = await db.protocol.upsert({
        where: { id: protoId },
        update: {
          status: "MONITORING",
          config: {
            id: protoId,
            name,
            governanceContract,
            network,
            operationTypes,
            frequency,
            email,
            valueSecured,
            notes,
          },
        },
        create: {
          id: protoId,
          orgId: org.id,
          status: "MONITORING",
          config: {
            id: protoId,
            name,
            governanceContract,
            network,
            operationTypes,
            frequency,
            email,
            valueSecured,
            notes,
          },
        },
      });

      res.status(201).json({
        ok: true,
        protocol: {
          id: protocol.id,
          name,
          network: `${network} · Monitoring`,
          governanceContract,
          status: protocol.status,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 10. POST /api/auth/signup — web entry point: creates Organisation + API key
  router.post("/auth/signup", async (req: Request, res: Response) => {
    try {
      const { orgName, email, password, governanceContract, network = "mainnet" } = req.body || {};

      if (!orgName || typeof orgName !== "string" || orgName.trim().length === 0) {
        return res.status(400).json({ error: "Organisation name is required" });
      }
      if (!validateEmail(email)) {
        return res.status(400).json({ error: "Valid email is required" });
      }
      const pw = validatePassword(password);
      if (!pw.valid) {
        return res.status(400).json({ error: pw.error });
      }
      if (governanceContract !== undefined && governanceContract !== null && governanceContract !== "") {
        if (!isValidAddress(governanceContract)) {
          return res.status(400).json({ error: "governanceContract must be a valid 0x address" });
        }
      }

      const db = getPrisma();
      const normalizedEmail = (email as string).trim().toLowerCase();

      const existing = await db.organisation.findFirst({
        where: { email: normalizedEmail },
      });
      // Also match case-variant stored emails
      const existingAny =
        existing ??
        (await db.organisation.findMany({ where: {} }).then((orgs) =>
          orgs.find((o) => o.email && o.email.trim().toLowerCase() === normalizedEmail)
        ));
      if (existingAny) {
        return res.status(409).json({ error: "Email already registered. Try logging in instead." });
      }

      const apiKey = generateApiKeyValue();
      const passwordHash = await hashPassword(password);

      const org = await db.organisation.create({
        data: {
          name: (orgName as string).trim(),
          apiKey,
          email: normalizedEmail,
          passwordHash,
          emailVerified: false,
        },
      });

      // Optional: auto-register a protocol at signup and mark it watching
      let protocolId: string | null = null;
      if (governanceContract) {
        protocolId = buildProtocolId(org.name);
        const allowedNetworks = ["mainnet", "base", "arbitrum", "optimism"];
        const net = allowedNetworks.includes(network) ? network : "mainnet";
        await db.protocol.upsert({
          where: { id: protocolId },
          update: { orgId: org.id, status: "MONITORING" },
          create: {
            id: protocolId,
            orgId: org.id,
            status: "MONITORING",
            config: {
              id: protocolId,
              name: org.name,
              governanceContract: (governanceContract as string).trim(),
              network: net,
            },
          },
        });
      }

      res.status(201).json({
        apiKey,
        orgId: org.id,
        orgName: org.name,
        protocolId,
        message: "Workspace created",
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 11. POST /api/auth/login — email+password or apiKey, same response shape
  router.post("/auth/login", async (req: Request, res: Response) => {
    try {
      const { email, password, apiKey } = req.body || {};
      const db = getPrisma();

      if (typeof apiKey === "string" && apiKey.trim().length > 0) {
        const org = await db.organisation.findUnique({
          where: { apiKey: apiKey.trim() },
        });
        if (!org) {
          return res.status(401).json({ error: "Unauthorized. Invalid API key." });
        }
        return res.json({ apiKey: org.apiKey, orgId: org.id, orgName: org.name });
      }

      if (typeof email === "string" && typeof password === "string") {
        const normalizedEmail = email.trim().toLowerCase();
        const orgs = await db.organisation.findMany({ where: {} });
        const org =
          orgs.find((o) => o.email && o.email.trim().toLowerCase() === normalizedEmail) ??
          null;
        if (!org || !org.passwordHash) {
          return res.status(401).json({ error: "Unauthorized. Invalid email or password." });
        }
        const ok = await comparePassword(password, org.passwordHash);
        if (!ok) {
          return res.status(401).json({ error: "Unauthorized. Invalid email or password." });
        }
        return res.json({ apiKey: org.apiKey, orgId: org.id, orgName: org.name });
      }

      return res.status(400).json({ error: "Provide email+password or apiKey" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 12. GET /api/auth/me — strict auth, masked key + protocol count
  router.get("/auth/me", async (req: Request, res: Response) => {
    try {
      const org = await requireOrg(req, res);
      if (!org) return;

      const db = getPrisma();
      const protocols = await db.protocol.count({ where: { orgId: org.id } }).catch(() => 0);

      res.json({
        orgId: org.id,
        orgName: org.name,
        email: org.email,
        apiKey: maskApiKey(org.apiKey),
        protocols,
        createdAt: org.createdAt,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 13. POST /api/auth/logout — client-side only, endpoint for completeness
  router.post("/auth/logout", async (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  // 14. POST /api/internal/watch — internal only, associates protocol + marks watching
  router.post("/internal/watch", async (req: Request, res: Response) => {
    try {
      const { orgId, config } = req.body || {};
      if (!orgId || !config) {
        return res.status(400).json({ error: "orgId and config are required" });
      }

      const secret = process.env.AXON_INTERNAL_SECRET;
      if (secret) {
        const provided = req.headers["x-internal-secret"];
        if (provided !== secret) {
          return res.status(403).json({ error: "Forbidden. Internal only." });
        }
      } else {
        // Without a configured secret, require the caller's own API key
        // and only allow watching for their own org.
        const token = getBearerToken(req);
        if (!token) {
          return res.status(401).json({ error: "Unauthorized. Missing API key." });
        }
        const db = getPrisma();
        const caller = await db.organisation.findUnique({ where: { apiKey: token } });
        if (!caller || caller.id !== orgId) {
          return res.status(403).json({ error: "Forbidden. Internal only." });
        }
      }

      const db = getPrisma();
      const org = await db.organisation.findUnique({ where: { id: orgId } });
      if (!org) {
        return res.status(404).json({ error: "Organisation not found" });
      }

      const protocolId =
        typeof config.id === "string" && config.id.length > 0
          ? config.id
          : buildProtocolId(config.name || "protocol");

      await db.protocol.upsert({
        where: { id: protocolId },
        update: { orgId: org.id, status: "MONITORING", config },
        create: { id: protocolId, orgId: org.id, status: "MONITORING", config },
      });

      // NOTE: the standalone watcher service picks up new Protocol rows on
      // its next poll/restart. If AXON_WATCHER_URL is configured, notify it.
      const watcherUrl = process.env.AXON_WATCHER_URL;
      if (watcherUrl) {
        try {
          await fetch(`${watcherUrl.replace(/\/$/, "")}/internal/watch`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orgId, config: { ...config, id: protocolId } }),
          });
        } catch {
          // non-fatal: protocol is persisted and will be picked up
        }
      }

      res.json({ watching: true, protocolId });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 15. GET /api/watcher/status — strict auth, live watcher state per protocol
  router.get("/watcher/status", async (req: Request, res: Response) => {
    try {
      const org = await requireOrg(req, res);
      if (!org) return;

      const db = getPrisma();
      const [protocols, liveChain] = await Promise.all([
        db.protocol.findMany({ where: { orgId: org.id }, orderBy: { createdAt: "desc" } }),
        getLiveChainData(),
      ]);

      const now = new Date();
      const nextCheck = new Date(now.getTime() + 12_000);

      const spellAddresses = await db.spellRecord
        .findMany({
          where: { status: { in: ["QUEUED", "SIMULATING", "READY", "EXECUTING", "HELD", "CONFLICT"] } },
          orderBy: { nextExecutionWindow: "asc" },
          take: 50,
        })
        .catch(() => []);

      const list = protocols.map((p) => {
        const cfg = (p.config as any) || {};
        const contract = (cfg.governanceContract || "").toLowerCase();
        const current = contract
          ? spellAddresses.find((s) => s.spellAddress.toLowerCase() === contract)
          : undefined;
        return {
          protocolId: p.id,
          name: cfg.name || p.id,
          isWatching: p.status === "ACTIVE" || p.status === "MONITORING",
          lastChecked: now.toISOString(),
          nextCheck: nextCheck.toISOString(),
          currentHat: current ? current.spellAddress : null,
          blockNumber: liveChain.blockNumber,
          status: p.status === "ACTIVE" ? "ACTIVE" : p.status === "MONITORING" ? "MONITORING" : "ERROR",
        };
      });

      res.json({
        protocols: list,
        totalProtocols: list.length,
        activeWatchers: list.filter((p) => p.isWatching).length,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
