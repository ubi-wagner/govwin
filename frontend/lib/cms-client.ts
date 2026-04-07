const CMS_SERVICE_URL = process.env.CMS_SERVICE_URL;

export function isCmsEnabled(): boolean {
  return !!CMS_SERVICE_URL;
}

export async function getPageContent(pageKey: string): Promise<Record<string, unknown> | null> {
  if (!CMS_SERVICE_URL) return null;
  try {
    const res = await fetch(`${CMS_SERVICE_URL}/api/content/posts/${pageKey}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
