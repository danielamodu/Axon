import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Clock3,
  Database,
  ExternalLink,
  FileCheck2,
  GitBranch,
  LockKeyhole,
  Menu,
  Network,
  Play,
  Radio,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Workflow,
  X,
  Zap,
} from "lucide-react";

type Direction = "quiet" | "grid" | "ledger";

const directionMeta: Record<Direction, { label: string; descriptor: string }> = {
  quiet: { label: "Quiet Operations", descriptor: "Spacious institutional" },
  grid: { label: "Blackline Network", descriptor: "Technical observability" },
  ledger: { label: "Dispatch Ledger", descriptor: "Editorial infrastructure" },
};

function scrollToSection(id: string) {
  const target = document.getElementById(id);
  if (!target) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
}

function AnimatedMetric({ value, suffix = "", decimals = 0 }: { value: number; suffix?: string; decimals?: number }) {
  const [displayValue, setDisplayValue] = useState(0);
  const metricRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const node = metricRef.current;
    if (!node) return;
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let started = false;
    const animate = () => {
      const startedAt = performance.now();
      const duration = 950;
      const tick = (now: number) => {
        const progress = Math.min((now - startedAt) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        setDisplayValue(value * eased);
        if (progress < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    };
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !started) {
        started = true;
        if (prefersReducedMotion) setDisplayValue(value);
        else animate();
        observer.disconnect();
      }
    }, { threshold: 0.55 });
    observer.observe(node);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [value]);
  return <span ref={metricRef}>{displayValue.toFixed(decimals)}{suffix}</span>;
}

