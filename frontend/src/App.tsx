import {
  ChevronDown,
  BadgeCheck,
  CircleAlert,
  Clapperboard,
  Crown,
  Download,
  Star,
  Headphones,
  Link2,
  LoaderCircle,
  MessageCircle,
  Music4,
  PlayCircle,
  Smartphone,
  Sparkles,
  Tv,
  User,
  Video,
  Zap,
} from 'lucide-react'
import { startTransition, useEffect, useMemo, useState } from 'react'

import { AuthModal } from './components/AuthModal'
import { VideoSummaryPanel } from './components/VideoSummaryPanel'
import { createCheckoutSession, fetchCheckoutSessionStatus, fetchMe, logout } from './lib/auth-api'
import type { UserMe } from './lib/auth-api'
import { downloadVideoFile, getApiAssetUrl, getDownloadLink, parseVideo } from './lib/api'
import type { VideoFormatOption, VideoMeta } from './types'

const platformPills = ['抖音', 'YouTube', 'Bilibili', 'TikTok / X']

const featureCards = [
  {
    id: 'platforms',
    title: '支持 1800+ 平台',
    text: 'YouTube、Bilibili、抖音、TikTok、Twitter、Instagram 等全球主流平台。',
    icon: BadgeCheck,
    tint: 'bg-sky-50 text-sky-500',
  },
  {
    id: 'speed',
    title: '极速解析下载',
    text: '智能解析视频链接，自动匹配最优下载方式，速度快人一步。',
    icon: Zap,
    tint: 'bg-amber-50 text-amber-500',
  },
  {
    id: 'mobile',
    title: '手机也能用',
    text: '完美适配手机浏览器，随时随地，想下就下，无需安装任何 App。',
    icon: Smartphone,
    tint: 'bg-blue-50 text-blue-500',
  },
  {
    id: 'quality',
    title: '多种清晰度',
    text: '支持从 360p 到 4K 多种清晰度选择，满足不同场景需求。',
    icon: Clapperboard,
    tint: 'bg-violet-50 text-violet-500',
  },
  {
    id: 'ai',
    title: 'AI 视频总结',
    text: 'AI 智能分析视频内容，一键生成摘要、思维导图，还能针对视频提问。',
    icon: Sparkles,
    tint: 'bg-rose-50 text-rose-500',
  },
]

const usageSteps = [
  {
    id: '01',
    title: '复制视频链接',
    text: '在 YouTube、Bilibili、抖音等平台上找到想要下载的视频，复制视频的分享链接或地址栏 URL。',
  },
  {
    id: '02',
    title: '粘贴链接并解析',
    text: '打开 SaveAny，将复制的链接粘贴到输入框中，点击“解析视频”。系统会自动识别平台并解析出视频信息和可用清晰度。',
  },
  {
    id: '03',
    title: '选择清晰度并下载',
    text: '从解析结果中选择想要的清晰度，点击下载按钮即可保存到本地。还可以使用 AI 总结功能自动生成视频摘要和思维导图。',
  },
]

const comparisonRows = [
  {
    label: '支持平台数量',
    saveAny: '1800+',
    onlineTools: '10-50',
    desktopApps: '100-500',
  },
  {
    label: 'AI 视频总结',
    saveAny: '✓',
    onlineTools: '×',
    desktopApps: '×',
  },
  {
    label: '思维导图生成',
    saveAny: '✓',
    onlineTools: '×',
    desktopApps: '×',
  },
  {
    label: '字幕下载',
    saveAny: 'SRT/VTT/TXT',
    onlineTools: '部分支持',
    desktopApps: '部分支持',
  },
  {
    label: '抖音无水印下载',
    saveAny: '✓',
    onlineTools: '部分支持',
    desktopApps: '需登录',
  },
  {
    label: '最高画质',
    saveAny: '4K',
    onlineTools: '720p-1080p',
    desktopApps: '4K',
  },
  {
    label: '无需安装',
    saveAny: '✓',
    onlineTools: '✓',
    desktopApps: '×',
  },
  {
    label: '手机浏览器可用',
    saveAny: '✓',
    onlineTools: '部分支持',
    desktopApps: '×',
  },
  {
    label: '费用',
    saveAny: '免费',
    onlineTools: '免费/付费',
    desktopApps: '付费为主',
  },
]

const platformBadges = [
  { name: 'YouTube', icon: PlayCircle },
  { name: 'Bilibili', icon: Tv },
  { name: '抖音 / TikTok', icon: Music4 },
  { name: 'Twitter / X', icon: Sparkles },
  { name: 'Instagram', icon: BadgeCheck },
  { name: 'Facebook', icon: Smartphone },
  { name: 'Vimeo', icon: Clapperboard },
  { name: 'Reddit', icon: CircleAlert },
  { name: 'Pinterest', icon: Zap },
  { name: '微博', icon: MessageCircle },
  { name: 'Twitch', icon: Crown },
  { name: 'SoundCloud', icon: Headphones },
]

