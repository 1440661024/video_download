import {
  BadgeCheck,
  CircleAlert,
  Crown,
  Download,
  Link2,
  LoaderCircle,
  PlayCircle,
  Sparkles,
  Video,
} from 'lucide-react'
import { startTransition, useMemo, useState } from 'react'

import { downloadVideoFile, getApiAssetUrl, getDownloadLink, parseVideo } from './lib/api'
import type { VideoFormatOption, VideoMeta } from './types'

const platformPills = ['抖音', 'YouTube', 'Bilibili', 'TikTok / X']

const lowerBlocks = [
  {
    id: 'features',
    title: '功能特性',
    text: '支持多平台公开视频解析，自动整理成少量可直接下载的成片选项。',
  },
  {
    id: 'pricing',
    title: '查看价格',
    text: '首版先把下载闭环打稳，视频总结、字幕翻译、批量下载后续再逐步开放。',
  },
  {
    id: 'platforms',
    title: '支持平台',
    text: '抖音、B 站、YouTube 等常见平台优先适配，移动端和桌面端都能直接使用。',
  },
  {
    id: 'faq-1',
    title: '为什么有些视频不能下载',
    text: '带 DRM、私密权限、登录态校验或平台明确限制的内容，不属于当前版本支持范围。',
  },
  {
    id: 'faq-2',
    title: '为什么会走服务端代理',
    text: '当直链不稳定、存在防盗链或需要服务端合并处理时，会自动切换为代理下载。',
  },
  {
    id: 'faq-3',
    title: '版权和使用提醒',
    text: '请仅下载你有权保存的内容，避免侵犯版权或违反平台规则。',
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
    if (!url.trim()) {
      setError('请先粘贴一个公开视频链接。')
      return
    }

    setIsParsing(true)
    setError(null)

    try {
      const data = await parseVideo(url.trim())
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
                <p className="text-xs text-slate-400">万能视频下载</p>
              </div>
            </div>

            <nav className="hidden items-center gap-8 text-sm text-slate-500 md:flex">
              <a href="#features" className="transition hover:text-slate-900">
                功能特性
              </a>
              <a href="#pricing" className="transition hover:text-slate-900">
                查看价格
              </a>
              <a href="#platforms" className="transition hover:text-slate-900">
                支持平台
              </a>
            </nav>

            <button className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-600 transition hover:bg-blue-100">
              <Crown size={16} />
              开通 VIP
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 pb-24 pt-5 sm:px-6 lg:px-8">
        <main>
          <section className="flex min-h-[calc(100vh-5.5rem)] flex-col items-center justify-center py-14 lg:min-h-[calc(100vh-2rem)] lg:pb-28 lg:pt-20">
            <div className="w-full max-w-[72rem] text-center">
              <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-white px-4 py-2 text-sm text-slate-500 shadow-sm">
                <BadgeCheck className="text-emerald-500" size={16} />
                支持 1800+ 平台，核心下载一步完成
              </div>

              <h1 className="mt-7 text-4xl font-black tracking-[-0.06em] text-slate-950 sm:text-5xl lg:text-[4.6rem]">
                万能视频下载器，
                <span className="text-blue-500">一键保存</span>
              </h1>

              <p className="mx-auto mt-5 max-w-[56rem] text-base leading-8 text-slate-500 sm:text-[1.32rem] sm:leading-9">
                粘贴视频链接，智能解析，支持多种清晰度下载。YouTube、Bilibili、抖音、TikTok
                等热门站点，随时随地，想下就下。
              </p>

              <div className="mx-auto mt-9 max-w-[60rem] rounded-[2.2rem] border border-white/80 bg-white/95 p-4 shadow-[0_24px_64px_rgba(15,23,42,0.08)]">
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
                    {isParsing ? '解析中' : '解析视频'}
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

              <div className="mx-auto mt-12 w-full max-w-[62rem] rounded-[2.2rem] border border-slate-200 bg-white/96 p-5 shadow-[0_28px_64px_rgba(15,23,42,0.09)] sm:p-6">
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

          <section className="space-y-8 pt-28">
            <div className="grid gap-5 md:grid-cols-3">
              {lowerBlocks.slice(0, 3).map((item) => (
                <InfoCard key={item.id} id={item.id} title={item.title} text={item.text} />
              ))}
            </div>

            <div className="grid gap-5 md:grid-cols-3">
              {lowerBlocks.slice(3).map((item) => (
                <InfoCard key={item.id} id={item.id} title={item.title} text={item.text} />
              ))}
            </div>

            <section
              id="pricing-panel"
              className="rounded-[2rem] border border-slate-200 bg-[linear-gradient(135deg,_#0f172a,_#1e3a8a)] p-7 text-white shadow-[0_24px_60px_rgba(15,23,42,0.16)]"
            >
              <p className="text-sm uppercase tracking-[0.18em] text-blue-200">后续扩展</p>
              <h2 className="mt-3 text-3xl font-black tracking-[-0.04em]">把复杂功能先放到首屏下面</h2>
              <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-200 sm:text-base">
                视频总结、字幕翻译、批量下载、会员加速这些内容先下沉到下面区域，首屏只保留输入、结果和下载。
              </p>
            </section>
          </section>
        </main>
      </div>
    </div>
  )
}

function EmptyResult() {
  return (
    <div className="flex min-h-[260px] flex-col items-center justify-center rounded-[1.6rem] bg-[linear-gradient(180deg,_rgba(248,250,252,0.92),_rgba(255,255,255,0.98))] px-6 py-10 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-blue-50 text-blue-500">
        <PlayCircle size={28} />
      </div>
      <h2 className="mt-5 text-2xl font-black tracking-[-0.04em] text-slate-950">先粘贴链接，再开始解析</h2>
      <p className="mt-3 max-w-xl text-sm leading-7 text-slate-500 sm:text-base">
        首屏只保留最核心的下载流程，其他说明已经整体下沉到下面区域，滚动后再看。
      </p>
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
    <div className="space-y-5">
      <div className="grid gap-5 md:grid-cols-[220px_1fr]">
        <div className="overflow-hidden rounded-[1.5rem] border border-slate-200 bg-slate-100">
          {thumbnailSrc ? (
            <img src={thumbnailSrc} alt={result.title} className="h-full min-h-[180px] w-full object-cover" />
          ) : (
            <div className="flex min-h-[180px] items-center justify-center bg-[linear-gradient(135deg,_#dbeafe,_#eff6ff)] text-blue-600">
              <Video size={42} />
            </div>
          )}
        </div>

        <div className="rounded-[1.5rem] bg-slate-50 px-5 py-4">
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-400">
            <span>解析结果</span>
            <span className="rounded-full bg-blue-50 px-3 py-1 font-semibold text-blue-600">
              {result.extractor ?? '未知平台'}
            </span>
          </div>
          <h2 className="mt-3 text-2xl font-black leading-tight tracking-[-0.04em] text-slate-950">
            {result.title}
          </h2>
          <div className="mt-4 flex flex-wrap gap-4 text-sm text-slate-500">
            <span>{result.uploader ?? '未知发布者'}</span>
            <span>{result.duration_human}</span>
            <span>{selectedFormatOption?.filesize_human ?? '大小未知'}</span>
          </div>
          <p className="mt-4 text-sm leading-7 text-slate-500">{result.recommended_strategy.reason}</p>
        </div>
      </div>

      <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">选择清晰度和格式</p>
            <p className="mt-1 text-sm text-slate-500">默认推荐最高可用成片，已自动隐藏重复/纯音频/纯视频格式。</p>
          </div>
          <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-500 shadow-sm">
            已整理为 {result.formats.length} 个下载选项
          </span>
        </div>

        <div className="mt-4 grid gap-3">
          {result.formats.map((format) => (
            <FormatCard
              key={format.format_id}
              format={format}
              active={format.format_id === selectedFormat}
              onSelect={onSelect}
            />
          ))}
        </div>

        <div className="mt-5 flex flex-col gap-3 rounded-[1.4rem] bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-900">当前选择</p>
            <p className="mt-1 text-sm text-slate-500">
              {selectedFormatOption
                ? `${selectedFormatOption.label} · ${selectedFormatOption.ext.toUpperCase()} · ${selectedFormatOption.filesize_human}`
                : '请选择一个下载格式'}
            </p>
          </div>
          <button
            onClick={onDownload}
            disabled={!selectedFormatOption || isDownloading}
            className="inline-flex items-center justify-center gap-2 rounded-[1.2rem] bg-blue-500 px-6 py-3 text-sm font-semibold text-white shadow-[0_14px_28px_rgba(59,130,246,0.26)] transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {isDownloading ? <LoaderCircle className="animate-spin" size={18} /> : <Download size={18} />}
            {isDownloading ? '准备下载中' : '立即下载'}
          </button>
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
      className={`grid gap-3 rounded-[1.3rem] border px-4 py-4 text-left transition ${
        active
          ? 'border-blue-300 bg-blue-50 shadow-[0_12px_24px_rgba(59,130,246,0.1)]'
          : 'border-slate-200 bg-white hover:border-blue-200 hover:bg-blue-50/50'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-slate-950 px-3 py-1 text-xs font-semibold text-white">
          {format.ext.toUpperCase()}
        </span>
        <span className="text-sm font-semibold text-slate-900">{format.label}</span>
        {format.recommended ? (
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
            推荐
          </span>
        ) : null}
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500">
          {format.download_mode === 'direct' ? '直链下载' : '服务端代理'}
        </span>
      </div>

      <div className="grid gap-2 text-sm text-slate-500 sm:grid-cols-3">
        <span>分辨率：{format.resolution}</span>
        <span>大小：{format.filesize_human}</span>
        <span>方式：{format.download_mode === 'direct' ? '浏览器直下' : '后端处理后下载'}</span>
      </div>

      <p className="text-sm text-slate-500">{format.note}</p>
    </button>
  )
}

function InfoCard({ id, title, text }: { id: string; title: string; text: string }) {
  return (
    <article
      id={id}
      className="rounded-[1.8rem] border border-slate-200 bg-white p-6 shadow-[0_16px_44px_rgba(15,23,42,0.06)]"
    >
      <h2 className="text-lg font-bold text-slate-950">{title}</h2>
      <p className="mt-3 text-sm leading-7 text-slate-500">{text}</p>
    </article>
  )
}

export default App
