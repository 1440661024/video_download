import {
  BadgeCheck,
  CircleAlert,
  Clapperboard,
  Crown,
  Download,
  Link2,
  LoaderCircle,
  PlayCircle,
  Smartphone,
  Sparkles,
  Video,
  Zap,
} from 'lucide-react'
import { startTransition, useMemo, useState } from 'react'

import { VideoSummaryPanel } from './components/VideoSummaryPanel'
import { downloadVideoFile, getApiAssetUrl, getDownloadLink, parseVideo } from './lib/api'
import type { VideoFormatOption, VideoMeta } from './types'

const platformPills = ['抖音', 'YouTube', 'Bilibili', 'TikTok / X']

const featureCards = [
  {
    id: 'platforms',
    title: '支持 1800+ 平台',
    text: 'YouTube、Bilibili、抖音、TikTok 等主流公开视频内容都能优先适配。',
    icon: BadgeCheck,
    tint: 'bg-sky-50 text-sky-500',
  },
  {
    id: 'speed',
    title: '极简解析下载',
    text: '输入链接即可解析，优先整理成普通用户能直接选择的成片下载格式。',
    icon: Zap,
    tint: 'bg-amber-50 text-amber-500',
  },
  {
    id: 'mobile',
    title: '手机也能用',
    text: '移动端浏览器同样可用，不要求安装 App，复制链接就能开始。',
    icon: Smartphone,
    tint: 'bg-blue-50 text-blue-500',
  },
  {
    id: 'quality',
    title: '清晰度已整理',
    text: '隐藏底层音视频流细节，只保留对普通用户更直观的下载选项。',
    icon: Clapperboard,
    tint: 'bg-violet-50 text-violet-500',
  },
  {
    id: 'ai',
    title: 'AI 总结增强',
    text: '在下载结果里一键打开 AI 总结、思维导图和视频问答，不打断主流程。',
    icon: Sparkles,
    tint: 'bg-rose-50 text-rose-500',
  },
]

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

function App() {
  const [url, setUrl] = useState('')
  const [result, setResult] = useState<VideoMeta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedFormat, setSelectedFormat] = useState('')
  const [isParsing, setIsParsing] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)

  const recommendedFormat = useMemo(
    () => result?.formats.find((item) => item.recommended) ?? result?.formats[0] ?? null,
    [result],
  )

  const selectedFormatOption =
    result?.formats.find((item) => item.format_id === selectedFormat) ?? recommendedFormat
  const thumbnailSrc = result ? getThumbnailSrc(result) : null

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
      const payload = await getDownloadLink(result.source_url, selectedFormat)
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
        result.source_url,
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
        <div className="mx-auto w-full rounded-full border border-white/70 bg-white/92 px-5 py-3 shadow-[0_10px_30px_rgba(15,23,42,0.07)] backdrop-blur">
          <div className="mx-auto flex w-full max-w-[1680px] items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-[0_14px_30px_rgba(59,130,246,0.3)]">
                <Video size={18} />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">SaveAny</p>
              </div>
            </div>

            <nav className="hidden items-center gap-8 text-sm text-slate-500 md:flex">
              <a href="#why-saveany" className="transition hover:text-slate-900">
                为什么选 SaveAny
              </a>
              <a href="#result-panel" className="transition hover:text-slate-900">
                下载结果
              </a>
              <a href="#feature-preview" className="transition hover:text-slate-900">
                AI 能力
              </a>
            </nav>

            <button className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-600 transition hover:bg-blue-100">
              <Crown size={16} />
              开通 VIP
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1240px] px-4 pb-24 pt-5 sm:px-6 lg:px-8">
        <main>
          <section className="flex min-h-[calc(100vh-5.5rem)] flex-col items-center justify-center py-14 lg:min-h-[calc(100vh-2rem)] lg:pb-24 lg:pt-20">
            <div className="w-full text-center">
              <h1 className="text-4xl font-black leading-[1.12] tracking-[-0.012em] text-slate-950 sm:text-5xl lg:text-[4.6rem]">
                万能视频下载器，
                <span className="text-blue-500">一键保存</span>
              </h1>

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
                  />
                ) : (
                  <EmptyResult />
                )}
              </div>
            </div>
          </section>

          <section id="why-saveany" className="pt-20">
            <div className="mx-auto max-w-4xl text-center">
              <h2 className="text-4xl font-black leading-[1.16] tracking-[-0.01em] text-slate-950 sm:text-5xl">
                为什么选择 <span className="text-blue-500">SaveAny</span>
              </h2>
            </div>

            <div className="mt-14 grid gap-5 md:grid-cols-2 xl:grid-cols-5">
              {featureCards.map((item) => (
                <FeatureCard key={item.id} title={item.title} text={item.text} tint={item.tint} icon={item.icon} />
              ))}
            </div>
          </section>
        </main>
      </div>
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

function ResultCard({
  result,
  thumbnailSrc,
  selectedFormat,
  selectedFormatOption,
  isDownloading,
  onSelect,
  onDownload,
}: {
  result: VideoMeta
  thumbnailSrc: string | null
  selectedFormat: string
  selectedFormatOption: VideoFormatOption | null
  isDownloading: boolean
  onSelect: (formatId: string) => void
  onDownload: () => void
}) {
  return (
    <div className="space-y-7">
      <div className="grid gap-6 xl:grid-cols-[minmax(280px,460px)_1fr]">
        <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-slate-100 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
          {thumbnailSrc ? (
            <img
              src={thumbnailSrc}
              alt={result.title}
              className="h-full min-h-[220px] w-full object-cover xl:min-h-[260px]"
            />
          ) : (
            <div className="flex min-h-[220px] items-center justify-center bg-[linear-gradient(135deg,_#dbeafe,_#eff6ff)] text-blue-600 xl:min-h-[260px]">
              <Video size={48} />
            </div>
          )}
        </div>

        <div className="rounded-[2rem] bg-[linear-gradient(180deg,_#f8fbff,_#f5f7fb)] px-6 py-6 text-left xl:px-8 xl:py-7">
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-400">
            <span className="font-medium">解析结果</span>
            <span className="rounded-full bg-blue-100 px-3 py-1 font-semibold text-blue-600">
              {result.extractor ?? '未知平台'}
            </span>
          </div>
          <h2 className="mt-4 text-3xl font-black leading-[1.22] tracking-[-0.01em] text-slate-950 xl:text-[2.45rem]">
            {result.title}
          </h2>
          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-3 text-xl text-slate-500">
            <span>{result.uploader ?? '未知发布者'}</span>
            <span>{result.duration_human}</span>
            <span>{selectedFormatOption?.filesize_human ?? '大小未知'}</span>
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
            <VideoSummaryPanel result={result} />
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
    <article className="rounded-[2rem] border border-slate-100 bg-white px-8 py-10 text-left shadow-[0_14px_38px_rgba(15,23,42,0.05)]">
      <div className={`flex size-16 items-center justify-center rounded-2xl ${tint}`}>
        <Icon size={28} />
      </div>
      <h3 className="mt-7 text-[1.9rem] font-black leading-[1.22] tracking-[-0.008em] text-slate-950">{title}</h3>
      <p className="mt-4 text-lg leading-9 text-slate-400">{text}</p>
    </article>
  )
}

export default App
