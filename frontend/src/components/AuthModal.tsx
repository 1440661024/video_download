import { LoaderCircle, X } from 'lucide-react'
import { useState } from 'react'

import { login, register } from '../lib/auth-api'
import type { UserMe } from '../lib/auth-api'

type Mode = 'login' | 'register'

export function AuthModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean
  onClose: () => void
  onSuccess: (user: UserMe) => void
}) {
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  if (!open) {
    return null
  }

  async function handleSubmit() {
    setError(null)
    setPending(true)
    try {
      const user = mode === 'login' ? await login(email.trim(), password) : await register(email.trim(), password)
      onSuccess(user)
      setPassword('')
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 p-4">
      <div className="absolute inset-0" aria-hidden onClick={() => !pending && onClose()} />
      <div className="relative z-10 w-full max-w-md rounded-[1.5rem] border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900">{mode === 'login' ? '登录' : '注册账号'}</h2>
            <p className="mt-1 text-sm text-slate-500">使用邮箱与密码；登录后可购买 AI 会员。</p>
          </div>
          <button
            type="button"
            onClick={() => !pending && onClose()}
            className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="关闭"
          >
            <X size={20} />
          </button>
        </div>

        <div className="mt-5 flex rounded-xl bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => setMode('login')}
            className={`flex-1 rounded-lg py-2 text-sm font-semibold transition ${
              mode === 'login' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
            }`}
          >
            登录
          </button>
          <button
            type="button"
            onClick={() => setMode('register')}
            className={`flex-1 rounded-lg py-2 text-sm font-semibold transition ${
              mode === 'register' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
            }`}
          >
            注册
          </button>
        </div>

        <label className="mt-5 block text-sm font-medium text-slate-700">
          邮箱
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1.5 w-full rounded-xl border border-slate-200 px-4 py-3 text-slate-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            placeholder="you@example.com"
          />
        </label>

        <label className="mt-4 block text-sm font-medium text-slate-700">
          密码
          <input
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1.5 w-full rounded-xl border border-slate-200 px-4 py-3 text-slate-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            placeholder={mode === 'register' ? '至少 8 位' : '••••••••'}
          />
        </label>

        {error ? (
          <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
        ) : null}

        <button
          type="button"
          disabled={pending || !email.trim() || !password}
          onClick={() => void handleSubmit()}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3.5 text-sm font-semibold text-white shadow-lg shadow-blue-600/25 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
        >
          {pending ? <LoaderCircle className="animate-spin" size={18} /> : null}
          {mode === 'login' ? '登录' : '注册并登录'}
        </button>
      </div>
    </div>
  )
}
