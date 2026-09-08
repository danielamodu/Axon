'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface OrgInfo {
  id: string
  name: string
  email?: string | null
  createdAt?: string
}

interface SpellItem {
  id: string
  protocolId: string
  spellAddress: string
  status: string
  simulationScore?: string | null
  conflictStatus?: string | null
  nextExecutionWindow: string
  earliestExecution: string
  latestExecution: string
}

interface HistoryItem {
  id: string
  protocolId: string
  spellAddress: string
  txHash?: string | null
  executedAt?: string | null
  gasUsed?: string | null
  simulationScore?: string | null
}

interface ProtocolItem {
  id: string
  name: string
  network: string
  governanceContract: string
  governanceType: string
  status: string
  isCustom: boolean
}

export default function DashboardPage() {
  const router = useRouter()
  const [apiKey, setApiKey] = useState<string | null>(null)
  const [org, setOrg] = useState<OrgInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'queue' | 'history' | 'protocols'>('queue')

  const [queue, setQueue] = useState<SpellItem[]>([])
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [protocols, setProtocols] = useState<ProtocolItem[]>([])
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async (token: string) => {
    setLoading(true)
    setError(null)
    const headers = { Authorization: `Bearer ${token}` }

    try {
      // 1. Verify org
      const authRes = await fetch('/api/auth/verify', { headers })
      if (!authRes.ok) {
        localStorage.removeItem('axon_api_key')
        router.replace('/login')
        return
      }
      const authData = await authRes.json()
      setOrg(authData.org)

      // 2. Fetch queue
      const qRes = await fetch('/api/queue', { headers })
      if (qRes.ok) {
        const qData = await qRes.json()
        setQueue(qData.queue || [])
      }

      // 3. Fetch history
      const hRes = await fetch('/api/history', { headers })
      if (hRes.ok) {
        const hData = await hRes.json()
        setHistory(hData.history || [])
      }

      // 4. Fetch protocols
      const pRes = await fetch('/api/protocols', { headers })
      if (pRes.ok) {
        const pData = await pRes.json()
        setProtocols(pData.protocols || [])
      }
    } catch (err: any) {
      setError('Unable to load workspace data. Please check network connection.')
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    const token = localStorage.getItem('axon_api_key')
    if (!token) {
      router.replace('/login')
      return
    }
    setApiKey(token)
    fetchData(token)
  }, [router, fetchData])

  function handleLogout() {
    localStorage.removeItem('axon_api_key')
    localStorage.removeItem('axon_org_name')
    localStorage.removeItem('axon_org_id')
    router.replace('/login')
  }

  function maskKey(key: string | null) {
    if (!key || key.length < 8) return '****'
    return `${key.slice(0, 10)}...${key.slice(-4)}`
  }

  function formatShortAddress(addr: string) {
    if (!addr || addr.length < 12) return addr
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`
  }

  if (loading && !org) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-secondary)',
          backgroundColor: 'var(--bg-primary)',
        }}
      >
        <p>Connecting to Axon Operations Console...</p>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      {/* Top Navigation */}
      <header
        style={{
          borderBottom: '1px solid var(--border-subtle)',
          backgroundColor: 'var(--bg-secondary)',
          padding: '16px 32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span
            style={{
              fontSize: '15px',
              fontWeight: 700,
              letterSpacing: '-0.02em',
              color: 'var(--text-primary)',
            }}
          >
            AXON
          </span>
          <span style={{ color: 'var(--border-subtle)' }}>/</span>
          <span style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 500 }}>
            {org?.name || 'Workspace'}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            Key:{' '}
            <code style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: '4px' }}>
              {maskKey(apiKey)}
            </code>
          </div>
          <button
            onClick={handleLogout}
            style={{
              padding: '6px 12px',
              fontSize: '12px',
              color: 'var(--text-secondary)',
              backgroundColor: 'transparent',
              border: '1px solid var(--border-subtle)',
              borderRadius: '4px',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.color = 'var(--text-primary)'
              e.currentTarget.style.borderColor = 'var(--border-hover)'
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.color = 'var(--text-secondary)'
              e.currentTarget.style.borderColor = 'var(--border-subtle)'
            }}
          >
            Disconnect
          </button>
        </div>
      </header>

      {/* Main Content Container */}
      <main style={{ maxWidth: '1200px', margin: '0 auto', padding: '32px' }}>
        {error && (
          <div
            style={{
              padding: '12px 16px',
              backgroundColor: '#2a1215',
              border: '1px solid #5c1d24',
              borderRadius: '6px',
              color: '#f87171',
              fontSize: '13px',
              marginBottom: '24px',
            }}
          >
            {error}
          </div>
        )}

        {/* Metrics Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '16px',
            marginBottom: '32px',
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '6px',
              padding: '20px',
            }}
          >
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Monitored Protocols
            </div>
            <div style={{ fontSize: '24px', fontWeight: 600, color: 'var(--text-primary)' }}>
              {protocols.length}
            </div>
          </div>

          <div
            style={{
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '6px',
              padding: '20px',
            }}
          >
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Active Queue
            </div>
            <div style={{ fontSize: '24px', fontWeight: 600, color: queue.length > 0 ? 'var(--accent-amber)' : 'var(--text-primary)' }}>
              {queue.length}
            </div>
          </div>

          <div
            style={{
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '6px',
              padding: '20px',
            }}
          >
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Executions Recorded
            </div>
            <div style={{ fontSize: '24px', fontWeight: 600, color: 'var(--text-primary)' }}>
              {history.length}
            </div>
          </div>
        </div>

        {/* Tabs Bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            borderBottom: '1px solid var(--border-subtle)',
            marginBottom: '20px',
            paddingBottom: '2px',
          }}
        >
          <button
            onClick={() => setActiveTab('queue')}
            style={{
              padding: '8px 16px',
              fontSize: '13px',
              fontWeight: 500,
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'queue' ? '2px solid #ffffff' : '2px solid transparent',
              color: activeTab === 'queue' ? 'var(--text-primary)' : 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            Execution Queue ({queue.length})
          </button>
          <button
            onClick={() => setActiveTab('history')}
            style={{
              padding: '8px 16px',
              fontSize: '13px',
              fontWeight: 500,
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'history' ? '2px solid #ffffff' : '2px solid transparent',
              color: activeTab === 'history' ? 'var(--text-primary)' : 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            Execution History ({history.length})
          </button>
          <button
            onClick={() => setActiveTab('protocols')}
            style={{
              padding: '8px 16px',
              fontSize: '13px',
              fontWeight: 500,
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'protocols' ? '2px solid #ffffff' : '2px solid transparent',
              color: activeTab === 'protocols' ? 'var(--text-primary)' : 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            Protocols ({protocols.length})
          </button>
        </div>

        {/* Tab 1: Queue */}
        {activeTab === 'queue' && (
          <div
            style={{
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '6px',
              overflow: 'hidden',
            }}
          >
            {queue.length === 0 ? (
              <div style={{ padding: '36px', textAlign: 'center', color: 'var(--text-muted)' }}>
                No spells currently queued for execution.
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '12px 16px', fontWeight: 500 }}>Protocol</th>
                    <th style={{ padding: '12px 16px', fontWeight: 500 }}>Spell Address</th>
                    <th style={{ padding: '12px 16px', fontWeight: 500 }}>Status</th>
                    <th style={{ padding: '12px 16px', fontWeight: 500 }}>Simulation</th>
                    <th style={{ padding: '12px 16px', fontWeight: 500 }}>Execution Window</th>
                    <th style={{ padding: '12px 16px', fontWeight: 500 }}>Conflict</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.map((s) => (
                    <tr key={s.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '12px 16px', fontWeight: 500 }}>{s.protocolId}</td>
                      <td style={{ padding: '12px 16px', fontFamily: 'var(--font-mono)' }}>
                        {formatShortAddress(s.spellAddress)}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: 500,
                            backgroundColor:
                              s.status === 'READY'
                                ? '#064e3b'
                                : s.status === 'QUEUED'
                                ? '#1e293b'
                                : '#374151',
                            color: s.status === 'READY' ? '#34d399' : '#e2e8f0',
                          }}
                        >
                          {s.status}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span
                          style={{
                            color:
                              s.simulationScore === 'GREEN'
                                ? '#34d399'
                                : s.simulationScore === 'YELLOW'
                                ? '#fbbf24'
                                : '#f87171',
                            fontWeight: 500,
                          }}
                        >
                          {s.simulationScore || '—'}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>
                        {new Date(s.nextExecutionWindow).toISOString().replace('T', ' ').slice(0, 19)} UTC
                      </td>
                      <td style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>
                        {s.conflictStatus || 'CLEAR'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Tab 2: Execution History */}
        {activeTab === 'history' && (
          <div
            style={{
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '6px',
              overflow: 'hidden',
            }}
          >
            {history.length === 0 ? (
              <div style={{ padding: '36px', textAlign: 'center', color: 'var(--text-muted)' }}>
                No completed executions recorded yet.
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '12px 16px', fontWeight: 500 }}>Protocol</th>
                    <th style={{ padding: '12px 16px', fontWeight: 500 }}>Spell Address</th>
                    <th style={{ padding: '12px 16px', fontWeight: 500 }}>Transaction</th>
                    <th style={{ padding: '12px 16px', fontWeight: 500 }}>Executed At</th>
                    <th style={{ padding: '12px 16px', fontWeight: 500 }}>Gas Used</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '12px 16px', fontWeight: 500 }}>{h.protocolId}</td>
                      <td style={{ padding: '12px 16px', fontFamily: 'var(--font-mono)' }}>
                        {formatShortAddress(h.spellAddress)}
                      </td>
                      <td style={{ padding: '12px 16px', fontFamily: 'var(--font-mono)' }}>
                        {h.txHash ? formatShortAddress(h.txHash) : '—'}
                      </td>
                      <td style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>
                        {h.executedAt ? new Date(h.executedAt).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '—'}
                      </td>
                      <td style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>
                        {h.gasUsed ? Number(h.gasUsed).toLocaleString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Tab 3: Monitored Protocols */}
        {activeTab === 'protocols' && (
          <div
            style={{
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '6px',
              overflow: 'hidden',
            }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '12px 16px', fontWeight: 500 }}>Protocol Name</th>
                  <th style={{ padding: '12px 16px', fontWeight: 500 }}>Network</th>
                  <th style={{ padding: '12px 16px', fontWeight: 500 }}>Governance Contract</th>
                  <th style={{ padding: '12px 16px', fontWeight: 500 }}>Type</th>
                  <th style={{ padding: '12px 16px', fontWeight: 500 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {protocols.map((p) => (
                  <tr key={p.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '12px 16px', fontWeight: 600 }}>{p.name}</td>
                    <td style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>{p.network}</td>
                    <td style={{ padding: '12px 16px', fontFamily: 'var(--font-mono)' }}>
                      {formatShortAddress(p.governanceContract)}
                    </td>
                    <td style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>{p.governanceType}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontSize: '11px',
                          fontWeight: 500,
                          backgroundColor: p.status === 'ACTIVE' ? '#064e3b' : '#1e293b',
                          color: p.status === 'ACTIVE' ? '#34d399' : '#94a3b8',
                        }}
                      >
                        {p.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  )
}
