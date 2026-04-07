'use client';

export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  console.error('[GlobalError]', error);
  return (
    <html>
      <body style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>Something went wrong</h2>
          <button onClick={reset} style={{ padding: '0.5rem 1rem', background: '#2563eb', color: 'white', borderRadius: '0.375rem', border: 'none', cursor: 'pointer' }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
