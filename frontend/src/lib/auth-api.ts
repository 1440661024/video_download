import type { ApiResponse } from '../types'

const env = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '')
export const AUTH_API_BASE = env !== undefined && env !== '' ? env : ''

function buildUrl(path: string) {
  return `${AUTH_API_BASE}${path}`
}

async function parseApiResponse<T>(response: Response): Promise<ApiResponse<T>> {
  const rawText = await response.text()
  try {
    return rawText
      ? (JSON.parse(rawText) as ApiResponse<T>)
      : { success: false, data: null, error: null }
  } catch {
    return { success: false, data: null, error: null }
  }
}

export type UserMe = {
  id: number
  email: string
  is_ai_member: boolean
  ai_membership_until: string | null
  free_ai_summaries_remaining_today: number
}

export async function fetchMe(): Promise<UserMe | null> {
  const res = await fetch(buildUrl('/api/auth/me'), { credentials: 'include' })
  const body = await parseApiResponse<UserMe | null>(res)
  if (!res.ok || !body.success) {
    return null
  }
  return body.data ?? null
}

export async function register(email: string, password: string): Promise<UserMe> {
  const res = await fetch(buildUrl('/api/auth/register'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const body = await parseApiResponse<UserMe>(res)
  if (!res.ok || !body.success || !body.data) {
    throw new Error(body.error?.message ?? '注册失败')
  }
  return body.data
}

export async function login(email: string, password: string): Promise<UserMe> {
  const res = await fetch(buildUrl('/api/auth/login'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const body = await parseApiResponse<UserMe>(res)
  if (!res.ok || !body.success || !body.data) {
    throw new Error(body.error?.message ?? '登录失败')
  }
  return body.data
}

export async function logout(): Promise<void> {
  await fetch(buildUrl('/api/auth/logout'), { method: 'POST', credentials: 'include' })
}

export async function createCheckoutSession(): Promise<string> {
  const res = await fetch(buildUrl('/api/billing/create-checkout-session'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  })
  const body = await parseApiResponse<{ checkout_url: string }>(res)
  if (!res.ok || !body.success || !body.data?.checkout_url) {
    throw new Error(body.error?.message ?? '无法创建支付会话')
  }
  return body.data.checkout_url
}

export async function fetchCheckoutSessionStatus(sessionId: string): Promise<{
  payment_status: string
  status: string
} | null> {
  const res = await fetch(buildUrl(`/api/billing/checkout-session/${encodeURIComponent(sessionId)}`), {
    credentials: 'include',
  })
  const body = await parseApiResponse<{ payment_status: string; status: string }>(res)
  if (!res.ok || !body.success || !body.data) {
    return null
  }
  return body.data
}
