import { useEffect, useState } from "react";
import { ArrowRight, ArrowUpRight, Check, Copy, LockKeyhole } from "lucide-react";
import { Link, useLocation } from "wouter";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function getStoredKey(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem("axon_api_key");
}

export function passwordStrength(pw: string): { label: string; score: number } {
  let score = 0;
  if (pw.length >= 8) score += 1;
  if (pw.length >= 12) score += 1;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score += 1;
  if (/\d/.test(pw)) score += 1;
  if (/[^A-Za-z0-9]/.test(pw)) score += 1;
  if (score <= 2) return { label: "Weak", score };
  if (score <= 3) return { label: "Fair", score };
  if (score <= 4) return { label: "Good", score };
  return { label: "Strong", score };
}

/**
 * Protected-route guard. Requires a stored apiKey that still verifies
 * via GET /api/auth/me, otherwise redirects to /login.
 */
export function useRequireAuth() {
  const [, navigate] = useLocation();
  const [state, setState] = useState<{ loading: boolean; org: any | null }>({
    loading: true,
    org: null,
  });

  useEffect(() => {
    const key = getStoredKey();
    if (!key) {
      navigate("/login");
      return;
    }
    let cancelled = false;
    fetch("/api/auth/me", { headers: { Authorization: `Bearer ${key}` } })
      .then((r) => {
        if (r.status === 401) {
          window.localStorage.removeItem("axon_api_key");
          navigate("/login");
          return null;
        }
        return r.ok ? r.json() : null;
      })
      .then((data) => {
        if (!cancelled) setState({ loading: false, org: data });
      })
      .catch(() => {
        if (!cancelled) setState({ loading: false, org: null });
      });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return state;
}

function AuthShell({ children, title, lede }: { children: React.ReactNode; title: string; lede: string }) {
  return (
    <main className="auth-page">
      <div className="auth-card">
        <Link href="/" className="auth-brand">
          <span className="axon-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none">
              <path d="M7.5 7.5 16 16l8.5-8.5M7.5 24.5 16 16l8.5 8.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
              <circle cx="7.5" cy="7.5" r="2.5" fill="currentColor" />
              <circle cx="24.5" cy="7.5" r="2.5" fill="currentColor" />
              <circle cx="16" cy="16" r="2.8" fill="currentColor" />
              <circle cx="7.5" cy="24.5" r="2.5" fill="currentColor" />
              <circle cx="24.5" cy="24.5" r="2.5" fill="currentColor" />
            </svg>
          </span>
          <span>axon</span>
        </Link>
        <h1>{title}</h1>
        <p className="auth-lede">{lede}</p>
        {children}
      </div>
    </main>
  );
}

export function Login() {
  const [, navigate] = useLocation();
  const [tab, setTab] = useState<"password" | "key">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const signIn = async (body: Record<string, string>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Sign in failed");
        return;
      }
      window.localStorage.setItem("axon_api_key", data.apiKey);
      window.localStorage.setItem("axon_org_name", data.orgName);
      navigate("/dashboard");
    } catch (e: any) {
      setError(e.message || "Sign in failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Sign in to Axon" lede="Your workspace is scoped to your API key.">
      <div className="auth-tabs" role="tablist" aria-label="Sign in method">
        <button
          role="tab"
          aria-selected={tab === "password"}
          className={tab === "password" ? "is-active" : ""}
          onClick={() => setTab("password")}
        >
          Email &amp; Password
        </button>
        <button
          role="tab"
          aria-selected={tab === "key"}
          className={tab === "key" ? "is-active" : ""}
          onClick={() => setTab("key")}
        >
          API Key
        </button>
      </div>

      {tab === "password" ? (
        <form
          className="auth-form"
          onSubmit={(e) => {
            e.preventDefault();
            signIn({ email: email.trim(), password });
          }}
        >
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ops@protocol.xyz"
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </label>
          {error && <p className="auth-error">{error}</p>}
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"} <ArrowRight size={14} />
          </button>
          <p className="auth-switch">
            Don&apos;t have an account? <Link href="/signup">Sign up</Link>
            <br />
            <button type="button" className="auth-link" onClick={() => setTab("key")}>
              Have an API key? Use it directly →
            </button>
          </p>
        </form>
      ) : (
        <form
          className="auth-form"
          onSubmit={(e) => {
            e.preventDefault();
            signIn({ apiKey: apiKey.trim() });
          }}
        >
          <label>
            Paste your API key
            <input
              type="text"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="axon_live_..."
              required
              spellCheck={false}
            />
          </label>
          <p className="auth-hint">Get your API key by running: npx axon-cli login</p>
          {error && <p className="auth-error">{error}</p>}
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"} <ArrowRight size={14} />
          </button>
          <p className="auth-switch">
            <button type="button" className="auth-link" onClick={() => setTab("password")}>
              Create an account instead →
            </button>
          </p>
        </form>
      )}
    </AuthShell>
  );
}

export function Signup() {
  const [, navigate] = useLocation();
  const [orgName, setOrgName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [contract, setContract] = useState("");
  const [network, setNetwork] = useState("mainnet");
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ apiKey: string; orgName: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const emailOk = EMAIL_RE.test(email.trim());
  const pwOk = password.length >= 8;
  const confirmOk = confirm === password && confirm.length > 0;
  const contractOk = contract.trim() === "" || ADDRESS_RE.test(contract.trim());
  const orgOk = orgName.trim().length > 0;
  const formOk = orgOk && emailOk && pwOk && confirmOk && contractOk;

  useEffect(() => {
    if (!created) return;
    const t = window.setTimeout(() => navigate("/dashboard"), 10000);
    return () => window.clearTimeout(t);
  }, [created, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched({ org: true, email: true, pw: true, confirm: true, contract: true });
    if (!formOk || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgName: orgName.trim(),
          email: email.trim(),
          password,
          ...(contract.trim() ? { governanceContract: contract.trim(), network } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Signup failed");
        return;
      }
      window.localStorage.setItem("axon_api_key", data.apiKey);
      window.localStorage.setItem("axon_org_name", data.orgName);
      setCreated({ apiKey: data.apiKey, orgName: data.orgName });
    } catch (err: any) {
      setError(err.message || "Signup failed");
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    return (
      <AuthShell title="Workspace created" lede={`Welcome to Axon, ${created.orgName}.`}>
        <div className="auth-keybox">
          <span className="auth-keylabel">Your API key — shown once</span>
          <div className="auth-keyrow">
            <code>{created.apiKey}</code>
            <button
              className="secondary-button"
              onClick={() => {
                navigator.clipboard?.writeText(created.apiKey);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="auth-warning">
            <LockKeyhole size={13} /> Save this key — it won&apos;t be shown again.
          </p>
          <button className="primary-button" onClick={() => navigate("/dashboard")}>
            Open Dashboard <ArrowUpRight size={14} />
          </button>
        </div>
      </AuthShell>
    );
  }

  const strength = passwordStrength(password);

  return (
    <AuthShell title="Create your workspace" lede="Free. One workspace per protocol team.">
      <form className="auth-form" onSubmit={submit} noValidate>
        <label>
          Organisation name *
          <input
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, org: true }))}
            placeholder="Sky Ops"
          />
          {touched.org && !orgOk && <small className="auth-field-error">Organisation name is required</small>}
        </label>
        <label>
          Email *
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, email: true }))}
            placeholder="ops@protocol.xyz"
          />
          {touched.email && !emailOk && <small className="auth-field-error">Enter a valid email</small>}
        </label>
        <label>
          Password * <span className="auth-strength">strength: {password ? strength.label : "—"}</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, pw: true }))}
            placeholder="Min 8 characters"
          />
          {touched.pw && !pwOk && <small className="auth-field-error">Min 8 characters</small>}
        </label>
        <label>
          Confirm password *
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, confirm: true }))}
            placeholder="Repeat password"
          />
          {touched.confirm && !confirmOk && <small className="auth-field-error">Passwords must match</small>}
        </label>
        <label>
          Governance contract <span className="auth-optional">(optional — add later)</span>
          <input
            value={contract}
            onChange={(e) => setContract(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, contract: true }))}
            placeholder="0x... (optional — add later)"
            spellCheck={false}
          />
          {touched.contract && !contractOk && (
            <small className="auth-field-error">Must be a valid 0x address</small>
          )}
          <small className="auth-hint-static">Your protocol&apos;s governance contract address</small>
        </label>
        <label>
          Network
          <select value={network} onChange={(e) => setNetwork(e.target.value)}>
            <option value="mainnet">Ethereum Mainnet</option>
            <option value="base">Base</option>
            <option value="arbitrum">Arbitrum</option>
            <option value="optimism">Optimism</option>
          </select>
        </label>
        {error && <p className="auth-error">{error}</p>}
        <button className="primary-button" type="submit" disabled={busy || !formOk}>
          {busy ? "Creating…" : "Create Workspace"} <ArrowRight size={14} />
        </button>
        <p className="auth-switch">
          Already have a workspace? <Link href="/login">Sign in</Link>
        </p>
      </form>
    </AuthShell>
  );
}
