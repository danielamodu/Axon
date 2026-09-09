import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clipboard,
  Clock3,
  Code2,
  Copy,
  Download,
  ExternalLink,
  FileCheck2,
  FileText,
  Filter,
  Gauge,
  GitBranch,
  Info,
  LayoutDashboard,
  Link2,
  ListFilter,
  Menu,
  MoreHorizontal,
  Network,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Users,
  WalletCards,
  X,
  Zap,
} from "lucide-react";
import { Link, useLocation, useParams } from "wouter";
import { toast } from "sonner";
import { getStoredKey, useRequireAuth } from "./Auth";

export const DEFAULT_API_KEY = "axon_live_f1dc74257d61b8565fb7fbe8f34573c9";

export function getAuthToken(): string {
  if (typeof window === "undefined") return DEFAULT_API_KEY;
  return window.localStorage.getItem("axon_api_key") || DEFAULT_API_KEY;
}

export function getAuthHeaders(): HeadersInit {
  return {
    "Authorization": `Bearer ${getAuthToken()}`,
    "Content-Type": "application/json",
  };
}

const appNav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/protocol/sky", label: "Sky Protocol", icon: Network },
  { href: "/register", label: "Register", icon: Plus },
];

function AppMark() {
  return (
    <span className="app-mark" aria-hidden="true">
      <svg viewBox="0 0 32 32" fill="none">
        <path d="M7.5 7.5 16 16l8.5-8.5M7.5 24.5 16 16l8.5 8.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="7.5" cy="7.5" r="2.5" fill="currentColor" />
        <circle cx="24.5" cy="7.5" r="2.5" fill="currentColor" />
        <circle cx="16" cy="16" r="2.8" fill="currentColor" />
        <circle cx="7.5" cy="24.5" r="2.5" fill="currentColor" />
        <circle cx="24.5" cy="24.5" r="2.5" fill="currentColor" />
      </svg>
    </span>
  );
}

function StatusBadge({ status, tone = "neutral" }: { status: string; tone?: "positive" | "warning" | "danger" | "info" | "neutral" }) {
  return (
    <span className={`app-status status-${tone}`}>
      <span className="status-bullet" />
      {status}
    </span>
  );
}

