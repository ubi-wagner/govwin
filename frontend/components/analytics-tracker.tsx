'use client'

import { useEffect, useRef, useCallback } from 'react'
import { usePathname } from 'next/navigation'

/**
 * Analytics tracker — embedded in marketing layout.
 * Tracks: sessions, page views, scroll depth, CTA clicks, section views,
 * and navigation patterns. Links to waitlist via visitor_id cookie.
 */

// ── Helpers ──────────────────────────────────────────────────

function getVisitorId(): string {
  const key = '_rfp_vid'
  let id = localStorage.getItem(key)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(key, id)
  }
  return id
}

/** Expose visitor ID so waitlist form can include it */
export function getStoredVisitorId(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('_rfp_vid')
}

function getUTMParams() {
  const params = new URLSearchParams(window.location.search)
  return {
    utmSource: params.get('utm_source') ?? undefined,
    utmMedium: params.get('utm_medium') ?? undefined,
    utmCampaign: params.get('utm_campaign') ?? undefined,
    utmTerm: params.get('utm_term') ?? undefined,
    utmContent: params.get('utm_content') ?? undefined,
  }
}

function getDeviceInfo() {
  const ua = navigator.userAgent
  let deviceType = 'desktop'
  if (/Mobi|Android/i.test(ua)) deviceType = 'mobile'
  else if (/Tablet|iPad/i.test(ua)) deviceType = 'tablet'

  let browser = 'unknown'
  if (ua.includes('Firefox')) browser = 'Firefox'
  else if (ua.includes('Edg')) browser = 'Edge'
  else if (ua.includes('Chrome')) browser = 'Chrome'
  else if (ua.includes('Safari')) browser = 'Safari'

  let os = 'unknown'
  if (ua.includes('Windows')) os = 'Windows'
  else if (ua.includes('Mac')) os = 'macOS'
  else if (ua.includes('Linux')) os = 'Linux'
  else if (ua.includes('Android')) os = 'Android'
  else if (/iPhone|iPad/.test(ua)) os = 'iOS'

  return { deviceType, browser, os }
}

// ── Event queue ──────────────────────────────────────────────

interface AnalyticsEvent {
  type: 'session' | 'pageview' | 'interaction' | 'update'
  data: Record<string, unknown>
}

let eventQueue: AnalyticsEvent[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null

function enqueue(event: AnalyticsEvent) {
  eventQueue.push(event)
  // Auto-flush after short delay or when queue gets big
  if (eventQueue.length >= 10) {
    flush()
  } else if (!flushTimer) {
    flushTimer = setTimeout(flush, 2000)
  }
}

function flush() {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  if (eventQueue.length === 0) return
  const batch = eventQueue.splice(0, 50)
  // Fire and forget — don't block UI
  fetch('/api/analytics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ events: batch }),
    keepalive: true, // survives page unload
  }).catch(() => {
    // Silently discard on failure — analytics should never break the site
  })
}

// ── Component ────────────────────────────────────────────────

