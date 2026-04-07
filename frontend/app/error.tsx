'use client';

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  console.error('[AppError]', error);
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h2 className="text-2xl font-bold mb-4">Something went wrong</h2>
        <button onClick={reset} className="px-4 py-2 bg-brand-600 text-white rounded hover:bg-brand-700">
          Try again
        </button>
      </div>
    </div>
  );
}
