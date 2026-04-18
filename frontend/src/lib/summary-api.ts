import type { VideoMindmapResponse, VideoTranscriptResponse } from '../types-summary'

const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ||
  'http://127.0.0.1:8000'

function buildApiUrl(path: string) {
  return `${API_BASE_URL}${path}`
}

function buildStreamUrl(path: string, params: Record<string, string>) {
  const search = new URLSearchParams(params)
  return `${buildApiUrl(path)}?${search.toString()}`
}

async function requestJson<T>(path: string): Promise<T> {
  const response = await fetch(buildApiUrl(path))
  const payload = (await response.json()) as T & { error?: string }
  if (!response.ok) {
    const message = typeof payload === 'object' && payload && 'error' in payload ? payload.error : null
    throw new Error(message || `请求失败（HTTP ${response.status}）`)
  }
  return payload
}

export function parseSummaryStreamError(raw: string) {
  try {
    const payload = JSON.parse(raw) as { message?: string }
    return payload.message || 'AI 请求失败，请稍后重试。'
  } catch {
    return raw || 'AI 请求失败，请稍后重试。'
  }
}

export function openVideoSummaryStream(url: string, preferredLanguage = 'zh-CN') {
  return new EventSource(
    buildStreamUrl('/api/summarize', {
      video_url: url,
      preferred_language: preferredLanguage,
    }),
  )
}

export function openVideoQuestionStream(
  url: string,
  question: string,
  preferredLanguage = 'zh-CN',
) {
  return new EventSource(
    buildStreamUrl('/api/qa', {
      video_url: url,
      question,
      preferred_language: preferredLanguage,
    }),
  )
}

export function getVideoMindmap(url: string, preferredLanguage = 'zh-CN') {
  const search = new URLSearchParams({
    video_url: url,
    preferred_language: preferredLanguage,
  })
  return requestJson<VideoMindmapResponse>(`/api/mindmap?${search.toString()}`)
}

export function getVideoTranscript(url: string, preferredLanguage = 'zh-CN') {
  const search = new URLSearchParams({
    video_url: url,
    preferred_language: preferredLanguage,
  })
  return requestJson<VideoTranscriptResponse>(`/api/transcript?${search.toString()}`)
}
