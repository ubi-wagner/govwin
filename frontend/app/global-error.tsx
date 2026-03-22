'use client'

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[GlobalError] Root layout error:', error)
  }, [error])

  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: '#f8fafc', margin: 0 }}>
        <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div style={{ textAlign: 'center', maxWidth: '28rem' }}>
            <div style={{
              width: '3.5rem', height: '3.5rem', margin: '0 auto', display: 'flex',
              alignItems: 'center', justifyContent: 'center', borderRadius: '1rem',
              backgroundColor: '#fef2f2',
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
              </svg>
            </div>
            <h1 style={{ marginTop: '1rem', fontSize: '1.5rem', fontWeight: 700, color: '#111827' }}>
              Something went wrong
            </h1>
            <p style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: '#6b7280' }}>
              A critical error occurred. Please try refreshing the page.
            </p>
            <button
              onClick={reset}
              style={{
                marginTop: '1.5rem', padding: '0.625rem 1.25rem', fontSize: '0.875rem',
                fontWeight: 600, color: '#fff', backgroundColor: '#2563eb',
                border: 'none', borderRadius: '0.5rem', cursor: 'pointer',
              }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