const freePlanFeatures = ['无限次视频下载', '支持 1800+ 平台', '基础视频信息解析', '每日 1 次 AI 视频总结']

const vipPlanFeatures = [
  '无限次 AI 视频总结',
  'AI 思维导图生成',
  'AI 视频问答',
  '字幕下载与导出',
  '专属客服优先支持',
]

function getCanonicalVideoUrl(result: VideoMeta) {
  return result.webpage_url ?? result.source_url
}

function getThumbnailSrc(result: VideoMeta) {
  if (!result.thumbnail) {
    return null
  }

  if (!/^https?:\/\//i.test(result.thumbnail)) {
    return result.thumbnail
  }

  const params = new URLSearchParams({
    url: result.thumbnail,
    source_url: result.webpage_url ?? result.source_url,
  })
  return getApiAssetUrl('/api/video/thumbnail', params)
}

function formatMembershipUntil(value: string | null) {
  if (!value) {
    return null
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return null
  }

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

async function waitForMembershipRefresh(sessionId: string | null) {
  const maxAttempts = sessionId ? 6 : 3

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (sessionId) {
      const checkout = await fetchCheckoutSessionStatus(sessionId)
      if (checkout?.payment_status !== 'paid') {
        await new Promise((resolve) => window.setTimeout(resolve, 1200))
        continue
      }
    }

    const next = await fetchMe()
    if (next?.is_ai_member) {
      return next
    }

    await new Promise((resolve) => window.setTimeout(resolve, 1200))
  }

  return fetchMe()
}

