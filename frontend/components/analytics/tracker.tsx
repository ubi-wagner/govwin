'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

/**
 * Invisible client-side analytics tracker.
 * Sends page view events to /api/analytics/pageview on every navigation.
 * Tracks time-on-page via visibilitychange and sends duration via sendBeacon.
 */
export default function Tracker() {
  const pathname = usePathname();
  const sessionIdRef = useRef<string | null>(null);
  const referrerRef = useRef<string | null>(null);
  const utmRef = useRef<{ utmSource?: string; utmMedium?: string; utmCampaign?: string }>({});
  const pageEnteredRef = useRef<number>(Date.now());
  const lastPathRef = useRef<string | null>(null);
  const initializedRef = useRef(false);

  // Initialize session ID, referrer, and UTM params on mount
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    let sid = sessionStorage.getItem('_rfp_sid');
    if (!sid) {
      sid = crypto.randomUUID();
      sessionStorage.setItem('_rfp_sid', sid);
    }
    sessionIdRef.current = sid;

    referrerRef.current = document.referrer || null;

    const params = new URLSearchParams(window.location.search);
    utmRef.current = {
      utmSource: params.get('utm_source') || undefined,
      utmMedium: params.get('utm_medium') || undefined,
      utmCampaign: params.get('utm_campaign') || undefined,
    };
  }, []);

  // Track page views on pathname change
  useEffect(() => {
    if (!sessionIdRef.current) return;
    if (pathname === lastPathRef.current) return;

    lastPathRef.current = pathname;
    pageEnteredRef.current = Date.now();

    const body: Record<string, unknown> = {
      sessionId: sessionIdRef.current,
      pagePath: pathname,
      userAgent: navigator.userAgent,
    };

    // Only include referrer on the very first page view
    if (referrerRef.current) {
      body.referrer = referrerRef.current;
      referrerRef.current = null;
    }

    if (utmRef.current.utmSource) body.utmSource = utmRef.current.utmSource;
    if (utmRef.current.utmMedium) body.utmMedium = utmRef.current.utmMedium;
    if (utmRef.current.utmCampaign) body.utmCampaign = utmRef.current.utmCampaign;

    fetch('/api/analytics/pageview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {
      // Silently ignore tracking failures
    });
  }, [pathname]);

  // Track time-on-page via visibilitychange
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === 'hidden' && sessionIdRef.current && lastPathRef.current) {
        const durationMs = Date.now() - pageEnteredRef.current;
        if (durationMs < 100) return; // Ignore sub-100ms "views"

        const payload = JSON.stringify({
          sessionId: sessionIdRef.current,
          pagePath: lastPathRef.current,
          durationMs,
        });

        navigator.sendBeacon(
          '/api/analytics/pageview',
          new Blob([payload], { type: 'application/json' }),
        );
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  return null;
}
