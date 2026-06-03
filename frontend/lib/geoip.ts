/**
 * Server-side IP → connection info (ISP / org / ASN / geo) for visitor analytics.
 *
 * Used by the public pageview beacon to enrich a NEW session once, then the IP is
 * discarded (only the SHA-256 hash + these derived fields are stored). Best-effort:
 * a short timeout and any failure returns null, so analytics never blocks/breaks.
 *
 * Provider is pluggable via env:
 *   - IPINFO_TOKEN set  → ipinfo.io (HTTPS, commercial-friendly) — recommended for prod.
 *   - otherwise         → ip-api.com (free, no key, HTTP) — fine for dev; ip-api's
 *                         free tier is non-commercial, so set IPINFO_TOKEN in prod.
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

async function fetchJson(url: string, timeoutMs: number): Promise<Record<string, unknown> | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
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

/** Look up connection info for a public IP. Returns null on any failure/timeout. */
export async function lookupIp(ip: string, timeoutMs = 2000): Promise<GeoInfo | null> {
  if (!isPublicIp(ip)) return null;
  const token = process.env.IPINFO_TOKEN;
  try {
    if (token) {
      const d = await fetchJson(`https://ipinfo.io/${encodeURIComponent(ip)}/json?token=${token}`, timeoutMs);
      if (!d || d.bogon) return null;
      const { asn, name } = asnFromOrg(str(d.org));
      const [lat, lon] = str(d.loc)?.split(',').map((n) => Number(n)) ?? [null, null];
      return {
        country: str(d.country), region: str(d.region), city: str(d.city),
        isp: name, org: str(d.org), asn,
        timezone: str(d.timezone),
        latitude: typeof lat === 'number' && Number.isFinite(lat) ? lat : null,
        longitude: typeof lon === 'number' && Number.isFinite(lon) ? lon : null,
      };
    }
    const fields = 'status,country,regionName,city,isp,org,as,timezone,lat,lon';
    const d = await fetchJson(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=${fields}`, timeoutMs);
    if (!d || d.status !== 'success') return null;
    const { asn } = asnFromOrg(str(d.as));
    return {
      country: str(d.country), region: str(d.regionName), city: str(d.city),
      isp: str(d.isp), org: str(d.org) ?? str(d.isp), asn,
      timezone: str(d.timezone), latitude: num(d.lat), longitude: num(d.lon),
    };
  } catch (e) {
    console.error('[geoip/lookupIp] error:', e);
    return null;
  }
}