function AxonMark({ inverse = false }: { inverse?: boolean }) {
  return (
    <span className={`axon-mark ${inverse ? "axon-mark-inverse" : ""}`} aria-hidden="true">
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

function DirectionPicker({ direction, setDirection }: { direction: Direction; setDirection: (value: Direction) => void }) {
  return (
    <div className="direction-picker" aria-label="Landing page directions">
      <div className="picker-intro">
        <span className="picker-kicker"><Sparkles size={12} /> Prototype set</span>
        <span className="picker-title">Choose the first impression</span>
      </div>
      <div className="picker-options" role="tablist" aria-label="Choose a visual direction">
        {(Object.keys(directionMeta) as Direction[]).map((item, index) => (
          <button
            key={item}
            role="tab"
            aria-selected={direction === item}
            className={`picker-option ${direction === item ? "is-active" : ""}`}
            onClick={() => setDirection(item)}
          >
            <span className="picker-number">0{index + 1}</span>
            <span>
              <strong>{directionMeta[item].label}</strong>
              <small>{directionMeta[item].descriptor}</small>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function QuietHeader() {
  return (
    <header className="site-header quiet-header">
      <a className="brand" href="#top" aria-label="Axon home">
        <AxonMark />
        <span>axon</span>
      </a>
      <nav className="header-nav" aria-label="Primary navigation">
        <a href="#model">How it works</a>
        <a href="#maintainers">For maintainers</a>
        <a href="/dashboard">Open app <ArrowUpRight size={13} /></a>
        <a href="/docs">Docs <ArrowUpRight size={13} /></a>
      </nav>
      <button className="header-cta" onClick={() => scrollToSection("maintainers")}>Register a protocol <ArrowUpRight size={16} /></button>
      <button className="mobile-menu" aria-label="Open navigation"><Menu size={20} /></button>
    </header>
  );
}

function QuietExecutionPanel() {
  return (
    <figure className="quiet-hero-art">
      <img src="/manus-storage/hero-axon-city_0691f17e.png" alt="Stippled graphite illustration of a city skyline with a bridge and tower" />
      <figcaption><span>AXON / INFRASTRUCTURE IN MOTION</span><span>01 — 04</span></figcaption>
    </figure>
  );
}

function QuietDirection() {
  useEffect(() => {
    const revealNodes = Array.from(document.querySelectorAll<HTMLElement>(".quiet-page .reveal-on-scroll"));
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      revealNodes.forEach(node => node.classList.add("is-visible"));
      return;
    }
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.14, rootMargin: "0px 0px -8% 0px" });
    revealNodes.forEach(node => observer.observe(node));
    return () => observer.disconnect();
  }, []);
  return (
    <main className="direction-page quiet-page" id="top">
      <QuietHeader />
      <section className="quiet-hero">
        <div className="quiet-hero-copy reveal-up">
          <h1>When governance passes, <em>execution</em> should not wait.</h1>
          <p className="hero-lede">Axon watches the decision, understands the handoff, and guarantees the next action through KeeperHub—with every step observable and accountable.</p>
          <div className="hero-actions">
            <a className="button button-dark" href="/dashboard">Open Axon app <ArrowRight size={17} /></a>
            <a className="text-link" href="#maintainers">For protocol maintainers <ArrowUpRight size={16} /></a>
          </div>
          <div className="hero-trust"><span><LockKeyhole size={14} /> No opaque automation</span><span><CheckCircle2 size={14} /> Full audit trail</span></div>
        </div>
        <QuietExecutionPanel />
      </section>
      <section className="quiet-proof reveal-on-scroll" aria-label="Axon execution handoff">
        <div className="proof-intro"><span className="eyebrow">The handoff</span><p>From a passed vote to a verified result.</p></div>
        <div className="proof-item"><span className="proof-index">01</span><span><b>Governance detected</b><small>Source decision and block captured</small></span></div>
        <div className="proof-item"><span className="proof-index">02</span><span><b>Execution simulated</b><small>State, gas, and conflicts checked</small></span></div>
        <div className="proof-item"><span className="proof-index">03</span><span><b>Result verified</b><small>Onchain proof and registry record</small></span></div>
      </section>
      <section className="quiet-capabilities reveal-on-scroll" id="capabilities">
        <div className="capabilities-intro"><span className="section-kicker"><span className="kicker-rule" /> What stays visible</span><h2>Reliable execution is a chain of small certainties.</h2><p>Axon keeps the important parts of the handoff legible: what changed, what was checked, who owns the next step, and where the proof lives.</p></div>
        <div className="capability-grid">
          <article className="capability-card reveal-on-scroll stagger-1"><span className="capability-number">01</span><GitBranch size={19} /><h3>Governance intent</h3><p>See the proposal, source block, quorum result, and operation Axon interpreted before anything moves.</p><a href="#model">Understand the model <ArrowUpRight size={14} /></a></article>
          <article className="capability-card reveal-on-scroll stagger-2"><span className="capability-number">02</span><ShieldCheck size={19} /><h3>Execution confidence</h3><p>Simulation, gas, state projection, and conflict checks make readiness a visible condition—not a guess.</p><a href="#model">See what gets checked <ArrowUpRight size={14} /></a></article>
          <article className="capability-card reveal-on-scroll stagger-3"><span className="capability-number">03</span><FileCheck2 size={19} /><h3>Durable proof</h3><p>Every attempt, acknowledgement, transaction, and registry record stays connected in one audit trail.</p><a href="#maintainers">Talk to the team <ArrowUpRight size={14} /></a></article>
        </div>
      </section>
      <section className="quiet-evidence reveal-on-scroll" id="evidence">
        <div className="evidence-intro"><span className="section-kicker"><span className="kicker-rule" /> Evidence, not promises</span><h2>Every handoff leaves a trace.</h2><p>Axon makes the operational path inspectable for the people who need to trust it—and the people who need to explain it later.</p><a className="text-link" href="/docs#proofs">Read the documentation <ArrowUpRight size={15} /></a></div>
        <div className="evidence-panel reveal-on-scroll stagger-2"><div className="evidence-panel-head"><span>Sky Protocol / Executive Spell / 0x900c...7Eeb</span><span className="evidence-status"><span className="status-dot live" /> Registry proof written</span></div><div className="evidence-metrics"><div><b><AnimatedMetric value={1} /></b><span>execution verified</span></div><div><b><AnimatedMetric value={4.2} suffix="m" decimals={1} /></b><span>average delay</span></div><div><b><AnimatedMetric value={98.7} suffix="%" decimals={1} /></b><span>reliability / 30d</span></div></div><div className="evidence-record"><div className="evidence-record-row"><span className="evidence-icon"><Check size={13} /></span><div><b>Governance passed</b><small>Sky Chief hat updated · block 21,046,704</small></div><time>15:38:14</time></div><div className="evidence-record-row"><span className="evidence-icon"><Check size={13} /></span><div><b>Simulation scored GREEN</b><small>8.4 gwei gas · $3.74B Vat headroom · 0 conflicts</small></div><time>15:38:22</time></div><div className="evidence-record-row"><span className="evidence-icon"><Check size={13} /></span><div><b>KeeperHub confirmed</b><small>1,248,921 gas used · block 21,046,744</small></div><time>15:39:01</time></div><div className="evidence-record-row"><span className="evidence-icon"><Check size={13} /></span><div><b>Registry proof written</b><small>Base AxonRegistry #1 · 0xBf4b...D70B</small></div><time>15:39:05</time></div></div><div className="evidence-panel-foot"><span><ShieldCheck size={14} /> 51 seconds total · $6.63B value secured</span><a href="/execution/0x900c952c676595DdB392FA6349aD5f0674a67Eeb">View full execution <ArrowRight size={14} /></a></div></div>
      </section>
      <section className="quiet-model reveal-on-scroll" id="model">
        <div className="model-intro"><span className="section-kicker"><span className="kicker-rule" /> Why Axon exists</span><h2>The decision is only the beginning.</h2><p>Protocols already know how to vote. The missing layer is the one that makes the outcome land—reliably, safely, and without asking a person to be awake at the right moment.</p></div>
        <div className="model-stack">
          <div className="model-row reveal-on-scroll stagger-1"><span className="model-num">01</span><div><span className="model-label">Observe</span><h3>Watch every governance surface.</h3><p>Axon tracks proposals, execution windows, chain state, and the conditions a spell needs before it can move.</p></div><ArrowDownRight size={20} /></div>
          <div className="model-row reveal-on-scroll stagger-2"><span className="model-num">02</span><div><span className="model-label">Understand</span><h3>Turn protocol intent into an execution plan.</h3><p>Simulation, gas management, conflict detection, and ordering logic make the next action legible before it starts.</p></div><ArrowDownRight size={20} /></div>
          <div className="model-row reveal-on-scroll stagger-3"><span className="model-num">03</span><div><span className="model-label">Guarantee</span><h3>Hand the action to KeeperHub.</h3><p>Retries, acknowledgements, onchain confirmation, and a registry proof stay connected in one audit trail.</p></div><ArrowUpRight size={20} /></div>
        </div>
      </section>
      <section className="quiet-maintainers" id="maintainers">
        <div><span className="section-kicker"><span className="kicker-rule" /> For protocol maintainers</span><h2>Your protocol keeps making decisions. Give them a reliable handoff.</h2></div>
        <div className="maintainer-action"><p>Register the contracts and operation types Axon should watch. We review the execution surface with you before anything runs.</p><a className="button button-light" href="/register">Register a protocol <ArrowUpRight size={17} /></a></div>
      </section>
      <QuietFooter />
    </main>
  );
}

function QuietFooter() {
  return <footer className="quiet-footer" id="footer"><div className="footer-main"><div className="footer-brand-block"><a className="brand" href="#top"><AxonMark /><span>axon</span></a><p>Protocol decisions, carried through.</p><span className="footer-meta">Built for the systems behind the system.</span></div><div className="footer-column"><span className="footer-column-label">Explore</span><a href="#model">How it works</a><a href="#capabilities">What Axon checks</a><a href="#maintainers">For maintainers</a></div><div className="footer-column"><span className="footer-column-label">Product</span><a href="/dashboard">Dashboard <ArrowUpRight size={13} /></a><a href="/register">Register a protocol <ArrowUpRight size={13} /></a><a href="/docs">Documentation <ArrowUpRight size={13} /></a></div><div className="footer-column"><span className="footer-column-label">Underlying provider</span><a href="https://keeperhub.xyz" target="_blank" rel="noreferrer">KeeperHub <ExternalLink size={13} /></a><span className="footer-caption">Dispatch, retry, gas management, and confirmation.</span></div></div><div className="footer-bottom"><span>© 2026 Axon Systems</span><span>Protocol infrastructure, made dependable.</span><span><a href="/privacy">Privacy</a> <span className="footer-separator">·</span> <a href="/terms">Terms</a></span></div></footer>;
}

function GridHeader() {
  return (
    <header className="site-header grid-header">
      <a className="brand brand-inverse" href="#grid-top"><AxonMark inverse /><span>axon</span></a>
      <div className="grid-header-mode"><span className="status-dot live" /> OPERATIONS / 24·7</div>
      <nav className="header-nav" aria-label="Primary navigation"><a href="#grid-model">System</a><a href="#grid-keepers">KeeperHub</a><a href="#grid-footer">Registry <ExternalLink size={13} /></a></nav>
      <button className="header-cta header-cta-inverse" onClick={() => scrollToSection("grid-keepers")}>Enter the network <ArrowUpRight size={16} /></button>
      <button className="mobile-menu mobile-menu-inverse" aria-label="Open navigation"><Menu size={20} /></button>
    </header>
  );
}

function NetworkDiagram() {
  return (
    <div className="network-stage" aria-label="Axon network diagram showing governance, simulation, KeeperHub and registry">
      <div className="network-stage-top"><span>AXON / EXECUTION GRAPH</span><span>LIVE <span className="status-dot live" /></span></div>
      <svg className="network-lines" viewBox="0 0 620 500" preserveAspectRatio="none" aria-hidden="true">
        <path d="M92 108 C180 108 164 235 282 235 S396 115 508 124" />
        <path d="M92 108 C192 108 205 380 326 380 S412 294 508 294" />
        <path d="M92 380 C188 380 214 235 282 235" />
        <path className="network-trace" d="M92 108 C180 108 164 235 282 235 S396 115 508 124" />
      </svg>
      <div className="network-node node-governance"><span className="node-symbol"><GitBranch size={16} /></span><b>GOVERNANCE</b><small>decision passed</small></div>
      <div className="network-node node-simulation"><span className="node-symbol"><Activity size={16} /></span><b>SIMULATION</b><small>state projection</small></div>
      <div className="network-node node-keeper"><span className="node-symbol"><Zap size={16} /></span><b>KEEPERHUB</b><small>dispatch / retry</small></div>
      <div className="network-node node-registry"><span className="node-symbol"><ShieldCheck size={16} /></span><b>REGISTRY</b><small>proof recorded</small></div>
      <div className="network-center"><span className="center-orbit orbit-a" /><span className="center-orbit orbit-b" /><AxonMark inverse /><small>AXON CORE</small></div>
      <div className="network-sidecard"><span className="sidecard-label">ACTIVE PATH</span><b>SKY / SPELL 0x3a…9f21</b><span><span className="status-dot live" /> awaiting keeper acknowledgement</span></div>
    </div>
  );
}

function GridDirection() {
  return (
    <main className="direction-page grid-page" id="grid-top">
      <GridHeader />
      <div className="grid-ruler"><span>01 — DECISION</span><span>02 — EXECUTION</span><span>03 — PROOF</span></div>
      <section className="grid-hero">
        <div className="grid-hero-copy reveal-up"><div className="grid-overline"><span className="live-signal" /> THE EXECUTION LAYER / 2026</div><h1>The network beneath <span>governance.</span></h1><p>Axon turns passed decisions into dependable protocol operations. It monitors, simulates, dispatches, and records what happened—without hiding the handoff behind a black box.</p><div className="grid-actions"><button className="grid-button" onClick={() => scrollToSection("grid-model")}><span><Play size={14} fill="currentColor" /> Trace an execution</span><ArrowUpRight size={16} /></button><a href="#grid-keepers" className="grid-text-link">Connect a protocol <ArrowRight size={15} /></a></div></div>
        <NetworkDiagram />
      </section>
      <section className="grid-model" id="grid-model"><div className="grid-section-head"><span>AXON / 01</span><h2>Every decision leaves a trace.</h2><p>Execution is not a single button. It is a sequence of verifiable states, with a clear owner at every step.</p></div><div className="grid-sequence"><div className="sequence-line" /><div className="sequence-item"><span className="sequence-index">01</span><div className="sequence-icon"><Radio size={18} /></div><span className="sequence-label">Listen</span><b>Governance signal</b><p>Proposal, block, quorum, and intent.</p></div><div className="sequence-item"><span className="sequence-index">02</span><div className="sequence-icon"><Activity size={18} /></div><span className="sequence-label">Check</span><b>State projection</b><p>Gas, oracle, headroom, conflicts.</p></div><div className="sequence-item"><span className="sequence-index">03</span><div className="sequence-icon"><Zap size={18} /></div><span className="sequence-label">Dispatch</span><b>KeeperHub execution</b><p>Retry logic, acknowledgement, proof.</p></div></div></section>
      <section className="grid-keepers" id="grid-keepers"><div className="grid-keepers-main"><span className="grid-overline"><span className="live-signal" /> OPEN REGISTRATION</span><h2>Protocol infrastructure needs an execution layer.</h2><p>Connect the contracts, operations, and people that keep your protocol moving. Axon brings the execution surface into view before it becomes urgent.</p><a href="/register" className="grid-button grid-button-accent"><span>Register your protocol</span><ArrowUpRight size={16} /></a></div><div className="grid-keepers-aside"><span>KEEPERHUB / UNDERLYING PROVIDER</span><p>Retries<br />Gas management<br />Simulation<br />Onchain confirmation</p><a href="#grid-footer">Read the system notes <ArrowRight size={14} /></a></div></section>
      <footer className="grid-footer" id="grid-footer"><a className="brand brand-inverse" href="#grid-top"><AxonMark inverse /><span>axon</span></a><span>protocol operations, observable by default</span><span>01 / 03</span></footer>
    </main>
  );
}

function LedgerHeader() {
  return <header className="site-header ledger-header"><a className="brand" href="#ledger-top"><AxonMark /><span>axon</span></a><span className="ledger-issue">ISSUE 001 / EXECUTION AS INFRASTRUCTURE</span><nav className="header-nav" aria-label="Primary navigation"><a href="#ledger-model">The premise</a><a href="/register">Register</a><a href="#ledger-footer">Notes <ExternalLink size={13} /></a></nav><a className="ledger-nav-button" href="/register">Start a conversation <ArrowUpRight size={16} /></a><button className="mobile-menu" aria-label="Open navigation"><Menu size={20} /></button></header>;
}

function LedgerTimeline() {
  const items = [
    { label: "Governance passed", meta: "BLOCK 21,046,731 · 15:38:14", state: "done" },
    { label: "Axon detected", meta: "15:38:16 · 2 sec later", state: "done" },
    { label: "Simulation scored GREEN", meta: "15:38:22 · 6 sec later", state: "done" },
    { label: "KeeperHub dispatch", meta: "15:38:24 · confirmed on-chain", state: "done" },
    { label: "Registry written", meta: "Base AxonRegistry #1", state: "done" },
  ];
  return <div className="ledger-timeline"><div className="ledger-timeline-head"><span>LIVE EXECUTION</span><span className="ledger-live"><span className="status-dot live" /> SKY / SPELL 0x900c…7Eeb</span></div>{items.map((item, index) => <div className={`ledger-timeline-row ${item.state}`} key={item.label}><span className="timeline-count">0{index + 1}</span><span className="timeline-dot">{item.state === "done" ? <Check size={11} /> : item.state === "current" ? <span className="node-pulse" /> : null}</span><span className="timeline-text"><b>{item.label}</b><small>{item.meta}</small></span>{item.state === "current" && <span className="timeline-live-label">IN PROGRESS</span>}</div>)}</div>;
}

function LedgerDirection() {
  return <main className="direction-page ledger-page" id="ledger-top"><LedgerHeader /><div className="ledger-sidebar"><span>AXON</span><span>THE HANDOFF</span><span>01—04</span></div><section className="ledger-hero"><div className="ledger-hero-copy reveal-up"><div className="ledger-kicker"><span>Field notes on protocol operations</span><span>September 2026</span></div><h1>A protocol passed.<br /><em>A system acts.</em></h1><p>Axon is the accountable handoff between governance intent and onchain execution. Not another dashboard. The layer that makes the outcome arrive.</p><div className="ledger-hero-actions"><button className="ledger-button" onClick={() => scrollToSection("ledger-model")}>Read the premise <ArrowDownRight size={16} /></button><span className="ledger-byline">For the people who keep protocols moving.</span></div></div><LedgerTimeline /></section><section className="ledger-model" id="ledger-model"><div className="ledger-model-number">01</div><div className="ledger-model-copy"><span className="ledger-kicker">THE GAP</span><h2>The vote is public.<br /><em>The handoff is not.</em></h2><p>When a governance decision passes, the protocol still depends on a small group of humans to notice, interpret, simulate, and press execute. That works—until it does not.</p><p>Axon makes the interval visible, then gives it a reliable owner. Every state has a timestamp. Every retry has a reason. Every result has a proof.</p></div><div className="ledger-margin-note"><span>Axon turns the interval<br />into infrastructure.</span><ArrowUpRight size={15} /></div></section><section className="ledger-figures"><div><b>24/7</b><span>Protocol watching</span></div><div><b>0</b><span>Opaque state changes</span></div><div><b>1</b><span>Connected audit trail</span></div><div className="ledger-figures-note">The system is quiet when everything is working.<br />That is the point.</div></section><section className="ledger-keepers" id="ledger-keepers"><div className="ledger-keepers-top"><span className="ledger-kicker">THE INVITATION</span><span>02 / REGISTRATION</span></div><h2>Make the next decision<br /><em>easier to trust.</em></h2><p>Tell us what your protocol needs to execute, and where the handoff currently breaks. Axon brings the contracts, conditions, maintainers, and proof into one operational surface.</p><a className="ledger-button ledger-button-dark" href="/register">Register a protocol <ArrowUpRight size={16} /></a></section><footer className="ledger-footer" id="ledger-footer"><a className="brand" href="#ledger-top"><AxonMark /><span>axon</span></a><span>Field notes for protocol infrastructure</span><span>AXON / 2026</span></footer></main>;
}

export default function Home() {
  return <div className="direction-lab direction-quiet"><QuietDirection /></div>;
}

export { DirectionPicker, QuietDirection, GridDirection, LedgerDirection };
