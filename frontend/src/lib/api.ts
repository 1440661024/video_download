import type { ApiResponse, DirectLinkPayload, VideoMeta } from '../types'

/** 开发环境默认空字符串，走 Vite `server.proxy` 同源 `/api`，以便携带 HttpOnly 登录 Cookie。 */
const envBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '')
export const API_BASE_URL = envBase !== undefined && envBase !== '' ? envBase : ''

function buildApiUrl(path: string) {
  return `${API_BASE_URL}${path}`
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(buildApiUrl(path), {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    ...init,
  })

  const rawText = await response.text()
  let body: ApiResponse<T> | null = null

  try {
    body = rawText ? (JSON.parse(rawText) as ApiResponse<T>) : null
  } catch {
    throw new Error(`服务暂时异常（HTTP ${response.status}），请稍后重试。`)
  }

  if (!response.ok || !body?.success || !body.data) {
    throw new Error(body?.error?.message ?? `请求失败（HTTP ${response.status}），请稍后重试。`)
  }

  return body.data
}

export function parseVideo(url: string) {
  return request<VideoMeta>('/api/video/parse', {
    method: 'POST',
    body: JSON.stringify({ url }),
  })
}

export function getDownloadLink(url: string, formatId: string) {
  return request<DirectLinkPayload>('/api/video/download-link', {
    method: 'POST',
    body: JSON.stringify({ url, format_id: formatId }),
  })
}

export function getApiAssetUrl(path: string, params?: URLSearchParams | Record<string, string>) {
  const url = new URL(buildApiUrl(path), window.location.origin)
  if (params instanceof URLSearchParams) {
    url.search = params.toString()
  } else if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, value)
    })
  }
  return url.toString()
}

function sanitizeFilename(filename: string) {
  return filename.replace(/[\\/:*?"<>|]+/g, '-').trim()
}

function parseFilenameFromDisposition(contentDisposition: string | null) {
  if (!contentDisposition) {
    return null
  }

  const utf8Match = contentDisposition.match(/filename\*\s*=\s*utf-8''([^;]+)/i)
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1])
    } catch {
      return utf8Match[1]
    }
  }

  const basicMatch =
    contentDisposition.match(/filename\s*=\s*"([^"]+)"/i) ??
    contentDisposition.match(/filename\s*=\s*([^;]+)/i)
  return basicMatch?.[1]?.trim() ?? null
}

function triggerBrowserDownload(downloadUrl: string, filename?: string | null) {
  const anchor = document.createElement('a')
  anchor.href = downloadUrl
  if (filename) {
    anchor.download = filename
  }
  anchor.rel = 'noopener noreferrer'
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

export async function downloadVideoFile(
  url: string,
  formatId: string,
  fallbackFilename?: string,
) {
  const params = new URLSearchParams({
    url,
    format_id: formatId,
  })
  const response = await fetch(getApiAssetUrl('/api/video/download', params), { credentials: 'include' })

  if (!response.ok) {
    const rawText = await response.text()
    try {
      const body = rawText ? (JSON.parse(rawText) as ApiResponse<null>) : null
      throw new Error(body?.error?.message ?? `下载失败（HTTP ${response.status}），请稍后重试。`)
    } catch {
      throw new Error(`下载失败（HTTP ${response.status}），请稍后重试。`)
    }
  }

  const blob = await response.blob()
  const filename =
    parseFilenameFromDisposition(response.headers.get('content-disposition')) ??
    (fallbackFilename ? sanitizeFilename(fallbackFilename) : null)
  const objectUrl = URL.createObjectURL(blob)
  try {
    triggerBrowserDownload(objectUrl, filename)
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
  }
}