function App() {
  const [url, setUrl] = useState('')
  const [result, setResult] = useState<VideoMeta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [selectedFormat, setSelectedFormat] = useState('')
  const [isParsing, setIsParsing] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)

  const [me, setMe] = useState<UserMe | null | undefined>(undefined)
  const [authOpen, setAuthOpen] = useState(false)
  const [checkoutBusy, setCheckoutBusy] = useState(false)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)

  async function refreshMe() {
    const next = await fetchMe()
    setMe(next)
    return next
  }

  useEffect(() => {
    void (async () => {
      const u = new URL(window.location.href)
      const billing = u.searchParams.get('billing')
      const sessionId = u.searchParams.get('session_id')
      let next: UserMe | null

      if (billing === 'success' || billing === 'cancel') {
        u.searchParams.delete('billing')
        u.searchParams.delete('session_id')
        window.history.replaceState({}, '', `${u.pathname}${u.search}`)
        if (billing === 'cancel') {
          setSuccessMessage(null)
          setError('已取消支付。')
          next = await fetchMe()
        } else {
          next = await waitForMembershipRefresh(sessionId)
          if (next?.is_ai_member) {
            setSuccessMessage('VIP 开通成功！已为你激活全部高级功能')
            setError(null)
          } else {
            setSuccessMessage(null)
            setError('支付已完成，但会员权益尚未同步到账号。请稍后刷新页面，或联系我处理。')
          }
        }
      } else {
        next = await fetchMe()
      }

      setMe(next)
    })()
  }, [])

  useEffect(() => {
    function handleWindowClick() {
      setAccountMenuOpen(false)
    }

    if (!accountMenuOpen) {
      return
    }

    window.addEventListener('click', handleWindowClick)
    return () => window.removeEventListener('click', handleWindowClick)
  }, [accountMenuOpen])

  async function handleStartCheckout() {
    if (!me) {
      setAuthOpen(true)
      return
    }
    setCheckoutBusy(true)
    setError(null)
    try {
      const checkoutUrl = await createCheckoutSession()
      window.location.assign(checkoutUrl)
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : '支付初始化失败')
    } finally {
      setCheckoutBusy(false)
    }
  }

  const recommendedFormat = useMemo(
    () => result?.formats.find((item) => item.recommended) ?? result?.formats[0] ?? null,
    [result],
  )
  const membershipUntilText = me?.is_ai_member ? formatMembershipUntil(me.ai_membership_until) : null

  const selectedFormatOption =
    result?.formats.find((item) => item.format_id === selectedFormat) ?? recommendedFormat
  const thumbnailSrc = result ? getThumbnailSrc(result) : null
  const canonicalVideoUrl = result ? getCanonicalVideoUrl(result) : null

  async function handleParse() {
    const nextUrl = url.trim()
    if (!nextUrl) {
      setError('请先粘贴一个公开视频链接。')
      return
    }

    setIsParsing(true)
    setError(null)

    try {
      const data = await parseVideo(nextUrl)
      startTransition(() => {
        setResult(data)
        setSelectedFormat(
          data.formats.find((item) => item.recommended)?.format_id ?? data.formats[0]?.format_id ?? '',
        )
      })
    } catch (parseError) {
      setResult(null)
      setSelectedFormat('')
      setError(parseError instanceof Error ? parseError.message : '解析失败，请稍后重试。')
    } finally {
      setIsParsing(false)
    }
  }

  async function handleDownload() {
    if (!result || !selectedFormat) {
      setError('请先完成解析并选择一个下载格式。')
      return
    }

    setIsDownloading(true)
    setError(null)

    try {
      const payload = await getDownloadLink(canonicalVideoUrl ?? result.source_url, selectedFormat)
      if (payload.url && payload.strategy.mode === 'direct') {
        const anchor = document.createElement('a')
        anchor.href = payload.url
        anchor.rel = 'noopener noreferrer'
        anchor.style.display = 'none'
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
        return
      }

      await downloadVideoFile(
        canonicalVideoUrl ?? result.source_url,
        selectedFormat,
        `${result.title}.${selectedFormatOption?.ext ?? 'mp4'}`,
      )
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : '下载失败，请稍后重试。')
    } finally {
      setIsDownloading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.14),_rgba(255,255,255,0)_30%),linear-gradient(180deg,_#ffffff_0%,_#f8fbff_58%,_#ffffff_100%)] text-slate-900">
      <header className="sticky top-4 z-20 px-4 sm:px-6 lg:px-10">
        <div className="mx-auto w-full rounded-full border border-white/70 bg-white/92 px-6 py-4 shadow-[0_10px_30px_rgba(15,23,42,0.07)] backdrop-blur">
          <div className="mx-auto flex w-full max-w-[1680px] items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-[0_14px_30px_rgba(59,130,246,0.3)]">
                <Video size={20} />
              </div>
              <div className="flex items-center gap-4">
                <p className="text-lg font-semibold text-slate-900">SaveAny</p>
                <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-400">
                  万能视频下载
                </span>
              </div>
            </div>

            <nav className="hidden items-center gap-12 text-lg font-medium text-slate-500 md:flex">
              <a href="#why-zjtools" className="transition hover:text-slate-900">
                功能特性
              </a>
              <a href="#how-to-use" className="transition hover:text-slate-900">
                使用教程
              </a>
              <a href="#comparison" className="transition hover:text-slate-900">
                工具对比
              </a>
              <a href="#plans" className="transition hover:text-slate-900">
                套餐价格
              </a>
            </nav>

            <div className="flex flex-wrap items-center justify-end gap-2">
              {!me ? (
                <button
                  type="button"
                  disabled={checkoutBusy}
                  onClick={() => {
                    setAuthOpen(true)
                  }}
                  className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-600 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {checkoutBusy ? <LoaderCircle className="animate-spin" size={16} /> : <Crown size={16} />}
                  登录 / 开通 AI
                </button>
              ) : (
                <div className="relative">
                  <div className="flex items-center gap-2">
                    {me.is_ai_member ? (
                      <span className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-[linear-gradient(180deg,_#fbbf24,_#f59e0b)] px-5 py-2.5 text-base font-bold text-white shadow-[0_10px_24px_rgba(245,158,11,0.25)]">
                        <Star size={17} className="fill-white text-white" />
                        VIP
                      </span>
                    ) : null}

                    {!me.is_ai_member ? (
                      <button
                        type="button"
                        disabled={checkoutBusy}
                        onClick={() => void handleStartCheckout()}
                        className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-5 py-2.5 text-base font-semibold text-blue-600 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {checkoutBusy ? <LoaderCircle className="animate-spin" size={17} /> : <Crown size={17} />}
                        开通 VIP
                      </button>
                    ) : null}

                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        setAccountMenuOpen((open) => !open)
                      }}
                      className="inline-flex items-center gap-3 rounded-full bg-white px-3.5 py-2.5 text-base font-semibold text-slate-700 shadow-[0_10px_24px_rgba(148,163,184,0.14)] ring-1 ring-slate-200 transition hover:bg-slate-50"
                    >
                      <span className="flex size-11 items-center justify-center rounded-full bg-blue-500 text-lg font-black text-white">
                        {me.is_ai_member ? 'V' : '普'}
                      </span>
                      <ChevronDown
                        size={19}
                        className={`text-slate-400 transition ${accountMenuOpen ? 'rotate-180' : ''}`}
                      />
                    </button>
                  </div>

                  {accountMenuOpen ? (
                    <div
                      className="absolute right-0 z-30 mt-3 w-[20rem] overflow-hidden rounded-[1.6rem] border border-slate-200 bg-white shadow-[0_24px_54px_rgba(15,23,42,0.14)]"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <div className="border-b border-slate-100 px-5 py-5">
                        <p className="truncate text-lg font-bold text-slate-900" title={me.email}>
                          {me.email}
                        </p>
                        <p className="mt-1 text-sm font-medium text-slate-400">
                          {me.is_ai_member ? 'AI 会员' : '免费用户'}
                        </p>
                        {membershipUntilText ? (
                          <p className="mt-1 text-xs font-medium text-slate-400">
                            到期时间：{membershipUntilText}
                          </p>
                        ) : null}
                      </div>

                      <div className="px-4 py-3">
                        <button
                          type="button"
                          disabled={checkoutBusy}
                          onClick={() => {
                            setAccountMenuOpen(false)
                            if (!me.is_ai_member) {
                              void handleStartCheckout()
                            }
                          }}
                          className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-[1.05rem] font-semibold text-blue-500 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {checkoutBusy ? <LoaderCircle className="animate-spin" size={18} /> : <Crown size={18} />}
                          {me.is_ai_member ? '已开通 AI 会员' : '开通 VIP'}
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setAccountMenuOpen(false)
                            void logout().then(() => setMe(null))
                          }}
                          className="mt-1 flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-[1.05rem] font-semibold text-slate-500 transition hover:bg-slate-50 hover:text-slate-800"
                        >
                          <CircleAlert size={18} />
                          退出登录
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1240px] px-4 pb-24 pt-5 sm:px-6 lg:px-8">
        <main>
          <section className="flex min-h-[calc(100vh-5.5rem)] flex-col items-center justify-center py-14 lg:min-h-[calc(100vh-2rem)] lg:pb-24 lg:pt-20">
            <div className="w-full text-center">
              {successMessage ? (
                <div className="mx-auto mb-8 flex max-w-3xl items-center justify-center gap-3 rounded-full border border-emerald-200 bg-emerald-50 px-6 py-4 text-center text-lg font-semibold text-emerald-700 shadow-[0_16px_36px_rgba(34,197,94,0.12)]">
                  <BadgeCheck size={22} />
                  <p>{successMessage}</p>
                </div>
              ) : null}

              <h1 className="text-4xl font-black leading-[1.12] tracking-[-0.012em] text-slate-950 sm:text-5xl lg:text-[4.6rem]">
                万能视频下载器，
                <span className="text-blue-500">一键保存</span>
              </h1>
              <p className="mx-auto mt-6 max-w-4xl text-base leading-8 text-slate-500 sm:text-lg">
                SaveAny 是一款面向学习、整理与内容留存场景的
                <strong className="font-semibold text-slate-700">在线视频下载器</strong>，
                支持 YouTube、抖音、Bilibili、TikTok 等主流公开平台链接解析下载，并提供
                <strong className="font-semibold text-slate-700">AI 视频总结、字幕提取与思维导图</strong>
                能力。
              </p>

              <div className="mx-auto mt-9 max-w-[70rem] rounded-[2.2rem] border border-white/80 bg-white/95 p-4 shadow-[0_24px_64px_rgba(15,23,42,0.08)]">
                <div className="flex flex-col gap-3 sm:flex-row">
                  <label className="flex min-w-0 flex-1 items-center gap-3 rounded-[1.45rem] border border-slate-200 bg-white px-5 py-4 shadow-sm transition focus-within:border-blue-200 focus-within:ring-4 focus-within:ring-blue-100">
                    <Link2 className="shrink-0 text-slate-400" size={18} />
                    <input
                      value={url}
                      onChange={(event) => setUrl(event.target.value)}
                      placeholder="https://www.douyin.com/video/..."
                      className="w-full min-w-0 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400 sm:text-lg"
                    />
                  </label>
                  <button
                    onClick={handleParse}
                    disabled={isParsing}
                    className="inline-flex items-center justify-center gap-2 rounded-[1.45rem] bg-blue-500 px-7 py-4 text-sm font-semibold text-white shadow-[0_16px_32px_rgba(59,130,246,0.28)] transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-blue-300 sm:min-w-[12rem] sm:px-9 sm:text-lg"
                  >
                    {isParsing ? <LoaderCircle className="animate-spin" size={18} /> : <Sparkles size={18} />}
                    {isParsing ? '解析中...' : '解析视频'}
                  </button>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-center gap-4 text-xs text-slate-400 sm:text-sm">
                  {platformPills.map((platform) => (
                    <span key={platform}>{platform}</span>
                  ))}
                </div>
              </div>

              {error ? (
                <div className="mx-auto mt-6 flex max-w-3xl items-start gap-3 rounded-[1.4rem] border border-rose-200 bg-rose-50 px-4 py-4 text-left text-sm text-rose-700">
                  <CircleAlert className="mt-0.5 shrink-0" size={18} />
                  <p>{error}</p>
                </div>
              ) : null}

              <div
                id="result-panel"
                className="mx-auto mt-12 w-full rounded-[2.5rem] border border-slate-200 bg-white/96 p-5 shadow-[0_28px_64px_rgba(15,23,42,0.09)] sm:p-7"
              >
                {result ? (
                  <ResultCard
                    result={result}
                    thumbnailSrc={thumbnailSrc}
                    selectedFormat={selectedFormat}
                    selectedFormatOption={selectedFormatOption}
                    isDownloading={isDownloading}
                    onSelect={setSelectedFormat}
                    onDownload={handleDownload}
                    me={me}
                    checkoutBusy={checkoutBusy}
                    onOpenAuth={() => setAuthOpen(true)}
                    onStartCheckout={() => void handleStartCheckout()}
                    onRefreshMe={() => void refreshMe()}
                  />
                ) : (
                  <EmptyResult />
                )}
              </div>
            </div>
          </section>

          <section id="why-zjtools" className="pt-20">
            <div className="mx-auto max-w-5xl text-center">
              <h2 className="text-4xl font-black leading-[1.12] tracking-[-0.02em] text-slate-950 sm:text-5xl lg:text-[4.2rem]">
                为什么选择 <span className="text-blue-500">SaveAny</span> 视频下载器
              </h2>
              <p className="mx-auto mt-5 max-w-4xl text-lg leading-9 text-slate-400 sm:text-[1.55rem]">
                简单、快速、强大的在线视频下载体验，支持 AI 智能总结
              </p>
            </div>

            <div className="mx-auto mt-14 grid max-w-[1120px] gap-5 md:grid-cols-2 xl:grid-cols-5">
              {featureCards.map((item) => (
                <FeatureCard key={item.id} title={item.title} text={item.text} tint={item.tint} icon={item.icon} />
              ))}
            </div>
          </section>

          <section id="how-to-use" className="pt-20">
            <div className="mx-auto max-w-6xl text-center">
              <h2 className="text-4xl font-black leading-[1.12] tracking-[-0.02em] text-slate-950 sm:text-5xl">
                如何使用 <span className="text-blue-500">SaveAny</span> 下载视频
              </h2>
              <p className="mx-auto mt-5 max-w-4xl text-lg leading-9 text-slate-400 sm:text-[1.55rem]">
                只需 3 步，即可免费下载 YouTube、Bilibili、抖音等 1800+ 平台的视频
              </p>

              <div className="mt-16 grid gap-10 lg:grid-cols-[1fr_auto_1fr_auto_1fr] lg:items-start">
                {usageSteps.map((step, index) => (
                  <div key={step.id} className="contents">
                    <article className="flex flex-col items-center text-center">
                      <div className="flex size-[5.25rem] items-center justify-center rounded-[1.5rem] bg-blue-50 text-[2rem] font-black text-blue-500 shadow-[0_18px_40px_rgba(59,130,246,0.1)]">
                        {step.id}
                      </div>
                      <h3 className="mt-8 text-[2rem] font-black leading-[1.2] tracking-[-0.015em] text-slate-950">
                        {step.title}
                      </h3>
                      <p className="mt-5 max-w-[22rem] text-lg leading-10 text-slate-500">
                        {step.text}
                      </p>
                    </article>

                    {index < usageSteps.length - 1 ? (
                      <div className="hidden pt-8 lg:flex lg:items-start lg:justify-center">
                        <span className="text-[3rem] font-light leading-none text-slate-200">›</span>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>

              <p className="mt-14 text-base leading-8 text-slate-400 sm:text-lg">
                下载可直接使用；普通用户每天可免费体验 1 次 AI 总结，会员可不限次数使用。手机浏览器也可操作。更新于 2026 年 4 月。
              </p>
            </div>
          </section>

          <section id="comparison" className="pt-20">
            <div className="mx-auto max-w-6xl">
              <div className="text-center">
                <h2 className="text-4xl font-black leading-[1.12] tracking-[-0.02em] text-slate-950 sm:text-5xl">
                  SaveAny 与其他视频下载工具对比
                </h2>
                <p className="mx-auto mt-5 max-w-4xl text-lg leading-9 text-slate-400 sm:text-[1.55rem]">
                  一张表看清 SaveAny 的核心优势，更新于 2026 年 4 月
                </p>
              </div>

              <div className="mt-12 overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-[0_18px_48px_rgba(148,163,184,0.14)]">
                <div className="overflow-x-auto">
                  <table className="min-w-full border-collapse text-left">
                    <thead className="bg-slate-50/80">
                      <tr>
                        <th className="px-8 py-6 text-lg font-black text-slate-950">功能对比</th>
                        <th className="px-8 py-6 text-lg font-black text-blue-500">SaveAny</th>
                        <th className="px-8 py-6 text-lg font-black text-slate-950">其他在线工具</th>
                        <th className="px-8 py-6 text-lg font-black text-slate-950">桌面下载软件</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparisonRows.map((row, index) => (
                        <tr
                          key={row.label}
                          className={index < comparisonRows.length - 1 ? 'border-t border-slate-100' : ''}
                        >
                          <td className="px-8 py-6 text-[1.12rem] font-semibold text-slate-900">{row.label}</td>
                          <td className="px-8 py-6 text-[1.12rem] text-slate-700">{row.saveAny}</td>
                          <td className="px-8 py-6 text-[1.12rem] text-slate-400">{row.onlineTools}</td>
                          <td className="px-8 py-6 text-[1.12rem] text-slate-400">{row.desktopApps}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </section>

          <section id="plans" className="pt-20">
            <div className="mx-auto max-w-6xl">
              <div className="text-center">
                <h2 className="text-4xl font-black leading-[1.12] tracking-[-0.02em] text-slate-950 sm:text-5xl">
                  选择适合你的视频下载方案
                </h2>
                <p className="mx-auto mt-5 max-w-4xl text-lg leading-9 text-slate-400 sm:text-[1.55rem]">
                  免费版满足日常视频下载需求，VIP 解锁无限 AI 视频总结等全部高级功能
                </p>
              </div>

              <div className="mt-14 grid gap-8 lg:grid-cols-2">
                <article className="flex h-full flex-col rounded-[2rem] border border-slate-200 bg-white px-8 py-8 shadow-[0_18px_48px_rgba(148,163,184,0.12)]">
                  <h3 className="text-3xl font-black text-slate-950">免费版</h3>
                  <p className="mt-3 text-lg text-slate-400">满足基础下载需求</p>

                  <div className="mt-10 flex items-end gap-2">
                    <span className="text-[4rem] font-black leading-none text-slate-950">¥0</span>
                    <span className="pb-2 text-[1.75rem] text-slate-300">/ 永久</span>
                  </div>

                  <div className="mt-10 space-y-5">
                    {freePlanFeatures.map((feature) => (
                      <div key={feature} className="flex items-center gap-4 text-lg text-slate-500">
                        <BadgeCheck className="shrink-0 text-emerald-500" size={22} />
                        <span>{feature}</span>
                      </div>
                    ))}
                  </div>

                  <div className="mt-auto pt-14">
                    <button
                      type="button"
                      className="w-full rounded-full border border-slate-200 bg-slate-50 px-6 py-4 text-xl font-bold text-slate-500"
                      disabled
                    >
                      当前方案
                    </button>
                  </div>
                </article>

                <article className="relative flex h-full flex-col overflow-hidden rounded-[2rem] bg-[linear-gradient(180deg,_#3b82f6,_#2563eb)] px-8 py-8 text-white shadow-[0_24px_64px_rgba(37,99,235,0.3)]">
                  <div className="absolute right-[-3rem] top-[-3rem] size-[15rem] rounded-full bg-white/8" />
                  <div className="relative flex h-full flex-col">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-3xl font-black">VIP 高级版</h3>
                        <p className="mt-3 text-lg text-blue-100">解锁全部功能，无限制使用</p>
                      </div>
                      <span className="inline-flex items-center gap-2 rounded-full bg-white/16 px-4 py-2 text-base font-semibold text-white">
                        <Sparkles size={16} />
                        推荐
                      </span>
                    </div>

                    <div className="mt-10 flex items-end gap-2">
                      <span className="text-[4rem] font-black leading-none">¥9.9</span>
                      <span className="pb-2 text-[1.75rem] text-blue-100">/ 月</span>
                      <span className="mb-3 ml-2 rounded-full bg-white/14 px-3 py-1 text-sm font-semibold text-white">
                        限时优惠
                      </span>
                    </div>

                    <div className="mt-10 space-y-5">
                      {vipPlanFeatures.map((feature) => (
                        <div key={feature} className="flex items-center gap-4 text-xl text-white">
                          <BadgeCheck className="shrink-0 text-amber-300" size={22} />
                          <span>{feature}</span>
                        </div>
                      ))}
                    </div>

                    <div className="mt-auto pt-14">
                      <button
                        type="button"
                        disabled={checkoutBusy}
                        onClick={() => {
                          if (!me) {
                            setAuthOpen(true)
                            return
                          }
                          void handleStartCheckout()
                        }}
                        className="w-full rounded-full bg-white px-6 py-4 text-xl font-black text-blue-600 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {checkoutBusy ? '跳转支付中…' : me?.is_ai_member ? '续费 VIP' : '立即开通 VIP'}
                      </button>
                    </div>
                  </div>
                </article>
              </div>
            </div>
          </section>

          <section id="supported-platforms" className="pt-20">
            <div className="mx-auto max-w-6xl text-center">
              <h2 className="text-4xl font-black leading-[1.12] tracking-[-0.02em] text-slate-950 sm:text-5xl">
                支持全球 <span className="text-blue-500">1800+</span> 视频平台下载
              </h2>
              <p className="mx-auto mt-5 max-w-5xl text-lg leading-9 text-slate-400 sm:text-[1.55rem]">
                几乎覆盖所有主流视频、音频、社交媒体平台，包括 YouTube、Bilibili、抖音等
              </p>

              <div className="mx-auto mt-14 grid max-w-6xl gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                {platformBadges.map((item) => {
                  const Icon = item.icon
                  return (
                    <article
                      key={item.name}
                      className="flex items-center justify-center gap-3 rounded-full border border-slate-200 bg-white px-6 py-5 text-center shadow-[0_10px_30px_rgba(148,163,184,0.12)]"
                    >
                      <Icon className="shrink-0 text-blue-500" size={22} />
                      <span className="text-[1.15rem] font-bold text-slate-900">{item.name}</span>
                    </article>
                  )
                })}
              </div>

              <p className="mt-12 text-base leading-8 text-slate-400 sm:text-lg">
                ...以及 Twitter/X、Instagram、Facebook、Vimeo、Dailymotion、SoundCloud 等 1800+
                平台
              </p>
            </div>
          </section>
        </main>

        <footer className="mt-24 border-t border-slate-200/80 pt-10">
          <div className="mx-auto max-w-6xl">
            <p className="mx-auto max-w-5xl text-center text-lg leading-10 text-slate-500 sm:text-[1.42rem]">
              <span className="font-bold text-slate-700">SaveAny</span> 是一款免费在线视频下载器，支持
              <span className="font-semibold text-blue-500"> YouTube</span>、
              <span className="font-semibold text-blue-500"> Bilibili</span>、
              <span className="font-semibold text-blue-500"> 抖音</span>、
              <span className="font-semibold text-blue-500"> TikTok</span> 等 1800+ 平台视频下载，提供
              <span className="font-semibold text-blue-500"> AI 视频总结</span>、思维导图生成、字幕下载等智能功能。
            </p>

            <div className="mt-10 flex flex-col gap-6 rounded-[2rem] border border-slate-200 bg-white px-6 py-6 shadow-[0_10px_30px_rgba(148,163,184,0.1)] sm:px-8 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-4">
                <div className="flex size-12 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-[0_14px_30px_rgba(59,130,246,0.22)]">
                  <Video size={20} />
                </div>
                <p className="text-[1.45rem] font-bold text-slate-900">SaveAny</p>
              </div>

              <p className="flex-1 text-center text-base leading-8 text-slate-400 lg:px-8">
                本工具仅供学习交流使用，请尊重视频版权，勿用于商业用途。下载内容的版权归原作者所有。
              </p>

              <p className="text-right text-[1.15rem] text-slate-400">© 2026 SaveAny</p>
            </div>
          </div>
        </footer>
      </div>

      <AuthModal
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        onSuccess={(user) => {
          setMe(user)
          setAuthOpen(false)
        }}
      />
    </div>
  )
}

function EmptyResult() {
  return (
    <div className="flex min-h-[260px] flex-col items-center justify-center rounded-[1.8rem] bg-[linear-gradient(180deg,_rgba(248,250,252,0.92),_rgba(255,255,255,0.98))] px-6 py-10 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-blue-50 text-blue-500">
        <PlayCircle size={28} />
      </div>
      <h2 className="mt-5 text-2xl font-black leading-[1.2] tracking-[-0.008em] text-slate-950">先粘贴链接，再开始解析</h2>
    </div>
  )
}

function formatViewCount(value: number | null | undefined) {
  if (!value || value <= 0) {
    return '播放量未知'
  }

  if (value >= 100_000_000) {
    return `${(value / 100_000_000).toFixed(value >= 1_000_000_000 ? 0 : 1)}亿播放`
  }

  if (value >= 10_000) {
    return `${(value / 10_000).toFixed(value >= 100_000 ? 0 : 1)}万播放`
  }

  return `${value}次播放`
}

function ResultCard({
  result,
  thumbnailSrc,
  selectedFormat,
  selectedFormatOption,
  isDownloading,
  onSelect,
  onDownload,
  me,
  checkoutBusy,
  onOpenAuth,
  onStartCheckout,
  onRefreshMe,
}: {
  result: VideoMeta
  thumbnailSrc: string | null
  selectedFormat: string
  selectedFormatOption: VideoFormatOption | null
  isDownloading: boolean
  onSelect: (formatId: string) => void
  onDownload: () => void
  me: UserMe | null | undefined
  checkoutBusy: boolean
  onOpenAuth: () => void
  onStartCheckout: () => void
  onRefreshMe: () => void
}) {
  const metaItems = [
    { id: 'uploader', icon: User, text: result.uploader ?? '未知发布者' },
    { id: 'platform', icon: null, text: result.extractor ?? '未知平台' },
    ...(result.view_count && result.view_count > 0
      ? [{ id: 'views', icon: PlayCircle, text: formatViewCount(result.view_count) }]
      : []),
  ]

  return (
    <div className="space-y-7">
      <div className="overflow-hidden rounded-[2rem] border border-slate-200/80 bg-white shadow-[0_18px_45px_rgba(15,23,42,0.06)] transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_24px_56px_rgba(15,23,42,0.1)]">
        <div className="flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-start lg:gap-6 lg:p-7">
          <div className="w-full shrink-0 lg:w-[360px] xl:w-[400px]">
            <div className="relative aspect-video overflow-hidden rounded-[1.5rem] bg-slate-100 shadow-[0_12px_30px_rgba(15,23,42,0.1)]">
              {thumbnailSrc ? (
                <img src={thumbnailSrc} alt={result.title} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(135deg,_#dbeafe,_#eff6ff)] text-blue-600">
                  <Video size={44} />
                </div>
              )}
              <div className="absolute bottom-3 right-3 rounded-full bg-slate-950/72 px-3 py-1 text-sm font-semibold text-white backdrop-blur-sm">
                {result.duration_human}
              </div>
            </div>
          </div>

          <div className="min-w-0 flex-1 text-left">
            <div className="flex flex-wrap items-center gap-3 text-sm text-slate-400">
              <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-500">
                当前视频
              </span>
            </div>

            <h2
              className="mt-4 line-clamp-2 text-[1.95rem] font-black leading-[1.18] tracking-[-0.02em] text-slate-950 xl:text-[2.3rem]"
              title={result.title}
            >
              {result.title}
            </h2>

            <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-slate-500">
              {metaItems.map(({ id, icon: Icon, text }) => (
                <span
                  key={id}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3.5 py-2 font-medium text-slate-600"
                >
                  {Icon ? <Icon size={15} className="text-slate-400" /> : null}
                  <span className="truncate">{text}</span>
                </span>
              ))}
            </div>

          </div>
        </div>
      </div>

      <div className="rounded-[2rem] border border-slate-200 bg-[linear-gradient(180deg,_#fbfdff,_#f8fbff)] p-5 shadow-[0_12px_28px_rgba(15,23,42,0.04)] sm:p-7">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="text-left">
            <p className="text-2xl font-black leading-[1.2] tracking-[-0.008em] text-slate-950 sm:text-3xl">选择清晰度和格式</p>
          </div>
          <span className="w-fit rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-500 shadow-sm">
            已整理为 {result.formats.length} 个下载选项
          </span>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {result.formats.map((format) => (
            <FormatCard
              key={format.format_id}
              format={format}
              active={format.format_id === selectedFormat}
              onSelect={onSelect}
            />
          ))}
        </div>

        <div className="mt-6 flex flex-col gap-4 rounded-[1.75rem] border border-white/80 bg-white px-5 py-5 shadow-[0_18px_40px_rgba(15,23,42,0.05)] lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <button
              onClick={onDownload}
              disabled={!selectedFormatOption || isDownloading}
              className="inline-flex min-w-[14rem] items-center justify-center gap-2 rounded-full bg-blue-500 px-7 py-4 text-lg font-semibold text-white shadow-[0_18px_34px_rgba(59,130,246,0.28)] transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {isDownloading ? <LoaderCircle className="animate-spin" size={20} /> : <Download size={20} />}
              {isDownloading ? '准备下载中...' : '立即下载'}
            </button>
            <VideoSummaryPanel
              result={result}
              isLoggedIn={Boolean(me)}
              canUseAi={Boolean(me?.is_ai_member)}
              freeAiSummariesRemainingToday={me?.free_ai_summaries_remaining_today ?? 0}
              onNeedLogin={onOpenAuth}
              onNeedMembership={onStartCheckout}
              onRefreshMe={onRefreshMe}
              checkoutBusy={checkoutBusy}
            />
          </div>

          <div className="min-w-0 text-left">
            <p className="text-sm font-semibold text-slate-900">已选择</p>
            <p className="mt-1 truncate text-base text-slate-500">
              {selectedFormatOption
                ? `${selectedFormatOption.label} · ${selectedFormatOption.ext.toUpperCase()} · ${selectedFormatOption.filesize_human}`
                : '请选择一个下载格式'}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function FormatCard({
  format,
  active,
  onSelect,
}: {
  format: VideoFormatOption
  active: boolean
  onSelect: (formatId: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(format.format_id)}
      className={`rounded-[1.5rem] border px-5 py-5 text-left transition ${
        active
          ? 'border-blue-400 bg-blue-50 shadow-[0_16px_32px_rgba(59,130,246,0.12)]'
          : 'border-slate-200 bg-white hover:border-blue-200 hover:bg-blue-50/50'
      }`}
    >
      <div className="flex items-start gap-4">
        <div
          className={`flex size-12 shrink-0 items-center justify-center rounded-2xl ${
            active ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-400'
          }`}
        >
          <Video size={20} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[1.05rem] font-bold text-slate-950">
              {format.label} {format.ext.toUpperCase()} ({format.filesize_human})
            </span>
            {format.recommended ? (
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                推荐
              </span>
            ) : null}
          </div>

          <p className="mt-1 text-base text-slate-400">
            {format.ext.toUpperCase()} · {format.download_mode === 'direct' ? '直链下载' : '服务端代理'}
          </p>
        </div>
      </div>
    </button>
  )
}

function FeatureCard({
  title,
  text,
  tint,
  icon: Icon,
}: {
  title: string
  text: string
  tint: string
  icon: typeof BadgeCheck
}) {
  return (
    <article className="flex flex-col rounded-[2rem] border border-slate-100/90 bg-white px-7 py-8 text-left shadow-[0_18px_48px_rgba(148,163,184,0.18)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_24px_56px_rgba(148,163,184,0.24)]">
      <div className={`flex size-[4.6rem] items-center justify-center rounded-[1.35rem] ${tint}`}>
        <Icon size={28} />
      </div>
      <h3 className="mt-7 text-[1.42rem] font-black leading-[1.2] tracking-[-0.015em] text-slate-950 sm:text-[1.56rem]">
        {title}
      </h3>
      <p className="mt-4 text-[0.95rem] leading-8 text-slate-400">
        {text}
      </p>
    </article>
  )
}

export default App
