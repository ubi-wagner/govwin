/**
 * Server-side IP → connection info (ISP / org / ASN / geo) for visitor analytics.
 *
 * Used by the public pageview beacon to enrich a NEW session once, then the IP is
 * discarded (only the SHA-256 hash + these derived fields are stored). Best-effort:
 * a short timeout and any failure returns null, so analytics never blocks/breaks.
 *
 * Provider is pluggable via env:
 *   - IPINFO_TOKEN set  → IPinfo Lite (https://api.ipinfo.io/lite, Bearer auth):
 *                         ASN + AS/org name + country (HTTPS, commercial-OK). Free
 *                         Lite has no city/region/lat-lon/timezone (paid plan only).
 *   - otherwise         → ip-api.com (free, no key, HTTP) — city-level geo, but its
 *                         free tier is non-commercial, so prefer IPINFO_TOKEN in prod.
 */
export interface GeoInfo {
  country: string | null;
  region: string | null;
  city: string | null;
  isp: string | null;
  org: string | null;
  asn: string | null;
  timezone: string | null;
  latitude: number | null;
  longitude: number | null;
}

/** True only for routable public IPs — skip private/loopback/link-local/CGNAT. */
export function isPublicIp(ip: string | null | undefined): boolean {
  if (!ip || ip === 'unknown') return false;
  const v = ip.trim();
  if (v === '::1' || v.startsWith('fe80:') || v.startsWith('fc') || v.startsWith('fd')) return false;
  const m = v.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = +m[1], b = +m[2];
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 192 && b === 168) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 169 && b === 254) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  }
  return true;
}

function asnFromOrg(org: string | null | undefined): { asn: string | null; name: string | null } {
  if (!org) return { asn: null, name: null };
  const m = org.match(/^(AS\d+)\s*(.*)$/i);
  if (m) return { asn: m[1].toUpperCase(), name: m[2].trim() || null };
  return { asn: null, name: org };
}

async function fetchJson(url: string, timeoutMs: number, headers?: Record<string, string>): Promise<Record<string, unknown> | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json', ...(headers ?? {}) } });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

async function viaIpinfo(ip: string, token: string, timeoutMs: number): Promise<GeoInfo | null> {
  // IPinfo Lite: ASN + AS/org name + country (Bearer auth, HTTPS). Parsed
  // defensively so a richer paid response (city/region/loc/timezone) also maps.
  const d = await fetchJson(`https://api.ipinfo.io/lite/${encodeURIComponent(ip)}`, timeoutMs, {
    Authorization: `Bearer ${token}`,
  });
  if (!d || d.bogon || d.error) return null;
  const fromOrg = asnFromOrg(str(d.org));
  const asn = str(d.asn) ?? fromOrg.asn;
  const name = str(d.as_name) ?? fromOrg.name ?? str(d.org);
  const country = str(d.country) ?? str(d.country_code);
  if (!asn && !name && !country && !str(d.city)) return null;
  const parts = str(d.loc)?.split(',').map((n) => Number(n)) ?? [];
  const [lat, lon] = parts.length === 2 ? parts : [NaN, NaN];
  return {
    country,
    region: str(d.region) ?? str(d.continent),
    city: str(d.city),
    isp: name, org: name, asn,
    timezone: str(d.timezone),
    latitude: Number.isFinite(lat) ? lat : null,
    longitude: Number.isFinite(lon) ? lon : null,
  };
}

async function viaIpApi(ip: string, timeoutMs: number): Promise<GeoInfo | null> {
  const fields = 'status,country,regionName,city,isp,org,as,timezone,lat,lon';
  const d = await fetchJson(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=${fields}`, timeoutMs);
  if (!d || d.status !== 'success') return null;
  const { asn } = asnFromOrg(str(d.as));
  return {
    country: str(d.country), region: str(d.regionName), city: str(d.city),
    isp: str(d.isp), org: str(d.org) ?? str(d.isp), asn,
    timezone: str(d.timezone), latitude: num(d.lat), longitude: num(d.lon),
  };
}

/**
 * Look up connection info for a public IP. Returns null on any failure/timeout.
 * Prefers ipinfo.io when a real token is set, but falls back to ip-api.com on any
 * failure — so a misconfigured/expired token degrades gracefully rather than
 * disabling enrichment. (IPINFO_TOKEN must be a real token, not 'true'/'false'.)
 */
export async function lookupIp(ip: string, timeoutMs = 2000): Promise<GeoInfo | null> {
  if (!isPublicIp(ip)) return null;
  try {
    const token = process.env.IPINFO_TOKEN;
    if (token && token !== 'true' && token !== 'false') {
      const g = await viaIpinfo(ip, token, timeoutMs);
      if (g) return g;
    }
    return await viaIpApi(ip, timeoutMs);
  } catch (e) {
    console.error('[geoip/lookupIp] error:', e);
    return null;
  }
}
