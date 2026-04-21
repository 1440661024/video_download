import type { VideoMindmapResponse, VideoTranscriptResponse } from '../types-summary'

import { API_BASE_URL } from './api'

function buildApiUrl(path: string) {
  return `${API_BASE_URL}${path}`
}

function buildStreamUrl(path: string, params: Record<string, string>) {
  const search = new URLSearchParams(params)
  return `${buildApiUrl(path)}?${search.toString()}`
}

async function requestJson<T>(path: string): Promise<T> {
  const response = await fetch(buildApiUrl(path), { credentials: 'include' })
  const payload = (await response.json()) as T & {
    error?: string | { code?: string; message?: string }
    detail?: { error?: { message?: string } }
  }
  if (!response.ok) {
    const message =
      typeof payload?.error === 'string'
        ? payload.error
        : payload?.error?.message ?? payload?.detail?.error?.message ?? null
    throw new Error(message || `Request failed (HTTP ${response.status})`)
  }
  return payload
}

export function parseSummaryStreamError(raw: string) {
  const fallbackMessage = 'AI request failed, please try again later.'
  try {
    const payload = JSON.parse(raw) as { code?: string; message?: string }
    if (payload.message && payload.code) {
      return `${payload.message} (${payload.code})`
    }
    return payload.message || fallbackMessage
  } catch {
    return raw || fallbackMessage
  }
}

export function openVideoSummaryStream(url: string, preferredLanguage = 'zh-CN') {
  return new EventSource(
    buildStreamUrl('/api/summarize', {
      video_url: url,
      preferred_language: preferredLanguage,
    }),
    { withCredentials: true },
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
    { withCredentials: true },
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
