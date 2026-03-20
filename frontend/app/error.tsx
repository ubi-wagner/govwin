'use client'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-gray-900">Something went wrong</h1>
        <p className="mt-2 text-gray-600">An unexpected error occurred. Please try again.</p>
        <button
          onClick={reset}
          className="btn-primary mt-6"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