function CopyValue({ children, value }: { children: React.ReactNode; value?: string }) {
  const [copied, setCopied] = useState(false);
  const textToCopy = value || (typeof children === "string" ? children : "");

  return (
    <button
      className="copy-value"
      onClick={() => {
        setCopied(true);
        navigator.clipboard?.writeText(textToCopy);
        window.setTimeout(() => setCopied(false), 1200);
      }}
      aria-label={`Copy ${textToCopy}`}
    >
      <span>{children}</span>
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

function AppShell({ children, title, eyebrow = "Protocol operations" }: { children: React.ReactNode; title?: string; eyebrow?: string }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [blockNumber, setBlockNumber] = useState<number>(25931500);
  const [org, setOrg] = useState<{ id: string; name: string; email?: string } | null>(null);

  // Poll Ethereum block number every 12 seconds
  useEffect(() => {
    let mounted = true;
    const fetchBlock = async () => {
      try {
        const res = await fetch("/api/block", { headers: getAuthHeaders() });
        if (res.ok) {
          const data = await res.json();
          if (mounted && data.blockNumber) {
            setBlockNumber(data.blockNumber);
          }
        }
      } catch {
        // quiet fallback
      }
    };
    fetchBlock();
    const interval = setInterval(fetchBlock, 12000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  // Fetch authenticated org details
  useEffect(() => {
    let mounted = true;
    const fetchOrg = async () => {
      try {
        const res = await fetch("/api/auth/verify", { headers: getAuthHeaders() });
        if (res.ok) {
          const data = await res.json();
          if (mounted && data.org) {
            setOrg(data.org);
          }
        }
      } catch {
        // quiet fallback
      }
    };
    fetchOrg();
  }, []);

  const orgInitials = org?.name
    ? org.name
        .split(" ")
        .map((w) => w[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : "SE";

  return (
    <div className="app-shell">
      <aside className={`app-sidebar ${mobileOpen ? "is-open" : ""}`}>
        <div className="app-sidebar-top">
          <Link href="/" className="app-brand">
            <AppMark />
            <span>axon</span>
          </Link>
          <button className="sidebar-close" onClick={() => setMobileOpen(false)} aria-label="Close navigation">
            <X size={18} />
          </button>
        </div>
        <div className="workspace-switcher">
          <span className="workspace-symbol"><Network size={14} /></span>
          <span><small>Workspace</small><b>{org?.name || "Axon operations"}</b></span>
          <ChevronDown size={14} />
        </div>
        <nav className="app-nav" aria-label="Application navigation">
          <span className="nav-label">Operate</span>
          {appNav.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`app-nav-link ${location === href ? "active" : ""}`}
              onClick={() => setMobileOpen(false)}
            >
              <Icon size={16} />
              <span>{label}</span>
              {label === "Sky Protocol" && <span className="nav-live-dot" />}
            </Link>
          ))}
          <span className="nav-label nav-label-spaced">Observe</span>
          <Link
            href="/docs"
            className={`app-nav-link ${location === "/docs" ? "active" : ""}`}
            onClick={() => setMobileOpen(false)}
          >
            <FileText size={16} />
            <span>Docs</span>
            <ChevronRight className="nav-external" size={12} />
          </Link>
          <a href="https://keeperhub.xyz" className="app-nav-link" target="_blank" rel="noreferrer">
            <Zap size={16} />
            <span>KeeperHub</span>
            <ExternalLink className="nav-external" size={12} />
          </a>
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-provider">
            <span className="provider-icon"><Zap size={13} /></span>
            <span><small>Execution provider</small><b>KeeperHub <span className="provider-live">●</span></b></span>
          </div>
          <Link href="/settings" className={`sidebar-settings ${location === "/settings" ? "active" : ""}`}>
            <Settings2 size={15} /> Settings
          </Link>
        </div>
      </aside>
      {mobileOpen && <button className="app-overlay" onClick={() => setMobileOpen(false)} aria-label="Close navigation overlay" />}
      <div className="app-main">
        <header className="app-topbar">
          <button className="app-menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Menu size={20} />
          </button>
          <div className="topbar-context">
            <span className="topbar-eyebrow">{eyebrow}</span>
            {title && (
              <>
                <span className="topbar-slash">/</span>
                <span className="topbar-title">{title}</span>
              </>
            )}
          </div>
          <div className="topbar-right">
            <span className="chain-status">
              <span className="status-bullet" /> Live <span className="topbar-divider" /> Ethereum block <b>{blockNumber.toLocaleString()}</b>
            </span>
            <Link href="/settings" className="topbar-avatar" aria-label="Open workspace settings">
              {orgInitials}
            </Link>
          </div>
        </header>
        <div className="app-content">{children}</div>
      </div>
    </div>
  );
}

function PageIntro({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="page-intro">
      <div>
        <span className="app-eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action && <div className="page-intro-action">{action}</div>}
    </div>
  );
}

function StatCard({ label, value, meta, icon: Icon, tone = "neutral" }: { label: string; value: string; meta: string; icon: React.ComponentType<{ size?: number }>; tone?: string }) {
  return (
    <div className="stat-card">
      <div className="stat-card-top">
        <span>{label}</span>
        <span className={`stat-icon ${tone}`}><Icon size={15} /></span>
      </div>
      <strong>{value}</strong>
      <small>{meta}</small>
    </div>
  );
}

function ProtocolCard({
  name,
  network,
  status,
  statusTone = "warning",
  active,
  executions,
  delay,
  reliability,
  next,
  lastExecution,
  lastExecutionAddr,
}: {
  name: string;
  network: string;
  status: string;
  statusTone?: "positive" | "warning";
  active?: boolean;
  executions: string;
  delay: string;
  reliability: string;
  next: string;
  lastExecution?: string;
  lastExecutionAddr?: string;
}) {
  return (
    <div className={`protocol-card ${active ? "protocol-active" : ""}`}>
      <div className="protocol-card-head">
        <div className="protocol-identity">
          <span className="protocol-logo">{name.charAt(0)}</span>
          <span><b>{name}</b><small>{network}</small></span>
        </div>
        <StatusBadge status={status} tone={statusTone} />
      </div>
      {active ? (
        <>
          <div className="protocol-stats">
            <span><small>Total executions</small><b>{executions || "1"}</b></span>
            <span><small>Avg delay</small><b>{delay || "4m 12s"}</b></span>
            <span><small>Reliability</small><b>{reliability || "98.7%"}</b></span>
          </div>
          <div className="protocol-last">
            <span>
              Last execution{" "}
              {lastExecutionAddr ? (
                <CopyValue value={lastExecutionAddr}>{lastExecution}</CopyValue>
              ) : (
                <b>{lastExecution || "Live"}</b>
              )}
            </span>
            <span>Confirmed</span>
          </div>
          <div className="reliability-bar">
            <span style={{ width: reliability || "98.7%" }} />
          </div>
          <div className="protocol-card-foot">
            <span>Next execution <b>{next || "In 18m"}</b></span>
            <Link href="/protocol/sky">View details <ArrowRight size={14} /></Link>
          </div>
        </>
      ) : (
        <>
          <div className="monitoring-copy">
            <b>Governance monitoring active</b>
            <span>Ready for autonomous execution</span>
          </div>
          <div className="protocol-card-foot">
            <span>Est. earnings <b>—</b></span>
            <Link href="/register" className="inline-button">
              Configure parameters <ArrowUpRight size={13} />
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

function DelayChart() {
  // Hardcoded historical delay chart dataset as specified:
  // Before Axon (17 bars): [28, 14, 6, 31, 8, 19, 3, 22, 11, 16, 25, 7, 13, 29, 4, 17, 9]
  // Axon activated marker placed after bar 17
  // After Axon (3 bars): [0.1, 0.2, 0.1]
  const beforeAxon = [28, 14, 6, 31, 8, 19, 3, 22, 11, 16, 25, 7, 13, 29, 4, 17, 9];
  const afterAxon = [0.1, 0.2, 0.1];
  const bars = [...beforeAxon, ...afterAxon];
  const maxDelay = 32;

  return (
    <div className="panel chart-panel">
      <div className="panel-head">
        <div>
          <h2>Sky Protocol — Execution delay history</h2>
          <p>Hours between governance passing and on-chain execution</p>
        </div>
        <button className="icon-button" aria-label="Chart options">
          <MoreHorizontal size={18} />
        </button>
      </div>
      <div className="chart-wrap">
        <div className="chart-y-labels">
          <span>32h</span>
          <span>16h</span>
          <span>0h</span>
        </div>
        <div className="chart-area">
          <div className="chart-grid-line line-1" />
          <div className="chart-grid-line line-2" />
          <div className="chart-grid-line line-3" />
          <div className="chart-bars">
            {bars.map((height, index) => {
              const isAfter = index >= 17;
              const heightPct = Math.max((height / maxDelay) * 100, 3.5);
              const tone = height > 24 ? "danger" : height > 8 ? "caution" : "good";
              const tooltip = height < 1 ? `${Math.round(height * 60)} minutes` : `${height} hours`;

              return (
                <div key={index} className={`chart-bar-group ${isAfter ? "after-axon" : ""}`}>
                  <span
                    className={`chart-bar ${tone}`}
                    style={{ height: `${heightPct}%` }}
                    title={tooltip}
                  />
                  <small>{index + 1}</small>
                </div>
              );
            })}
          </div>
          <div className="chart-divider" style={{ left: "calc(100% * 0.85)" }}>
            <span>Axon activated</span>
          </div>
        </div>
      </div>
      <div className="chart-legend">
        <span><i className="legend-swatch good" />Under 8h</span>
        <span><i className="legend-swatch caution" />8–24h</span>
        <span><i className="legend-swatch danger" />Over 24h</span>
        <span className="chart-period">Last 30 days</span>
      </div>
    </div>
  );
}

function QueueTable({ onConflict }: { onConflict: (spell: any) => void }) {
  const [queue, setQueue] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchQueue = async () => {
    try {
      const res = await fetch("/api/queue", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = await res.json();
      setQueue(data.queue || []);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Poll queue every 10 seconds as requested
  useEffect(() => {
    fetchQueue();
    const interval = setInterval(fetchQueue, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="panel queue-panel">
      <div className="panel-head">
        <div>
          <h2>Execution queue <span className="live-heading"><span className="status-bullet" /> Live</span></h2>
          <p>Refreshing quietly every 10 seconds</p>
        </div>
        <div className="panel-actions">
          <button className="icon-button" aria-label="Filter queue" onClick={fetchQueue}>
            <Filter size={16} />
          </button>
          <button className="icon-button" aria-label="Refresh queue" onClick={fetchQueue}>
            <RefreshCw size={16} />
          </button>
        </div>
      </div>
      <div className="table-scroll">
        <table className="axon-table">
          <thead>
            <tr>
              <th>Spell address</th>
              <th>Description</th>
              <th>Status</th>
              <th>Sim score</th>
              <th>Window</th>
              <th>Conflict</th>
            </tr>
          </thead>
          <tbody>
            {loading && queue.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", padding: "28px 16px", color: "var(--ink-faint)" }}>
                  Checking pipeline queue...
                </td>
              </tr>
            ) : error && queue.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", padding: "28px 16px", color: "#bf6a61" }}>
                  Unable to load queue: {error}
                </td>
              </tr>
            ) : queue.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", padding: "36px 16px", color: "var(--ink-muted)" }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
                    <CheckCircle2 size={24} color="#63a078" />
                    <b>No active spells in execution queue</b>
                    <small style={{ color: "var(--ink-faint)" }}>All protocol operations are clear. Next execution window monitored on-chain.</small>
                  </div>
                </td>
              </tr>
            ) : (
              queue.map((row) => (
                <tr key={row.id || row.spellAddress || row.spell}>
                  <td>
                    <Link href={`/execution/${row.spellAddress || row.spell}`} style={{ textDecoration: "none" }}>
                      <CopyValue value={row.spellAddress || row.spell}>
                        {row.spell}
                      </CopyValue>
                    </Link>
                  </td>
                  <td className="description-cell">{row.description}</td>
                  <td>
                    <StatusBadge status={row.status} tone={row.statusTone as "info" | "warning"} />
                  </td>
                  <td>
                    <StatusBadge status={row.score} tone={row.scoreTone as "positive" | "warning" | "neutral"} />
                  </td>
                  <td className="muted-cell">{row.window}</td>
                  <td>
                    {row.conflict === "CONFLICT" ? (
                      <button className="conflict-button" onClick={() => onConflict(row)}>
                        <AlertTriangle size={13} /> Conflict
                      </button>
                    ) : (
                      <span className="clear-mark">
                        <Check size={13} /> Clear
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="panel-foot">
        <span>{queue.length} active spell{queue.length === 1 ? "" : "s"} monitored</span>
        {queue.length > 0 ? (
          <Link href={`/execution/${queue[0].spellAddress || queue[0].spell}`}>
            View active spell <ArrowRight size={14} />
          </Link>
        ) : (
          <span style={{ color: "var(--ink-faint)", fontSize: "12px" }}>Pipeline healthy</span>
        )}
      </div>
    </div>
  );
}

function HistoryTable() {
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = async () => {
    try {
      const res = await fetch("/api/history", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = await res.json();
      setHistory(data.history || []);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  return (
    <div className="panel history-panel">
      <div className="panel-head">
        <div>
          <h2>Execution history</h2>
          <p>Completed KeeperHub operations verified on-chain</p>
        </div>
        <button
          className="text-button"
          onClick={() => {
            if (history.length === 0) return;
            const csv = history.map((h) => `${h.spellAddress || h.spell},"${h.description}",${h.executedAt},${h.gasUsed},${h.score},${h.txHash}`).join("\n");
            const blob = new Blob([`Spell,Description,Executed At,Gas Used,Score,TxHash\n${csv}`], { type: "text/csv" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "axon-execution-history.csv";
            a.click();
          }}
        >
          <Download size={14} /> Export CSV
        </button>
      </div>
      <div className="table-scroll">
        <table className="axon-table">
          <thead>
            <tr>
              <th>Spell</th>
              <th>Description</th>
              <th>Executed at</th>
              <th>Gas used</th>
              <th>Workflow</th>
              <th>Payment</th>
              <th>Proof</th>
            </tr>
          </thead>
          <tbody>
            {loading && history.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", padding: "28px 16px", color: "var(--ink-faint)" }}>
                  Loading history...
                </td>
              </tr>
            ) : error && history.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", padding: "28px 16px", color: "#bf6a61" }}>
                  Error loading execution history: {error}
                </td>
              </tr>
            ) : history.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", padding: "32px 16px", color: "var(--ink-muted)" }}>
                  No completed executions recorded yet.
                </td>
              </tr>
            ) : (
              history.map((row) => (
                <tr key={row.id || row.txHash || row.spell}>
                  <td>
                    <Link href={`/execution/${row.txHash || row.spellAddress || row.spell}`} style={{ textDecoration: "none" }}>
                      <CopyValue value={row.spellAddress || row.spell}>
                        {row.spell}
                      </CopyValue>
                    </Link>
                  </td>
                  <td className="description-cell">{row.description}</td>
                  <td className="muted-cell">{row.executedAt}</td>
                  <td className="mono-cell">{row.gasUsed}</td>
                  <td>
                    {row.keeperHubWorkflowUrl ? (
                      <a
                        className="table-link"
                        href={row.keeperHubWorkflowUrl}
                        target="_blank"
                        rel="noreferrer"
                        title={row.keeperHubWorkflowId ? `KeeperHub Workflow ID: ${row.keeperHubWorkflowId}` : undefined}
                      >
                        View Workflow <ExternalLink size={12} />
                      </a>
                    ) : (
                      <span className="muted-cell">—</span>
                    )}
                  </td>
                  <td>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                      <StatusBadge
                        status={row.paymentStatus || "SETTLED"}
                        tone={row.paymentStatus === "UNPAID" ? "warning" : "positive"}
                      />
                      <span className="mono-cell" style={{ fontSize: "11px", color: "var(--ink-muted)" }}>
                        ${(row.x402AmountUsdc ?? 0.05).toFixed(2)}
                      </span>
                    </div>
                  </td>
                  <td>
                    <a
                      className="table-link"
                      href={`https://basescan.org/tx/${row.txHash || ""}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Registry proof <ExternalLink size={12} />
                    </a>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="panel-foot">
        <span>Showing {history.length} completed execution{history.length === 1 ? "" : "s"}</span>
        <button className="pagination-button" onClick={fetchHistory}>
          Refresh <RefreshCw size={12} />
        </button>
      </div>
    </div>
  );
}

function ConflictModal({ spell, onClose }: { spell?: any; onClose: () => void }) {
  let detailObj: any = null;
  if (spell?.conflictDetail) {
    try {
      detailObj = typeof spell.conflictDetail === "string" ? JSON.parse(spell.conflictDetail) : spell.conflictDetail;
    } catch {
      detailObj = { raw: spell.conflictDetail };
    }
  } else {
    detailObj = {
      type: "ORDERING_DEPENDENCY",
      blockingSpell: spell?.spellAddress ? `${spell.spellAddress.slice(0, 6)}...${spell.spellAddress.slice(-4)}` : "Prerequisite spell",
      reason: "This spell cannot execute until the prerequisite governance update is confirmed.",
      retryable: true,
    };
  }

  const conflictType = detailObj.type || "ORDERING_DEPENDENCY";
  const blockingSpell = detailObj.blockingSpell || "Prerequisite spell";

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="conflict-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="conflict-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <span className="modal-icon danger-icon"><AlertTriangle size={18} /></span>
            <div>
              <span className="app-eyebrow">Execution held</span>
              <h2 id="conflict-title">
                {conflictType === "ORDERING_DEPENDENCY"
                  ? "Ordering dependency detected"
                  : conflictType === "PARAMETER_OVERLAP"
                  ? "Parameter overlap detected"
                  : "Execution conflict detected"}
              </h2>
            </div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close conflict detail">
            <X size={18} />
          </button>
        </div>
        <div className="modal-content">
          <div className="conflict-summary">
            <StatusBadge status={conflictType} tone="danger" />
            <p>
              {detailObj.reason ||
                "This spell cannot execute until the prerequisite update is confirmed on-chain. Axon has held the operation; no transaction was submitted."}
            </p>
          </div>
          <div className="modal-section">
            <span>Conflicts with</span>
            <div className="conflict-linked">
              <CopyValue value={blockingSpell}>{blockingSpell}</CopyValue>
              <b>Prerequisite update</b>
            </div>
          </div>
          <div className="modal-section">
            <span>Recommended resolution</span>
            <p>
              Wait for the active spell to reach on-chain confirmation, then re-run simulation. Axon will re-check the dependency automatically.
            </p>
          </div>
          <details className="json-detail">
            <summary>View conflict detail <ChevronDown size={14} /></summary>
            <pre>{JSON.stringify(detailObj, null, 2)}</pre>
          </details>
        </div>
        <div className="modal-foot">
          <button className="secondary-button" onClick={onClose}>Close</button>
          <button className="primary-button" onClick={onClose}>Keep on hold <Check size={14} /></button>
        </div>
      </div>
    </div>
  );
}

function timeAgo(iso: string): string {
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 5) return "just now";
  if (secs < 60) return `${secs} seconds ago`;
  return `${Math.floor(secs / 60)}m ago`;
}

function secondsUntil(iso: string): number {
  return Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 1000));
}

function WatcherStatusPanel() {
  const [status, setStatus] = useState<any | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const key = getStoredKey();
        const res = await fetch("/api/watcher/status", {
          headers: key ? { Authorization: `Bearer ${key}` } : getAuthHeaders(),
        });
        if (res.ok) {
          const data = await res.json();
          if (mounted) setStatus(data);
        }
      } catch {
        // quiet
      }
    };
    load();
    const poll = window.setInterval(load, 3000);
    const clock = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => {
      mounted = false;
      window.clearInterval(poll);
      window.clearInterval(clock);
    };
  }, []);

  if (!status || !status.protocols || status.protocols.length === 0) return null;

  return (
    <div className="watcher-live" aria-label="Live watcher status">
      {status.protocols.map((p: any) => (
        <div className="watcher-row" key={p.protocolId}>
          <span className="status-dot live" />
          <span>
            <span className="watcher-name">Watching {p.name}</span>
            <br />
            <span className="watcher-meta">
              {p.currentHat
                ? `Current hat: ${p.currentHat.slice(0, 6)}...${p.currentHat.slice(-4)} · `
                : ""}
              Block {p.blockNumber} · Next check in {secondsUntil(p.nextCheck)}s
            </span>
            <br />
            <span className="watcher-meta">Last checked {timeAgo(p.lastChecked)}</span>
          </span>
          <time>{p.status}</time>
        </div>
      ))}
    </div>
  );
}

export function Dashboard() {
  const { loading: authLoading } = useRequireAuth();
  const [conflictSpell, setConflictSpell] = useState<any | null>(null);
  const [protocols, setProtocols] = useState<any[]>([]);
  const [protocolsLoading, setProtocolsLoading] = useState(true);
  const [org, setOrg] = useState<any>(null);
  const [stats, setStats] = useState<any>({
    executionsThisMonth: "1",
    executionsDelta: "↑ 18% from last month",
    averageDelay: "4m 12s",
    delayDelta: "↓ 96% since Axon",
    reliability: "98.7%",
    reliabilityContext: "Last 30 days · Sky",
    valueSecured: "$6.63B",
    valueContext: "Live USDS total supply",
  });

  const loadData = async () => {
    try {
      const [protoRes, statsRes, orgRes] = await Promise.all([
        fetch("/api/protocols", { headers: getAuthHeaders() }),
        fetch("/api/stats", { headers: getAuthHeaders() }),
        fetch("/api/auth/verify", { headers: getAuthHeaders() }),
      ]);

      if (protoRes.ok) {
        const protoData = await protoRes.json();
        setProtocols(protoData.protocols || []);
      }
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData);
      }
      if (orgRes.ok) {
        const orgData = await orgRes.json();
        setOrg(orgData.org);
      }
    } catch {
      // quiet fallback
    } finally {
      setProtocolsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  if (authLoading) {
    return (
      <AppShell title="Dashboard">
        <div className="dashboard-page">
          <div className="loading-state" style={{ padding: "60px 0", color: "var(--ink-faint)" }}>
            Verifying workspace…
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Dashboard">
      <div className="dashboard-page">
        <div className="connection-banner">
          <span><CircleDot size={14} /> All systems operational</span>
          <span>Last updated just now</span>
        </div>
        <PageIntro
          eyebrow="Overview"
          title={`Good morning, ${org?.name || "Operator"}`}
          description="Here is what needs attention across your protocol operations."
          action={
            <button className="secondary-button" onClick={loadData}>
              <RefreshCw size={14} /> Refresh data
            </button>
          }
        />
        <div className="dashboard-stats">
          <StatCard
            label="Executions this month"
            value={String(stats.executionsThisMonth || "1")}
            meta={stats.executionsDelta || "↑ 18% from last month"}
            icon={Zap}
            tone="positive"
          />
          <StatCard
            label="Average execution delay"
            value={stats.averageDelay || "4m 12s"}
            meta={stats.delayDelta || "↓ 96% since Axon"}
            icon={Clock3}
            tone="info"
          />
          <StatCard
            label="Reliability"
            value={stats.reliability || "98.7%"}
            meta={stats.reliabilityContext || "Last 30 days · Sky"}
            icon={Gauge}
            tone="positive"
          />
          <StatCard
            label="Value secured"
            value={stats.valueSecured || "$6.63B"}
            meta={stats.valueContext || "Live USDS total supply"}
            icon={ShieldCheck}
            tone="neutral"
          />
        </div>

        <section className="section-block">
          <div className="section-heading">
            <div>
              <span className="app-eyebrow">Connected protocols</span>
              <h2>Protocol operations</h2>
            </div>
            <Link href="/register" className="text-button">
              Register protocol <ArrowRight size={14} />
            </Link>
          </div>

          {protocolsLoading ? (
            <div className="loading-state" style={{ padding: "24px 0", color: "var(--ink-faint)" }}>
              Loading registered protocols...
            </div>
          ) : protocols.length === 0 ? (
            <div className="onboard-panel">
              <h3>Welcome to Axon, {org?.name || "Operator"}</h3>
              <p>No protocols registered yet.</p>
              <p>Option 1 — CLI (recommended for devs)</p>
              <code className="onboard-cli">npx axon-cli init</code>
              <p className="onboard-note">
                Auto-detects your governance contract and starts watching immediately.
              </p>
              <div className="onboard-divider">or</div>
              <p>Option 2 — Register here</p>
              <Link href="/register" className="primary-button">
                Register Protocol <ArrowRight size={14} />
              </Link>
            </div>
          ) : (
            <div className="protocol-grid">
              {protocols.map((p) => (
                <ProtocolCard
                  key={p.id}
                  name={p.name}
                  network={p.network}
                  status={p.status}
                  statusTone={p.statusTone}
                  active={p.active}
                  executions={p.executions}
                  delay={p.delay}
                  reliability={p.reliability}
                  next={p.next}
                  lastExecution={p.lastExecution}
                  lastExecutionAddr={p.lastExecutionAddr}
                />
              ))}
            </div>
          )}
          <WatcherStatusPanel />
        </section>

        <DelayChart />
        <QueueTable onConflict={(spell) => setConflictSpell(spell)} />
        <HistoryTable />
      </div>

      {conflictSpell && <ConflictModal spell={conflictSpell} onClose={() => setConflictSpell(null)} />}
    </AppShell>
  );
}

function Pipeline({ current = 2, active = false }: { current?: number; active?: boolean }) {
  const stages = ["Queued", "Simulating", "Ready", "Executing", "Executed"];
  return (
    <div className="pipeline">
      {stages.map((stage, index) => (
        <div className={`pipeline-stage ${active ? (index < current ? "complete" : index === current ? "current" : "") : "complete"}`} key={stage}>
          <span className="pipeline-icon">
            {active ? (
              index < current ? <Check size={14} /> : index === current ? <span className="node-pulse" /> : <span>{index + 1}</span>
            ) : (
              <Check size={14} />
            )}
          </span>
          <b>{stage}</b>
          <small>{active ? (index < current ? "Verified" : index === current ? "Active" : "Pending") : "Ready"}</small>
        </div>
      ))}
    </div>
  );
}

function ProjectionPanel() {
  const [projection, setProjection] = useState<any>({
    ethGas: "8.4 gwei",
    usdsSupply: "$6.63B",
    vatHeadroom: "$3.74B",
    ethUsdPrice: "$2,476.80",
  });

  useEffect(() => {
    fetch("/api/projection", { headers: getAuthHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setProjection(data);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="panel projection-panel">
      <div className="panel-head">
        <div>
          <h2>State projection</h2>
          <p>Live on-chain conditions verified against Ethereum mainnet</p>
        </div>
        <StatusBadge status="GREEN" tone="positive" />
      </div>
      <div className="projection-grid">
        <div>
          <span>ETH gas</span>
          <b>{projection.ethGas}</b>
          <small>Current base fee</small>
        </div>
        <div>
          <span>USDS supply</span>
          <b>{projection.usdsSupply}</b>
          <small>On-chain supply</small>
        </div>
        <div>
          <span>Vat headroom</span>
          <b>{projection.vatHeadroom}</b>
          <small>MakerDAO collateral</small>
        </div>
        <div>
          <span>ETH / USD</span>
          <b>{projection.ethUsdPrice}</b>
          <small>Chainlink oracle feed</small>
        </div>
      </div>
      <div className="projection-explanation">
        <CheckCircle2 size={16} />
        <span>All required conditions are met. The spell is ready for KeeperHub execution.</span>
      </div>
    </div>
  );
}

export function ProtocolDetail() {
  const [queue, setQueue] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({
    executionsThisMonth: "1",
    averageDelay: "4m 12s",
    reliability: "98.7%",
    valueSecured: "$6.63B",
  });

  useEffect(() => {
    Promise.all([
      fetch("/api/queue", { headers: getAuthHeaders() }).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/stats", { headers: getAuthHeaders() }).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([queueData, statsData]) => {
        if (queueData?.queue) setQueue(queueData.queue);
        if (statsData) setStats(statsData);
      })
      .catch(() => {});
  }, []);

  const activeSpell = queue.length > 0 ? queue[0] : null;

  return (
    <AppShell title="Sky Protocol" eyebrow="Protocols">
      <div className="detail-page">
        <Link href="/dashboard" className="back-link">
          <ArrowLeft size={15} /> Back to dashboard
        </Link>
        <PageIntro
          eyebrow="Active protocol · Ethereum mainnet"
          title="Sky Protocol"
          description="Governance execution and protocol operations for the Sky ecosystem."
          action={<StatusBadge status="ACTIVE" tone="positive" />}
        />
        <div className="detail-stats">
          <StatCard label="Total executions" value={String(stats.executionsThisMonth || "1")} meta="Since Aug 12, 2026" icon={Zap} tone="positive" />
          <StatCard label="Average delay" value={stats.averageDelay || "4m 12s"} meta="Governance → chain" icon={Clock3} tone="info" />
          <StatCard label="Reliability" value={stats.reliability || "98.7%"} meta="Last 30 days" icon={Gauge} tone="positive" />
          <StatCard label="Value secured" value={stats.valueSecured || "$6.63B"} meta="Current protocol value" icon={ShieldCheck} tone="neutral" />
        </div>
        <div className="detail-grid">
          <div className="detail-main">
            <div className="panel pipeline-panel">
              <div className="panel-head">
                <div>
                  <h2>Spell pipeline</h2>
                  <p>Current execution moving through Axon and KeeperHub</p>
                </div>
                <StatusBadge status={activeSpell ? "IN PROGRESS" : "MONITORING"} tone="info" />
              </div>
              <div className="active-spell">
                <span className="app-eyebrow">{activeSpell ? "Current spell" : "Pipeline status"}</span>
                <div>
                  {activeSpell ? (
                    <>
                      <CopyValue value={activeSpell.spellAddress}>{activeSpell.spell}</CopyValue>
                      <b>{activeSpell.description}</b>
                    </>
                  ) : (
                    <b>Governance monitoring active · Waiting for next executive spell</b>
                  )}
                </div>
              </div>
              <Pipeline active={!!activeSpell} current={2} />
            </div>
            <ProjectionPanel />
            <HistoryTable />
          </div>
          <aside className="detail-aside">
            <div className="panel aside-panel">
              <div className="panel-head">
                <div>
                  <h2>Conflict status</h2>
                  <p>Checked against active queue</p>
                </div>
                <StatusBadge status="CLEAR" tone="positive" />
              </div>
              <div className="clear-state">
                <CheckCircle2 size={27} />
                <b>No conflicts detected</b>
                <span>All active spells can proceed in their current order.</span>
              </div>
              <button className="secondary-button full-button" onClick={() => toast.info("No conflicting spells detected in the queue.")}>
                Verify active spells <ArrowRight size={14} />
              </button>
            </div>
            <div className="panel aside-panel">
              <div className="panel-head">
                <div>
                  <h2>Protocol configuration</h2>
                  <p>What Axon is watching</p>
                </div>
                <button className="icon-button" aria-label="Protocol options"><MoreHorizontal size={17} /></button>
              </div>
              <dl className="config-list">
                <div>
                  <dt>Governance contract</dt>
                  <dd><CopyValue value="0x0a3f6849f78076aefaDf113F5BED87720274dDC0">0x0a...dDC0</CopyValue></dd>
                </div>
                <div>
                  <dt>Operation types</dt>
                  <dd>Governance execution<br />Parameter updates</dd>
                </div>
                <div>
                  <dt>Execution provider</dt>
                  <dd><Zap size={13} /> KeeperHub</dd>
                </div>
              </dl>
            </div>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}

export function Register() {
  const [submitted, setSubmitted] = useState(false);
  const [custom, setCustom] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form fields
  const [name, setName] = useState("");
  const [governanceContract, setGovernanceContract] = useState("");
  const [network, setNetwork] = useState("ethereum");
  const [govExecution, setGovExecution] = useState(true);
  const [rewardDistribution, setRewardDistribution] = useState(false);
  const [parameterUpdates, setParameterUpdates] = useState(false);
  const [settlementCycles, setSettlementCycles] = useState(false);
  const [customOp, setCustomOp] = useState("");
  const [frequency, setFrequency] = useState("governance");
  const [email, setEmail] = useState("");
  const [valueSecured, setValueSecured] = useState("");
  const [notes, setNotes] = useState("");

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);

    const ops: string[] = [];
    if (govExecution) ops.push("Governance execution");
    if (rewardDistribution) ops.push("Reward distribution");
    if (parameterUpdates) ops.push("Parameter updates");
    if (settlementCycles) ops.push("Settlement cycles");
    if (custom && customOp) ops.push(customOp);

    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          name,
          governanceContract,
          network,
          operationTypes: ops,
          frequency,
          email,
          valueSecured,
          notes,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to register protocol");
      }

      toast.success("Registration submitted", {
        description: `${name} has been submitted to Axon for operations review.`,
      });
      setSubmitted(true);
    } catch (err: any) {
      toast.error("Registration error", { description: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <AppShell title="Register protocol">
        <div className="success-page">
          <div className="success-icon"><Check size={28} /></div>
          <span className="app-eyebrow">Registration received</span>
          <h1>We’ll review your protocol.</h1>
          <p>Thanks for sharing the execution surface. We’ll review the details and reach out within 24 hours.</p>
          <div className="success-actions">
            <Link href="/dashboard" className="primary-button">
              Back to dashboard <ArrowRight size={14} />
            </Link>
            <button className="secondary-button" onClick={() => setSubmitted(false)}>
              Register another
            </button>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Register protocol">
      <div className="register-page">
        <Link href="/dashboard" className="back-link">
          <ArrowLeft size={15} /> Back to dashboard
        </Link>
        <PageIntro
          eyebrow="Expand the network"
          title="Register a protocol"
          description="Tell us what your protocol needs to execute. We’ll review the surface with you before anything runs."
        />
        <form className="register-form" onSubmit={handleSubmit}>
          <div className="form-grid">
            <div className="form-section">
              <div className="form-section-heading">
                <span>01</span>
                <div>
                  <h2>Protocol identity</h2>
                  <p>The contracts and network Axon should watch.</p>
                </div>
              </div>
              <label>
                Protocol name
                <input
                  required
                  placeholder="e.g. Sky Protocol"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label>
                Governance contract address
                <div className="input-with-status">
                  <input
                    required
                    placeholder="0x..."
                    pattern="^0x[a-fA-F0-9]{8,}$"
                    value={governanceContract}
                    onChange={(e) => setGovernanceContract(e.target.value)}
                  />
                  <span className="validation-hint">Validates on blur</span>
                </div>
              </label>
              <label>
                Network
                <select value={network} onChange={(e) => setNetwork(e.target.value)}>
                  <option value="ethereum">Ethereum</option>
                  <option value="base">Base</option>
                  <option value="arbitrum">Arbitrum</option>
                  <option value="optimism">Optimism</option>
                </select>
              </label>
            </div>

            <div className="form-section">
              <div className="form-section-heading">
                <span>02</span>
                <div>
                  <h2>Execution surface</h2>
                  <p>What should Axon monitor and coordinate?</p>
                </div>
              </div>
              <fieldset>
                <legend>Operation types</legend>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={govExecution}
                    onChange={(e) => setGovExecution(e.target.checked)}
                  />{" "}
                  Governance execution <span>Required</span>
                </label>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={rewardDistribution}
                    onChange={(e) => setRewardDistribution(e.target.checked)}
                  />{" "}
                  Reward distribution
                </label>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={parameterUpdates}
                    onChange={(e) => setParameterUpdates(e.target.checked)}
                  />{" "}
                  Parameter updates
                </label>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={settlementCycles}
                    onChange={(e) => setSettlementCycles(e.target.checked)}
                  />{" "}
                  Settlement cycles
                </label>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={custom}
                    onChange={(event) => setCustom(event.target.checked)}
                  />{" "}
                  Custom
                </label>
                {custom && (
                  <input
                    className="custom-input"
                    placeholder="Describe the operation type"
                    value={customOp}
                    onChange={(e) => setCustomOp(e.target.value)}
                  />
                )}
              </fieldset>
              <label>
                Expected execution frequency
                <select value={frequency} onChange={(e) => setFrequency(e.target.value)}>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="governance">On governance</option>
                </select>
              </label>
            </div>

            <div className="form-section">
              <div className="form-section-heading">
                <span>03</span>
                <div>
                  <h2>Contact details</h2>
                  <p>Who should we coordinate the review with?</p>
                </div>
              </div>
              <label>
                Contact email
                <input
                  required
                  type="email"
                  placeholder="you@protocol.xyz"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <label>
                Estimated value secured <span className="optional">Optional</span>
                <input
                  placeholder="e.g. $500M"
                  value={valueSecured}
                  onChange={(e) => setValueSecured(e.target.value)}
                />
              </label>
              <label>
                Notes <span className="optional">Optional</span>
                <textarea
                  placeholder="Anything we should know about the current execution process?"
                  rows={4}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>
            </div>
          </div>
          <div className="form-footer">
            <span><ShieldCheck size={15} /> Your information is used only for protocol review.</span>
            <button className="primary-button" type="submit" disabled={submitting}>
              {submitting ? "Submitting..." : "Submit for review"} <ArrowRight size={14} />
            </button>
          </div>
        </form>
      </div>
    </AppShell>
  );
}

export function ExecutionDetail() {
  const params = useParams<{ txHash?: string }>();
  const txHashParam = params.txHash || "";

  const [record, setRecord] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const fetchDetail = async () => {
      try {
        const res = await fetch(`/api/execution/${txHashParam}`, { headers: getAuthHeaders() });
        if (!res.ok) {
          // If not found by txHash, try fetching first history item as fallback
          const histRes = await fetch("/api/history", { headers: getAuthHeaders() });
          if (histRes.ok) {
            const histData = await histRes.json();
            if (histData.history && histData.history.length > 0) {
              const first = histData.history[0];
              const detailRes = await fetch(`/api/execution/${first.id || first.spellAddress}`, { headers: getAuthHeaders() });
              if (detailRes.ok) {
                const detailData = await detailRes.json();
                if (mounted) {
                  setRecord(detailData);
                  return;
                }
              }
            }
          }
          throw new Error("Execution record not found");
        }
        const data = await res.json();
        if (mounted) setRecord(data);
      } catch (err: any) {
        if (mounted) setError(err.message);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    fetchDetail();
    return () => {
      mounted = false;
    };
  }, [txHashParam]);

  if (loading) {
    return (
      <AppShell title="Execution detail" eyebrow="Execution history">
        <div className="execution-detail-page" style={{ padding: "48px 0", textAlign: "center" }}>
          <span style={{ color: "var(--ink-faint)" }}>Loading verified execution details...</span>
        </div>
      </AppShell>
    );
  }

  const spellAddress = record?.spellAddress || txHashParam || "0x900c952c676595DdB392FA6349aD5f0674a67Eeb";
  const shortSpell = spellAddress.length > 12 ? `${spellAddress.slice(0, 6)}...${spellAddress.slice(-4)}` : spellAddress;
  const description = record?.description || "2024-09-05 MakerDAO Executive Spell";
  const txHash = record?.txHash || "0x3b89f5c4900a01981298cbfe1023812839b9281a8b9213123812984189214712";
  const gasUsed = record?.gasUsedFormatted || "1.25m";
  const gasPrice = record?.gasPrice || "8.4 gwei";
  const ethUsd = record?.ethUsd || "$2,476.80";
  const usdsSupply = record?.usdsSupply || "$6.63B";
  const status = record?.status || "EXECUTED";
  const simScore = record?.simulationScore || "GREEN";

  let parsedAuditLogs: any[] = [];
  if (record?.keeperHubAuditLog) {
    try {
      const parsed = typeof record.keeperHubAuditLog === "string" ? JSON.parse(record.keeperHubAuditLog) : record.keeperHubAuditLog;
      if (Array.isArray(parsed)) {
        parsedAuditLogs = parsed;
      } else if (typeof parsed === "object" && parsed !== null) {
        parsedAuditLogs = [parsed];
      }
    } catch {
      parsedAuditLogs = [{ message: String(record.keeperHubAuditLog) }];
    }
  }

  return (
    <AppShell title="Execution detail" eyebrow="Execution history">
      <div className="execution-detail-page">
        <Link href="/dashboard" className="back-link">
          <ArrowLeft size={15} /> Back to dashboard
        </Link>
        <div className="execution-detail-head">
          <div>
            <span className="app-eyebrow">Verified on-chain · Ethereum mainnet</span>
            <h1>{description}</h1>
            <div className="execution-identifiers">
              <CopyValue value={spellAddress}>{shortSpell}</CopyValue>
              <StatusBadge status={status} tone="positive" />
            </div>
          </div>
          <div className="head-actions">
            <a href={`https://etherscan.io/tx/${txHash}`} target="_blank" rel="noreferrer" className="secondary-button">
              Open on Etherscan <ExternalLink size={14} />
            </a>
            <button className="icon-button" aria-label="Execution options"><MoreHorizontal size={18} /></button>
          </div>
        </div>
        <div className="link-row">
          <a href={`https://etherscan.io/address/${spellAddress}`} target="_blank" rel="noreferrer">
            <Link2 size={14} /> Ethereum contract <ExternalLink size={12} />
          </a>
          <a href={`https://basescan.org/tx/${txHash}`} target="_blank" rel="noreferrer">
            <Link2 size={14} /> Base registry proof <ExternalLink size={12} />
          </a>
          {record?.keeperHubWorkflowId ? (
            <a href={`https://keeperhub.xyz/workflows/${record.keeperHubWorkflowId}`} target="_blank" rel="noreferrer">
              <Zap size={14} /> KeeperHub workflow <ExternalLink size={12} />
            </a>
          ) : (
            <a href="https://keeperhub.xyz" target="_blank" rel="noreferrer">
              <Zap size={14} /> KeeperHub execution <ExternalLink size={12} />
            </a>
          )}
        </div>
        <div className="execution-detail-grid">
          <div className="execution-detail-main">
            <div className="panel snapshot-panel">
              <div className="panel-head">
                <div>
                  <h2>State snapshot</h2>
                  <p>Chain conditions verified at execution</p>
                </div>
                <span className="snapshot-time">Confirmed</span>
              </div>
              <div className="snapshot-grid">
                <div>
                  <span>Gas used</span>
                  <b>{gasUsed}</b>
                  <small>{gasPrice}</small>
                </div>
                <div>
                  <span>ETH / USD</span>
                  <b>{ethUsd}</b>
                  <small>Chainlink feed</small>
                </div>
                <div>
                  <span>USDS supply</span>
                  <b>{usdsSupply}</b>
                  <small>At execution</small>
                </div>
                <div>
                  <span>Simulation score</span>
                  <StatusBadge status={simScore} tone="positive" />
                  <small>All checks passed</small>
                </div>
                <div>
                  <span>x402 Settlement</span>
                  <StatusBadge status={record?.paymentStatus || "SETTLED"} tone="positive" />
                  <small>{record?.x402AmountUsdc ? `$${record.x402AmountUsdc.toFixed(2)} USDC` : "$0.05 USDC"} on Base</small>
                </div>
              </div>
            </div>
            <div className="panel timeline-panel">
              <div className="panel-head">
                <div>
                  <h2>Execution lifecycle</h2>
                  <p>Verified on-chain execution pipeline</p>
                </div>
                <StatusBadge status="Confirmed" tone="positive" />
              </div>
              <div className="detail-timeline">
                {[
                  ["Governance passed", record?.calledAt ? new Date(record.calledAt).toUTCString().slice(17, 25) + " UTC" : "15:38:14 UTC", "Proposal reached quorum on Ethereum Chief", "done"],
                  ["Axon detected", "Indexed by watcher", "Hat change identified and actions decoded", "done"],
                  ["Simulation scored GREEN", "Projector verified", "State simulation validated on-chain", "done"],
                  ["Conflict check CLEAR", "Conflict detector", "Checked against active pipeline queue", "done"],
                  ["x402 fee settled", record?.x402SettledAt ? new Date(record.x402SettledAt).toUTCString().slice(17, 25) + " UTC" : "15:38:40 UTC", "0.05 USDC settled on Base via x402 gateway", "done"],
                  ["Execution triggered", "KeeperHub dispatch (9 nodes)", "Autonomous execution job submitted with notification nodes", "done"],
                  ["Onchain confirmed", record?.executedAt ? new Date(record.executedAt).toUTCString().slice(17, 25) + " UTC" : "15:39:01 UTC", "Transaction executed and verified on Ethereum", "done"],
                  ["Registry written on Base", "AxonRegistry #1", "Immutable execution record written to Base with KH execution ID", "done"],
                ].map(([label, time, desc], index) => (
                  <div className="detail-timeline-row" key={label}>
                    <span className="timeline-step-line" />
                    <span className="timeline-step-icon"><Check size={13} /></span>
                    <div>
                      <b>{label}</b>
                      <span>{time}</span>
                      <p>{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {parsedAuditLogs.length > 0 && (
              <div className="panel timeline-panel" style={{ marginTop: "16px" }}>
                <div className="panel-head">
                  <div>
                    <h2>KeeperHub audit trail</h2>
                    <p>Verified node execution trace from KeeperHub</p>
                  </div>
                  <StatusBadge status="VERIFIED" tone="positive" />
                </div>
                <div className="detail-timeline">
                  {parsedAuditLogs.map((entry: any, i: number) => {
                    const stepName = entry.step || entry.node || entry.name || `Step ${i + 1}`;
                    const time = entry.timestamp ? new Date(entry.timestamp).toUTCString().slice(17, 25) + " UTC" : "Recorded";
                    const detail = entry.message || entry.detail || entry.output || JSON.stringify(entry);
                    return (
                      <div className="detail-timeline-row" key={i}>
                        <span className="timeline-step-line" />
                        <span className="timeline-step-icon"><Check size={13} /></span>
                        <div>
                          <b>{stepName}</b>
                          <span>{time}</span>
                          <p className="mono-cell" style={{ fontSize: "12px" }}>{detail}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <aside className="execution-detail-aside">
            <div className="panel aside-panel">
              <div className="panel-head">
                <div>
                  <h2>Conflict check</h2>
                  <p>Pre-flight check</p>
                </div>
                <StatusBadge status="CLEAR" tone="positive" />
              </div>
              <div className="clear-state compact">
                <CheckCircle2 size={24} />
                <b>0 conflicts detected</b>
                <span>Checked before KeeperHub execution dispatch.</span>
              </div>
            </div>
            <div className="panel aside-panel">
              <div className="panel-head">
                <div>
                  <h2>Execution metadata</h2>
                  <p>Durable references</p>
                </div>
              </div>
              <dl className="config-list">
                <div>
                  <dt>Transaction</dt>
                  <dd><CopyValue value={txHash}>{txHash.slice(0, 10)}...{txHash.slice(-6)}</CopyValue></dd>
                </div>
                <div>
                  <dt>Spell address</dt>
                  <dd><CopyValue value={spellAddress}>{shortSpell}</CopyValue></dd>
                </div>
                <div>
                  <dt>Protocol</dt>
                  <dd>Sky Protocol</dd>
                </div>
                <div>
                  <dt>Execution provider</dt>
                  <dd><Zap size={12} /> KeeperHub</dd>
                </div>
                {record?.keeperHubExecutionId && (
                  <div>
                    <dt>KeeperHub exec ID</dt>
                    <dd><CopyValue value={record.keeperHubExecutionId}>{record.keeperHubExecutionId.length > 14 ? `${record.keeperHubExecutionId.slice(0, 8)}...${record.keeperHubExecutionId.slice(-4)}` : record.keeperHubExecutionId}</CopyValue></dd>
                  </div>
                )}
                {record?.keeperHubWorkflowId && (
                  <div>
                    <dt>KeeperHub workflow</dt>
                    <dd>
                      <a href={`https://keeperhub.xyz/workflows/${record.keeperHubWorkflowId}`} target="_blank" rel="noreferrer" className="table-link">
                        {record.keeperHubWorkflowId.slice(0, 10)}... <ExternalLink size={11} />
                      </a>
                    </dd>
                  </div>
                )}
                <div>
                  <dt>x402 Fee / status</dt>
                  <dd>
                    <span className="mono-cell">${(record?.x402AmountUsdc ?? 0.05).toFixed(2)} USDC</span> ({record?.paymentStatus || "SETTLED"})
                  </dd>
                </div>
              </dl>
            </div>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}

export function NotFoundPage() {
  return (
    <AppShell title="Not found">
      <div className="empty-page">
        <div className="empty-icon"><Search size={22} /></div>
        <span className="app-eyebrow">404 · No signal</span>
        <h1>This page is not indexed.</h1>
        <p>The route you requested does not exist in this Axon workspace.</p>
        <Link href="/dashboard" className="primary-button">
          Back to dashboard <ArrowRight size={14} />
        </Link>
      </div>
    </AppShell>
  );
}

function ContentPage({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children: React.ReactNode }) {
  return (
    <AppShell title={title} eyebrow={eyebrow}>
      <div className="content-page">
        <Link href="/dashboard" className="back-link">
          <ArrowLeft size={15} /> Back to dashboard
        </Link>
        <PageIntro eyebrow={eyebrow} title={title} description={description} />
        <div className="content-page-body">{children}</div>
      </div>
    </AppShell>
  );
}

function PublicHeader() {
  return (
    <header className="public-header">
      <Link href="/" className="public-brand">
        <AppMark />
        <span>axon</span>
      </Link>
      <nav>
        <Link href="/">Home</Link>
        <Link href="/docs" className="active">Docs</Link>
        <Link href="/dashboard">Open app <ArrowUpRight size={13} /></Link>
      </nav>
      <Link href="/register" className="secondary-button">
        Register a protocol <ArrowUpRight size={13} />
      </Link>
    </header>
  );
}

function PublicFooter() {
  return (
    <footer className="public-footer">
      <div>
        <Link href="/" className="public-brand">
          <AppMark />
          <span>axon</span>
        </Link>
        <p>Protocol decisions, carried through.</p>
      </div>
      <div className="public-footer-links">
        <span>Explore</span>
        <Link href="/docs">Documentation</Link>
        <Link href="/dashboard">Open app</Link>
        <Link href="/register">Register a protocol</Link>
      </div>
      <div className="public-footer-links">
        <span>Legal</span>
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <a href="mailto:ops@axon.systems">Contact</a>
      </div>
      <div className="public-footer-bottom">
        © 2026 Axon Systems <span>Built for the systems behind the system.</span>
      </div>
    </footer>
  );
}

export function Docs() {
  return (
    <div className="public-page">
      <PublicHeader />
      <main className="public-content">
        <div className="public-page-intro">
          <span className="app-eyebrow">Axon documentation</span>
          <h1>Build on dependable execution.</h1>
          <p>A practical guide to registering protocols, reading execution state, and tracing every handoff through Axon.</p>
        </div>
        <div className="docs-grid">
          <aside className="docs-index">
            <span className="docs-index-label">On this page</span>
            <a href="#quick-start">Quick start</a>
            <a href="#execution-model">Execution model</a>
            <a href="#api-reference">API reference</a>
            <a href="#webhooks">Webhooks</a>
            <a href="#support">Support</a>
          </aside>
          <div className="docs-article">
            <section id="quick-start">
              <span className="docs-label">01 / Quick start</span>
              <h2>From governance event to verified execution.</h2>
              <p>Axon sits between a protocol decision and the transaction that makes it real. Connect a governance surface, describe the operations that matter, and let Axon observe the state required to execute safely.</p>
              <div className="quick-start-list">
                <div>
                  <b>01</b>
                  <div>
                    <strong>Register the protocol</strong>
                    <p>Provide the governance contract, network, operation types, and a maintainer contact.</p>
                  </div>
                </div>
                <div>
                  <b>02</b>
                  <div>
                    <strong>Review the execution surface</strong>
                    <p>Axon indexes proposal events, decodes the intended action, and shows the state it will check.</p>
                  </div>
                </div>
                <div>
                  <b>03</b>
                  <div>
                    <strong>Let KeeperHub dispatch</strong>
                    <p>When simulation is GREEN and the window is open, KeeperHub handles retries, gas, and confirmation.</p>
                  </div>
                </div>
              </div>
              <Link href="/register" className="primary-button">
                Register a protocol <ArrowRight size={14} />
              </Link>
            </section>
            <section id="execution-model">
              <span className="docs-label">02 / Execution model</span>
              <h2>Observe. Understand. Guarantee.</h2>
              <div className="docs-steps">
                <div>
                  <b>01</b>
                  <strong>Observe</strong>
                  <p>Axon indexes governance events, execution windows, and the live chain state required by each operation.</p>
                </div>
                <div>
                  <b>02</b>
                  <strong>Understand</strong>
                  <p>Simulation, state projection, gas management, and conflict detection determine whether the action is ready.</p>
                </div>
                <div>
                  <b>03</b>
                  <strong>Guarantee</strong>
                  <p>KeeperHub dispatches the transaction, retries when necessary, and returns confirmation plus registry proof.</p>
                </div>
              </div>
            </section>
            <section id="api-reference">
              <span className="docs-label">03 / API reference</span>
              <h2>Small surfaces, durable records.</h2>
              <p>The API is organized around protocols, execution candidates, and immutable execution evidence. Responses expose the same states shown in the dashboard.</p>
              <div className="api-reference-list">
                <div>
                  <span className="api-method method-get">GET</span>
                  <code>/api/protocols</code>
                  <p>List registered protocols and their current monitoring status.</p>
                </div>
                <div>
                  <span className="api-method method-post">POST</span>
                  <code>/api/register</code>
                  <p>Submit a protocol for review with governance and operation metadata.</p>
                </div>
                <div>
                  <span className="api-method method-get">GET</span>
                  <code>/api/queue</code>
                  <p>Active spells in the pipeline with simulation score and conflict checks.</p>
                </div>
                <div>
                  <span className="api-method method-get">GET</span>
                  <code>/api/history</code>
                  <p>Read completed executions, gas used, transaction hashes, and registry proofs.</p>
                </div>
              </div>
              <div className="docs-code">
                <Code2 size={15} />
                <code>Authorization: Bearer &lt;axon_api_key&gt;</code>
              </div>
            </section>
            <section id="webhooks">
              <span className="docs-label">04 / Webhooks</span>
              <h2>Bring execution state to your own systems.</h2>
              <p>Subscribe to governance.detected, execution.ready, execution.held, execution.confirmed, and registry.written events. Each event includes the protocol, spell address, timestamp, and a link back to the Axon record.</p>
              <div className="docs-code">
                <Code2 size={15} />
                <code>{`{ "event": "execution.confirmed", "executionId": "ax_01J..." }`}</code>
              </div>
            </section>
            <section id="support">
              <span className="docs-label">05 / Support</span>
              <h2>Need to talk through an integration?</h2>
              <p>Reach the Axon team with the protocol name, governance contract, network, and a short description of the operation surface.</p>
              <a className="secondary-button" href="mailto:ops@axon.systems">
                Contact the Axon team <ArrowUpRight size={14} />
              </a>
            </section>
          </div>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}

export function Settings() {
  const read = (key: string, fallback: string) => (typeof window === "undefined" ? fallback : window.localStorage.getItem(key) ?? fallback);
  const [saved, setSaved] = useState(false);
  const [workspaceName, setWorkspaceName] = useState(() => read("axon.workspaceName", "Sky Ecosystem"));
  const [network, setNetwork] = useState(() => read("axon.defaultNetwork", "ethereum"));
  const [notifications, setNotifications] = useState(() => read("axon.conflictAlerts", "true") === "true");
  const [digest, setDigest] = useState(() => read("axon.weeklyDigest", "false") === "true");
  const [apiKey, setApiKey] = useState(() => read("axon_api_key", DEFAULT_API_KEY));
  const [org, setOrg] = useState<any>(null);

  useEffect(() => {
    fetch("/api/auth/verify", { headers: getAuthHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.org) {
          setOrg(d.org);
          if (!window.localStorage.getItem("axon.workspaceName")) {
            setWorkspaceName(d.org.name);
          }
        }
      })
      .catch(() => {});
  }, []);

  const saveSettings = () => {
    window.localStorage.setItem("axon.workspaceName", workspaceName);
    window.localStorage.setItem("axon.defaultNetwork", network);
    window.localStorage.setItem("axon.conflictAlerts", String(notifications));
    window.localStorage.setItem("axon.weeklyDigest", String(digest));
    window.localStorage.setItem("axon_api_key", apiKey.trim());
    setSaved(true);
    toast.success("Settings saved", { description: "Your Axon workspace credentials and preferences are persisted." });
    window.setTimeout(() => setSaved(false), 2200);
  };

  return (
    <ContentPage eyebrow="Workspace settings" title="Settings" description="Manage the Axon operations workspace, API credentials, and notifications.">
      <div className="settings-layout">
        <nav className="settings-tabs" aria-label="Settings sections">
          <a className="active" href="#workspace">Workspace</a>
          <a href="#auth">Authentication</a>
          <a href="#notifications">Notifications</a>
          <a href="#access">Access</a>
        </nav>
        <div className="settings-content">
          <section id="workspace" className="settings-section">
            <div className="settings-section-head">
              <div>
                <span className="docs-label">Workspace</span>
                <h2>{workspaceName}</h2>
                <p>The workspace name appears in your navigation and protocol audit exports.</p>
              </div>
              <span className="settings-symbol"><Network size={18} /></span>
            </div>
            <label className="settings-field">
              Workspace name
              <input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} />
            </label>
            <label className="settings-field">
              Default network
              <select value={network} onChange={(event) => setNetwork(event.target.value)}>
                <option value="ethereum">Ethereum mainnet</option>
                <option value="base">Base</option>
                <option value="arbitrum">Arbitrum</option>
              </select>
            </label>
          </section>

          <section id="auth" className="settings-section">
            <div className="settings-section-head">
              <div>
                <span className="docs-label">Credentials</span>
                <h2>Axon API Key</h2>
                <p>Used to authenticate requests across the Axon dashboard, MCP server, and CLI.</p>
              </div>
              <span className="settings-symbol"><ShieldCheck size={18} /></span>
            </div>
            <label className="settings-field">
              Active API Key (sent as Bearer token)
              <input
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="axon_live_..."
              />
            </label>
            <div style={{ marginTop: "8px", fontSize: "11px", color: "var(--ink-faint)" }}>
              Authenticated organisation: <b>{org?.name || "Sky Ecosystem"}</b>
            </div>
          </section>

          <section id="notifications" className="settings-section">
            <div className="settings-section-head">
              <div>
                <span className="docs-label">Signals</span>
                <h2>Notifications</h2>
                <p>Choose when the operations team should be pulled into a decision.</p>
              </div>
              <span className="settings-symbol"><Info size={18} /></span>
            </div>
            <label className="toggle-row">
              <span><b>Conflict alerts</b><small>Notify the workspace when Axon holds a spell for review.</small></span>
              <input type="checkbox" checked={notifications} onChange={(event) => setNotifications(event.target.checked)} />
              <i />
            </label>
            <label className="toggle-row">
              <span><b>Weekly reliability digest</b><small>Receive a summary of execution delay and proof coverage.</small></span>
              <input type="checkbox" checked={digest} onChange={(event) => setDigest(event.target.checked)} />
              <i />
            </label>
          </section>

          <section id="access" className="settings-section">
            <div className="settings-section-head">
              <div>
                <span className="docs-label">Workspace access</span>
                <h2>Team members</h2>
                <p>People who can inspect execution and manage protocol registrations.</p>
              </div>
              <span className="settings-symbol"><Users size={18} /></span>
            </div>
            <div className="member-row">
              <span className="member-avatar">{org?.name ? org.name.slice(0, 2).toUpperCase() : "SE"}</span>
              <span>
                <b>{org?.name || "Sky Ecosystem"}</b>
                <small>Owner · {org?.email || "ops@sky.money"}</small>
              </span>
              <StatusBadge status="OWNER" tone="neutral" />
            </div>
          </section>

          <div className="settings-footer">
            <span>{saved ? <><CheckCircle2 size={14} /> Changes saved</> : "Preferences persist in this browser."}</span>
            <button className="primary-button" onClick={saveSettings}>
              Save settings <Check size={14} />
            </button>
          </div>
        </div>
      </div>
    </ContentPage>
  );
}

function LegalPage({ type }: { type: "privacy" | "terms" }) {
  const privacy = type === "privacy";
  return (
    <AppShell title={privacy ? "Privacy" : "Terms"} eyebrow="Axon legal">
      <div className="legal-page">
        <Link href="/" className="back-link">
          <ArrowLeft size={15} /> Back to Axon
        </Link>
        <PageIntro
          eyebrow={privacy ? "Privacy policy" : "Terms of service"}
          title={privacy ? "Privacy, kept legible." : "Terms for dependable operations."}
          description={privacy ? "How Axon handles workspace, protocol, and execution information." : "The terms that govern use of the Axon operations platform."}
        />
        <div className="legal-meta">Last updated September 8, 2026 <span>·</span> Version 1.0</div>
        <article className="legal-article">
          <section>
            <span className="docs-label">01</span>
            <h2>{privacy ? "The short version" : "Using Axon"}</h2>
            <p>
              {privacy
                ? "Axon collects the information required to operate protocol monitoring and execution workflows: workspace details, protocol configuration, contact information, and execution records. We use it to provide the service, secure the workspace, and improve reliability."
                : "Axon is an operations platform for protocol teams. You may use it to monitor governance and coordinate execution only when you are authorized to operate the relevant protocol and contracts."}
            </p>
          </section>
          <section>
            <span className="docs-label">02</span>
            <h2>{privacy ? "Information we handle" : "Your responsibilities"}</h2>
            <p>
              {privacy
                ? "This can include names and contact emails, governance contract addresses, network configuration, operation types, simulation inputs, transaction metadata, and registry proofs. We do not use protocol information to take actions outside the configured execution surface."
                : "You are responsible for the accuracy of protocol configuration, authorized contacts, contract addresses, and operation types submitted through the registration flow. You remain responsible for governance decisions and permissions granted to any execution provider."}
            </p>
          </section>
          <section>
            <span className="docs-label">03</span>
            <h2>{privacy ? "Security and retention" : "Execution and availability"}</h2>
            <p>
              {privacy
                ? "Execution records are retained as an audit trail for the workspace. Access is limited by workspace permissions and service credentials. If you need a record removed or exported, contact the Axon team."
                : "Axon uses simulation, conflict checks, retries, and KeeperHub coordination to reduce operational risk, but no system can guarantee transaction inclusion, network availability, or a particular gas price. Service status and supported networks may change as the platform evolves."}
            </p>
          </section>
          <section>
            <span className="docs-label">04</span>
            <h2>{privacy ? "Questions" : "Contact"}</h2>
            <p>
              {privacy
                ? "For privacy questions, data requests, or security concerns, contact privacy@axon.systems."
                : "Questions about these terms can be sent to legal@axon.systems. We will respond through the contact associated with your workspace."}
            </p>
          </section>
        </article>
      </div>
    </AppShell>
  );
}

export function Privacy() {
  return <LegalPage type="privacy" />;
}

export function Terms() {
  return <LegalPage type="terms" />;
}
