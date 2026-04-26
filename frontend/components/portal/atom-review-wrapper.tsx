'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import AtomReview from '@/components/portal/atom-review';

/**
 * Thin client wrapper around AtomReview that wires up the onComplete
 * callback to a client-side redirect. Needed because server components
 * cannot pass function props across the server/client boundary.
 */
export default function AtomReviewWrapper({
  tenantSlug,
  atoms,
  sourceFilename,
  documentMetadata,
  redirectTo,
}: {
  tenantSlug: string;
  atoms: Array<{
    id: string;
    content: string;
    category: string;
    tags: string[];
    headingText: string | null;
    confidence: number;
    canvasNodes?: unknown;
  }>;
  sourceFilename: string;
  documentMetadata?: {
    title?: string;
    author?: string;
    pageCount?: number;
  };
  redirectTo: string;
}) {
  const router = useRouter();

  const handleComplete = useCallback(() => {
    router.push(redirectTo);
  }, [router, redirectTo]);

  return (
    <AtomReview
      tenantSlug={tenantSlug}
      atoms={atoms}
      sourceFilename={sourceFilename}
      documentMetadata={documentMetadata}
      onComplete={handleComplete}
    />
  );
}