export function AnalyticsTracker() {
  const pathname = usePathname()
  const prevPathRef = useRef<string | null>(null)
  const pageEnteredAt = useRef<number>(Date.now())
  const maxScrollPct = useRef(0)
  const sessionSent = useRef(false)

  // Send session event once
  useEffect(() => {
    if (sessionSent.current) return
    sessionSent.current = true

    const visitorId = getVisitorId()
    const device = getDeviceInfo()
    const utm = getUTMParams()

    enqueue({
      type: 'session',
      data: {
        visitorId,
        screenWidth: window.screen.width,
        screenHeight: window.screen.height,
        language: navigator.language,
        ...device,
        ...utm,
      },
    })
  }, [])

  // Track scroll depth
  useEffect(() => {
    maxScrollPct.current = 0

    function onScroll() {
      const scrollTop = window.scrollY
      const docHeight = document.documentElement.scrollHeight - window.innerHeight
      if (docHeight > 0) {
        const pct = Math.round((scrollTop / docHeight) * 100)
        if (pct > maxScrollPct.current) {
          maxScrollPct.current = pct
        }
      }
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [pathname])

  // Send page-level update on unload or navigation
  const sendPageUpdate = useCallback(() => {
    const visitorId = localStorage.getItem('_rfp_vid')
    if (!visitorId || !prevPathRef.current) return
    const timeOnPage = Date.now() - pageEnteredAt.current
    enqueue({
      type: 'update',
      data: {
        visitorId,
        path: prevPathRef.current,
        timeOnPageMs: timeOnPage,
        scrollDepthPct: maxScrollPct.current,
      },
    })
  }, [])

  // Track page views on navigation
  useEffect(() => {
    // Send update for previous page
    if (prevPathRef.current && prevPathRef.current !== pathname) {
      sendPageUpdate()
    }

    // Record new page view
    const visitorId = getVisitorId()
    enqueue({
      type: 'pageview',
      data: {
        visitorId,
        path: pathname,
        pageTitle: document.title,
        referrerPath: prevPathRef.current ?? undefined,
      },
    })

    pageEnteredAt.current = Date.now()
    maxScrollPct.current = 0
    prevPathRef.current = pathname
  }, [pathname, sendPageUpdate])

  // Flush on page unload
  useEffect(() => {
    function onBeforeUnload() {
      sendPageUpdate()
      flush()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [sendPageUpdate])

  // Track CTA clicks and important interactions via event delegation
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement
      const el = target.closest('a, button') as HTMLElement | null
      if (!el) return

      const visitorId = localStorage.getItem('_rfp_vid')
      if (!visitorId) return

      // Determine what was clicked
      const href = el.getAttribute('href')
      const text = el.textContent?.trim().slice(0, 100) ?? ''
      let trackTarget = ''
      let eventType = 'click'

      // CTA buttons
      if (text.includes('Join') && text.includes('Waitlist')) {
        trackTarget = 'cta_join_waitlist'
      } else if (text.includes('Get Started') || text.includes('Get started')) {
        trackTarget = 'cta_get_started'
      } else if (text.includes('See Pricing') || text.includes('View Plans')) {
        trackTarget = 'cta_see_pricing'
      } else if (text.includes('See the SBIR Engine') || text.includes('SBIR Engine')) {
        trackTarget = 'cta_sbir_engine'
      } else if (text.includes('Sign in')) {
        trackTarget = 'cta_sign_in'
      } else if (text.includes('Meet the Founder')) {
        trackTarget = 'cta_meet_founder'
      } else if (href?.startsWith('mailto:')) {
        trackTarget = 'email_contact'
        eventType = 'click'
      } else if (href && href.startsWith('/')) {
        // Internal nav link
        trackTarget = `nav_${href.replace(/\//g, '_').replace(/^_/, '')}`
      } else {
        // Not a tracked element
        return
      }

      enqueue({
        type: 'interaction',
        data: {
          visitorId,
          path: pathname,
          eventType,
          target: trackTarget,
          targetLabel: text.slice(0, 60),
        },
      })
    }

    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [pathname])

  // Track section visibility (hero, features, pricing, cta, etc.)
  useEffect(() => {
    const visitorId = localStorage.getItem('_rfp_vid')
    if (!visitorId) return

    const sections = document.querySelectorAll('section[class*="bg-"], [class*="Section"]')
    if (sections.length === 0) return

    const seen = new Set<string>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const el = entry.target as HTMLElement
          // Identify section by first heading or class
          const heading = el.querySelector('h1, h2, h3')?.textContent?.trim().slice(0, 50)
          const sectionId = heading
            ? heading.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40)
            : `section_${Array.from(el.parentElement?.children ?? []).indexOf(el)}`

          if (seen.has(sectionId)) continue
          seen.add(sectionId)

          enqueue({
            type: 'interaction',
            data: {
              visitorId,
              path: pathname,
              eventType: 'view',
              target: `section_${sectionId}`,
              targetLabel: heading ?? 'unnamed section',
            },
          })
        }
      },
      { threshold: 0.3 }
    )

    sections.forEach(s => observer.observe(s))
    return () => observer.disconnect()
  }, [pathname])

  return null // invisible component
}
