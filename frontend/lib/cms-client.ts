/**
 * CMS Service Client
 *
 * Thin HTTP client for the CMS service. Used by both API routes (server-side proxy)
 * and can be called directly from client components if CMS is publicly exposed.
 *
 * Default: calls CMS via Railway internal networking (CMS_SERVICE_URL env var).
 * Fallback: calls the legacy Next.js /api/content-pipeline routes.
 */

const CMS_BASE = process.env.CMS_SERVICE_URL ?? ''

/**
 * Check if the CMS service is configured.
 * If not, the frontend falls back to its own /api/content-pipeline routes.
 */
export function isCmsServiceEnabled(): boolean {
  return !!CMS_BASE
}

/**
 * Make a request to the CMS service.
 * Throws on non-ok responses with the error message from the service.
 */
export async function cmsRequest<T = Record<string, unknown>>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  if (!CMS_BASE) {
    throw new Error('CMS_SERVICE_URL is not configured')
  }

  const url = `${CMS_BASE}${path}`
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error ?? data.detail ?? `CMS service error: HTTP ${res.status}`)
  }

  return data as T
}

/**
 * CMS Content API helpers
 */
export const cmsContent = {
  listPosts: (params?: { status?: string; category?: string }) => {
    const qs = new URLSearchParams()
    if (params?.status) qs.set('status', params.status)
    if (params?.category) qs.set('category', params.category)
    const query = qs.toString()
    return cmsRequest(`/api/content/posts${query ? `?${query}` : ''}`)
  },

  getPost: (postId: string) =>
    cmsRequest(`/api/content/posts/${postId}`),

  createPost: (body: Record<string, unknown>) =>
    cmsRequest('/api/content/posts', { method: 'POST', body: JSON.stringify(body) }),

  updatePost: (postId: string, body: Record<string, unknown>) =>
    cmsRequest(`/api/content/posts/${postId}`, { method: 'PATCH', body: JSON.stringify(body) }),

  postAction: (postId: string, body: Record<string, unknown>) =>
    cmsRequest(`/api/content/posts/${postId}/action`, { method: 'POST', body: JSON.stringify(body) }),

  listReviews: (postId: string) =>
    cmsRequest(`/api/content/posts/${postId}/reviews`),

  listGenerations: (params?: { status?: string }) => {
    const qs = new URLSearchParams()
    if (params?.status) qs.set('status', params.status)
    const query = qs.toString()
    return cmsRequest(`/api/content/generations${query ? `?${query}` : ''}`)
  },

  createGeneration: (body: Record<string, unknown>) =>
    cmsRequest('/api/content/generations', { method: 'POST', body: JSON.stringify(body) }),

  generationAction: (genId: string, body: Record<string, unknown>) =>
    cmsRequest(`/api/content/generations/${genId}/action`, { method: 'POST', body: JSON.stringify(body) }),
}

/**
 * CMS Media API helpers
 */
export const cmsMedia = {
  list: (params?: { post_id?: string; usage?: string }) => {
    const qs = new URLSearchParams()
    if (params?.post_id) qs.set('post_id', params.post_id)
    if (params?.usage) qs.set('usage', params.usage)
    const query = qs.toString()
    return cmsRequest(`/api/media/list${query ? `?${query}` : ''}`)
  },

  /** Upload requires FormData — don't use cmsRequest for this */
  upload: async (formData: FormData) => {
    if (!CMS_BASE) throw new Error('CMS_SERVICE_URL is not configured')
    const res = await fetch(`${CMS_BASE}/api/media/upload`, {
      method: 'POST',
      body: formData,  // Don't set Content-Type — browser handles multipart boundary
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error ?? data.detail ?? `Upload failed: HTTP ${res.status}`)
    return data
  },

  delete: (mediaId: string) =>
    cmsRequest(`/api/media/${mediaId}`, { method: 'DELETE' }),

  fileUrl: (storagePath: string) =>
    `${CMS_BASE}/api/media/file/${storagePath}`,

  stats: () => cmsRequest('/api/media/stats'),
}
