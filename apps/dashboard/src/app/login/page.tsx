'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()
  const [apiKey, setApiKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // If already logged in, go straight to dashboard
    const existingKey = localStorage.getItem('axon_api_key')
    if (existingKey) {
      router.replace('/dashboard')
    }
  }, [router])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    const cleanKey = apiKey.trim()
    if (!cleanKey) {
      setError('Please enter your Axon API key.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cleanKey}`,
          'Content-Type': 'application/json',
        },
      })

      const data = await res.json()

      if (!res.ok || !data.ok) {
        setError(data.error || 'Invalid API key. Please check your credentials.')
        setLoading(false)
        return
      }

      // Valid: save to localStorage and navigate to dashboard
      localStorage.setItem('axon_api_key', cleanKey)
      localStorage.setItem('axon_org_name', data.org?.name || 'Workspace')
      localStorage.setItem('axon_org_id', data.org?.id || '')
      router.push('/dashboard')
    } catch (err: any) {
      setError('Network error verifying API key. Please check server connection.')
      setLoading(false)
    }
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        backgroundColor: 'var(--bg-primary)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '420px',
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '8px',
          padding: '36px 32px',
        }}
      >
        <div style={{ marginBottom: '28px' }}>
          <h1
            style={{
              fontSize: '20px',
              fontWeight: 600,
              letterSpacing: '-0.02em',
              color: 'var(--text-primary)',
              marginBottom: '6px',
            }}
          >
            Axon Console
          </h1>
          <p
            style={{
              fontSize: '13px',
              color: 'var(--text-secondary)',
              lineHeight: '1.4',
            }}
          >
            Authenticate with your organization API key to view autonomous execution status.
          </p>
        </div>

        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: '20px' }}>
            <label
              htmlFor="apiKey"
              style={{
                display: 'block',
                fontSize: '12px',
                fontWeight: 500,
                color: 'var(--text-secondary)',
                marginBottom: '8px',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              Axon API Key
            </label>
            <input
              id="apiKey"
              type="password"
              autoComplete="off"
              spellCheck="false"
              placeholder="axon_live_..."
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value)
                if (error) setError(null)
              }}
              style={{
                width: '100%',
                padding: '10px 12px',
                backgroundColor: 'var(--bg-tertiary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '6px',
                color: 'var(--text-primary)',
                fontSize: '13px',
                fontFamily: 'var(--font-mono)',
                outline: 'none',
                transition: 'border-color 0.15s ease',
              }}
              onFocus={(e) => (e.target.style.borderColor = 'var(--border-hover)')}
              onBlur={(e) => (e.target.style.borderColor = 'var(--border-subtle)')}
            />
          </div>

          {error && (
            <div
              style={{
                padding: '10px 12px',
                backgroundColor: '#2a1215',
                border: '1px solid #5c1d24',
                borderRadius: '6px',
                color: '#f87171',
                fontSize: '12px',
                marginBottom: '18px',
                lineHeight: '1.4',
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '10px 16px',
              backgroundColor: '#1f2937',
              color: '#ffffff',
              border: '1px solid #374151',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: 500,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
              transition: 'background-color 0.15s ease',
            }}
            onMouseOver={(e) => {
              if (!loading) (e.currentTarget.style.backgroundColor = '#2d3748')
            }}
            onMouseOut={(e) => {
              if (!loading) (e.currentTarget.style.backgroundColor = '#1f2937')
            }}
          >
            {loading ? 'Validating credentials...' : 'Connect Workspace'}
          </button>
        </form>

        <div
          style={{
            marginTop: '28px',
            paddingTop: '20px',
            borderTop: '1px solid var(--border-subtle)',
            fontSize: '12px',
            color: 'var(--text-muted)',
            lineHeight: '1.5',
          }}
        >
          <span style={{ color: 'var(--text-secondary)' }}>Need an API key?</span>
          <br />
          Run <code style={{ color: 'var(--text-primary)' }}>axon login</code> or{' '}
          <code style={{ color: 'var(--text-primary)' }}>axon init</code> in your terminal to create a workspace.
        </div>
      </div>
    </main>
  )
}
