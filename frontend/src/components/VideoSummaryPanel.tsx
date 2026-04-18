import {
  Bot,
  Download,
  FileText,
  GitBranch,
  LoaderCircle,
  MessageSquareText,
  Sparkles,
  Subtitles,
  Waves,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import {
  getVideoMindmap,
  getVideoTranscript,
  openVideoQuestionStream,
  openVideoSummaryStream,
  parseSummaryStreamError,
} from '../lib/summary-api'
import type { VideoMeta } from '../types'
import type { VideoSummarySourceStatus, VideoTranscriptSegment } from '../types-summary'
import { MindmapCanvas } from './MindmapCanvas'

type SummaryTab = 'summary' | 'transcript' | 'mindmap' | 'qa'
type SummaryProgress = {
  stage: 'idle' | 'preparing' | 'generating' | 'completed'
  message: string
}

function t(value: string) {
  return value
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function applyInlineMarkdown(text: string) {
  return text
    .replace(/`([^`]+)`/g, '<code class="rounded-md bg-slate-100 px-1.5 py-0.5 text-[0.92em] text-slate-800">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold text-slate-950">$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
}

function wrapList(items: string[], ordered: boolean) {
  const tag = ordered ? 'ol' : 'ul'
  const cls = ordered
    ? 'my-6 list-decimal space-y-3.5 pl-8 text-[16px] leading-8 text-slate-700 marker:font-semibold marker:text-blue-500'
    : 'my-6 list-disc space-y-3.5 pl-8 text-[16px] leading-8 text-slate-700 marker:text-blue-500'
  return `<${tag} class="${cls}">${items.join('')}</${tag}>`
}

function formatMarkdownToHtml(markdown: string) {
  const normalized = escapeHtml(markdown).replace(/\r\n/g, '\n').trim()
  if (!normalized) {
    return ''
  }

  const lines = normalized.split('\n')
  const html: string[] = []
  let paragraph: string[] = []
  let listItems: string[] = []
  let orderedItems: string[] = []
  let inCodeBlock = false
  let codeLines: string[] = []

  function flushParagraph() {
    if (!paragraph.length) {
      return
    }
    html.push(
      `<p class="my-6 text-[17px] leading-9 text-slate-700">${applyInlineMarkdown(paragraph.join('<br />'))}</p>`,
    )
    paragraph = []
  }

  function flushLists() {
    if (listItems.length) {
      html.push(wrapList(listItems, false))
      listItems = []
    }
    if (orderedItems.length) {
      html.push(wrapList(orderedItems, true))
      orderedItems = []
    }
  }

  function flushCodeBlock() {
    if (!codeLines.length) {
      return
    }
    html.push(
      `<pre class="my-6 overflow-x-auto rounded-3xl bg-slate-950 px-5 py-5 text-[13px] leading-6 text-slate-100"><code>${codeLines.join('\n')}</code></pre>`,
    )
    codeLines = []
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    const trimmed = line.trim()

    if (trimmed.startsWith('```')) {
      flushParagraph()
      flushLists()
      if (inCodeBlock) {
        flushCodeBlock()
        inCodeBlock = false
      } else {
        inCodeBlock = true
      }
      continue
    }

    if (inCodeBlock) {
      codeLines.push(line)
      continue
    }

    if (!trimmed) {
      flushParagraph()
      flushLists()
      continue
    }

    const headingMatch = trimmed.match(/^(#{1,3})\s+(.*)$/)
    if (headingMatch) {
      flushParagraph()
      flushLists()
      const level = headingMatch[1].length
      const content = applyInlineMarkdown(headingMatch[2])
      if (level === 1) {
        html.push(`<h1 class="mt-2 pb-6 text-[2.15rem] font-black leading-[1.2] tracking-[-0.012em] text-slate-950">${content}</h1>`)
      } else if (level === 2) {
        html.push(`<h2 class="mt-14 border-t border-slate-100 pt-10 text-[1.85rem] font-black leading-[1.24] tracking-[-0.012em] text-slate-950">${content}</h2>`)
      } else {
        html.push(`<h3 class="mt-9 text-[1.32rem] font-bold leading-[1.32] text-slate-900">${content}</h3>`)
      }
      continue
    }

    const unorderedMatch = trimmed.match(/^[-*]\s+(.*)$/)
    if (unorderedMatch) {
      flushParagraph()
      orderedItems = orderedItems.length ? (html.push(wrapList(orderedItems, true)), []) : orderedItems
      listItems.push(`<li>${applyInlineMarkdown(unorderedMatch[1])}</li>`)
      continue
    }

    const orderedMatch = trimmed.match(/^\d+\.\s+(.*)$/)
    if (orderedMatch) {
      flushParagraph()
      listItems = listItems.length ? (html.push(wrapList(listItems, false)), []) : listItems
      orderedItems.push(`<li>${applyInlineMarkdown(orderedMatch[1])}</li>`)
      continue
    }

    const quoteMatch = trimmed.match(/^>\s?(.*)$/)
    if (quoteMatch) {
      flushParagraph()
      flushLists()
      html.push(
        `<blockquote class="my-7 rounded-r-3xl border-l-4 border-blue-200 bg-blue-50/70 px-5 py-4 text-[16px] leading-8 text-slate-700">${applyInlineMarkdown(quoteMatch[1])}</blockquote>`,
      )
      continue
    }

    paragraph.push(trimmed)
  }

  flushParagraph()
  flushLists()
  flushCodeBlock()
  return html.join('')
}

function formatSourceTypeLabel(status: VideoSummarySourceStatus | null) {
  if (!status) {
    return t('等待识别文本来源')
  }
  if (status.source_type === 'speech_to_text') {
    return t('语音识别文本')
  }
  if (status.source_type === 'auto_subtitles') {
    return t('自动字幕')
  }
  if (status.source_type === 'human_subtitles') {
    return t('人工字幕')
  }
  return t('元数据降级')
}

function formatLanguageLabel(language: string | null | undefined) {
  if (!language) {
    return t('待识别')
  }
  const normalized = language.toLowerCase()
  if (normalized.startsWith('zh')) {
    return t('简体中文')
  }
  if (normalized.startsWith('en')) {
    return t('英文')
  }
  return language
}

function getSourceBadge(status: VideoSummarySourceStatus | null) {
  if (!status) {
    return {
      label: t('准备提取视频文本'),
      detail: t('系统会优先使用字幕，其次再尝试语音识别，生成过程中会自动更新当前来源。'),
      icon: Bot,
    }
  }

  if (status.source_type === 'speech_to_text') {
    return {
      label: t('当前结果来自语音识别'),
      detail: t('该视频没有可用字幕，系统已自动切换为 ASR 转写，所以耗时会比字幕总结更长一些。'),
      icon: Waves,
    }
  }

  return {
    label: t('当前结果来自字幕文本'),
    detail: t('系统优先使用人工字幕或自动字幕，这类文本通常比纯语音识别更稳定，结果也更适合学习总结。'),
    icon: Subtitles,
  }
}

function formatSrtTime(seconds: number | null) {
  const safe = Math.max(0, seconds ?? 0)
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const secs = Math.floor(safe % 60)
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},000`
}

function downloadFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

const tabs: Array<{ id: SummaryTab; label: string; icon: typeof FileText }> = [
  { id: 'summary', label: t('总结摘要'), icon: FileText },
  { id: 'transcript', label: t('字幕文本'), icon: Subtitles },
  { id: 'mindmap', label: t('思维导图'), icon: GitBranch },
  { id: 'qa', label: t('AI 问答'), icon: MessageSquareText },
]

export function VideoSummaryPanel({ result }: { result: VideoMeta }) {
  const [isOpen, setIsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<SummaryTab>('summary')
  const [summary, setSummary] = useState('')
  const [transcript, setTranscript] = useState('')
  const [transcriptSegments, setTranscriptSegments] = useState<VideoTranscriptSegment[]>([])
  const [mindmapData, setMindmapData] = useState('')
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [transcriptError, setTranscriptError] = useState<string | null>(null)
  const [mindmapError, setMindmapError] = useState<string | null>(null)
  const [qaError, setQaError] = useState<string | null>(null)
  const [sourceStatus, setSourceStatus] = useState<VideoSummarySourceStatus | null>(null)
  const [summaryProgress, setSummaryProgress] = useState<SummaryProgress>({
    stage: 'idle',
    message: t('尚未开始生成'),
  })
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false)
  const [isLoadingTranscript, setIsLoadingTranscript] = useState(false)
  const [isGeneratingMindmap, setIsGeneratingMindmap] = useState(false)
  const [isAsking, setIsAsking] = useState(false)
  const summaryStreamRef = useRef<EventSource | null>(null)
  const qaStreamRef = useRef<EventSource | null>(null)

  const formattedSummary = useMemo(() => formatMarkdownToHtml(summary), [summary])
  const sourceBadge = useMemo(() => getSourceBadge(sourceStatus), [sourceStatus])
  const transcriptCountLabel = useMemo(
    () => `${transcriptSegments.length || sourceStatus?.segment_count || 0} 段`,
    [sourceStatus?.segment_count, transcriptSegments.length],
  )

  useEffect(() => {
    setIsOpen(false)
    setActiveTab('summary')
    setSummary('')
    setTranscript('')
    setTranscriptSegments([])
    setMindmapData('')
    setQuestion('')
    setAnswer('')
    setSummaryError(null)
    setTranscriptError(null)
    setMindmapError(null)
    setQaError(null)
    setSourceStatus(null)
    setSummaryProgress({
      stage: 'idle',
      message: t('尚未开始生成'),
    })
    setIsGeneratingSummary(false)
    setIsLoadingTranscript(false)
    setIsGeneratingMindmap(false)
    setIsAsking(false)
    summaryStreamRef.current?.close()
    qaStreamRef.current?.close()
    summaryStreamRef.current = null
    qaStreamRef.current = null
  }, [result.source_url])

  useEffect(() => {
    return () => {
      summaryStreamRef.current?.close()
      qaStreamRef.current?.close()
    }
  }, [])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = originalOverflow
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen || activeTab !== 'transcript' || transcriptSegments.length || transcriptError || isLoadingTranscript) {
      return
    }
    void handleLoadTranscript()
  }, [activeTab, isLoadingTranscript, isOpen, transcriptError, transcriptSegments.length])

  function closeSummaryStream() {
    summaryStreamRef.current?.close()
    summaryStreamRef.current = null
  }

  function closeQaStream() {
    qaStreamRef.current?.close()
    qaStreamRef.current = null
  }

  function handleDownloadTranscriptTxt() {
    if (!transcript.trim()) {
      return
    }
    downloadFile('video-transcript.txt', transcript, 'text/plain;charset=utf-8')
  }

  function handleDownloadTranscriptSrt() {
    if (!transcriptSegments.length) {
      return
    }
    const content = transcriptSegments
      .map((segment, index) => {
        const start = formatSrtTime(segment.start_seconds)
        const end = formatSrtTime(segment.end_seconds ?? segment.start_seconds)
        return `${index + 1}\n${start} --> ${end}\n${segment.text}\n`
      })
      .join('\n')
    downloadFile('video-transcript.srt', content, 'application/x-subrip;charset=utf-8')
  }

  function handleGenerateSummary() {
    if (isGeneratingSummary) {
      return
    }

    closeSummaryStream()
    setSummary('')
    setMindmapData('')
    setAnswer('')
    setSummaryError(null)
    setMindmapError(null)
    setQaError(null)
    setSourceStatus(null)
    setSummaryProgress({
      stage: 'preparing',
      message: t('正在解析视频并获取可用文本...'),
    })
    setActiveTab('summary')
    setIsGeneratingSummary(true)

    const stream = openVideoSummaryStream(result.source_url)
    summaryStreamRef.current = stream

    stream.onmessage = (event) => {
      setSummary((current) => current + event.data)
    }

    stream.addEventListener('source-status', (event) => {
      if (!(event instanceof MessageEvent)) {
        return
      }
      try {
        setSourceStatus(JSON.parse(event.data) as VideoSummarySourceStatus)
      } catch {
        setSourceStatus(null)
      }
    })

    stream.addEventListener('progress', (event) => {
      if (!(event instanceof MessageEvent)) {
        return
      }
      try {
        const payload = JSON.parse(event.data) as SummaryProgress
        if (payload?.message) {
          setSummaryProgress(payload)
        }
      } catch {
        setSummaryProgress({
          stage: 'generating',
          message: String(event.data || t('正在生成总结...')),
        })
      }
    })

    stream.addEventListener('done', () => {
      setIsGeneratingSummary(false)
      setSummaryProgress({
        stage: 'completed',
        message: t('总结生成完成。'),
      })
      closeSummaryStream()
    })

    stream.addEventListener('app-error', (event) => {
      const message =
        event instanceof MessageEvent
          ? parseSummaryStreamError(String(event.data || t('AI 总结生成失败，请稍后重试。')))
          : t('AI 总结生成失败，请稍后重试。')
      setSummaryError(message)
      setIsGeneratingSummary(false)
      setSummaryProgress({
        stage: 'idle',
        message,
      })
      closeSummaryStream()
    })

    stream.onerror = () => {
      const message = t('总结流已中断，请稍后重试。')
      setSummaryError(message)
      setIsGeneratingSummary(false)
      setSummaryProgress({
        stage: 'idle',
        message,
      })
      closeSummaryStream()
    }
  }

  async function handleLoadTranscript() {
    setIsLoadingTranscript(true)
    setTranscriptError(null)
    try {
      const data = await getVideoTranscript(result.source_url)
      setTranscript(data.transcript)
      setTranscriptSegments(data.segments)
      if (data.source_status) {
        setSourceStatus(data.source_status)
      }
    } catch (error) {
      setTranscriptError(error instanceof Error ? error.message : t('字幕文本加载失败，请稍后重试。'))
    } finally {
      setIsLoadingTranscript(false)
    }
  }

  async function handleGenerateMindmap() {
    if (!summary.trim() || isGeneratingMindmap) {
      return
    }

    setIsGeneratingMindmap(true)
    setMindmapError(null)
    setActiveTab('mindmap')
    try {
      const data = await getVideoMindmap(result.source_url)
      setMindmapData(data.mindmap)
      if (data.source_status) {
        setSourceStatus(data.source_status)
      }
    } catch (error) {
      setMindmapError(error instanceof Error ? error.message : t('思维导图生成失败，请稍后重试。'))
    } finally {
      setIsGeneratingMindmap(false)
    }
  }

  function handleAskQuestion() {
    const nextQuestion = question.trim()
    if (!summary.trim() || !nextQuestion || isAsking) {
      return
    }

    closeQaStream()
    setAnswer('')
    setQaError(null)
    setIsAsking(true)
    setActiveTab('qa')

    const stream = openVideoQuestionStream(result.source_url, nextQuestion)
    qaStreamRef.current = stream

    stream.onmessage = (event) => {
      setAnswer((current) => current + event.data)
    }

    stream.addEventListener('done', () => {
      setIsAsking(false)
      closeQaStream()
    })

    stream.addEventListener('app-error', (event) => {
      const message =
        event instanceof MessageEvent
          ? parseSummaryStreamError(String(event.data || t('视频问答失败，请稍后重试。')))
          : t('视频问答失败，请稍后重试。')
      setQaError(message)
      setIsAsking(false)
      closeQaStream()
    })

    stream.onerror = () => {
      setQaError(t('问答流已中断，请稍后重试。'))
      setIsAsking(false)
      closeQaStream()
    }
  }

  function handleOpen() {
    setIsOpen(true)
    if (!summary && !summaryError && !isGeneratingSummary) {
      handleGenerateSummary()
    }
  }

  const SourceIcon = sourceBadge.icon

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="inline-flex items-center justify-center gap-2 rounded-[1.2rem] border border-slate-200 bg-white px-6 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
      >
        <Bot size={18} />
        {t('AI 总结')}
      </button>

      {isOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/55 p-0 sm:items-center sm:p-6">
          <div className="absolute inset-0" aria-hidden="true" onClick={() => setIsOpen(false)} />

          <section className="relative z-10 flex h-[92vh] w-full max-w-[1400px] flex-col overflow-hidden rounded-t-[2rem] bg-white shadow-[0_30px_80px_rgba(15,23,42,0.35)] sm:h-[92vh] sm:rounded-[2rem]">
            <div className="border-b border-slate-200 bg-[linear-gradient(135deg,_#eff6ff,_#f8fafc_38%,_#fff7ed)] px-5 pt-5 sm:px-6">
              <div className="flex flex-col gap-4 xl:grid xl:grid-cols-[360px_minmax(0,1fr)_auto] xl:items-end xl:gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-white text-blue-600 shadow-sm ring-1 ring-blue-100">
                      <Bot size={20} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-lg font-bold leading-[1.2] tracking-[-0.008em] text-slate-950 sm:text-xl">{t('AI 视频总结')}</p>
                      <div className="mt-2 inline-flex max-w-full items-center rounded-full border border-slate-200 bg-white/85 px-3 py-1.5 text-sm text-slate-600 shadow-sm">
                        <span className="truncate">{result.title}</span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="min-w-0 self-end">
                  <div className="mb-[-1px] grid w-full grid-cols-4 items-center rounded-t-[1.5rem] border border-slate-200 border-b-white bg-white/90 px-2 pt-2">
                    {tabs.map((tab) => {
                      const Icon = tab.icon
                      const isActive = activeTab === tab.id
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setActiveTab(tab.id)}
                          className={`relative inline-flex min-w-0 items-center justify-center gap-2 rounded-t-[1rem] px-3 py-3 text-[15px] font-semibold transition ${
                            isActive
                              ? 'bg-white text-blue-600'
                              : 'text-slate-500 hover:text-slate-900'
                          }`}
                        >
                          <Icon size={16} className="shrink-0" />
                          <span className="truncate">{tab.label}</span>
                          <span
                            className={`absolute inset-x-3 bottom-0 h-[3px] rounded-full transition ${
                              isActive ? 'bg-blue-500' : 'bg-transparent'
                            }`}
                          />
                        </button>
                      )
                    })}
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setIsOpen(false)}
                    className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-900"
                    aria-label={t('关闭 AI 总结弹窗')}
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-hidden bg-[linear-gradient(180deg,_#ffffff,_#fbfdff)] px-3 py-3 sm:px-4 sm:py-4">
              <div className="grid h-full gap-2.5 xl:grid-cols-[290px_minmax(0,1fr)]">
                <aside className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-slate-50/90">
                  <div className="border-b border-slate-200 p-4">
                    <div className="flex items-start gap-3">
                      <div className="rounded-2xl bg-white p-2.5 text-blue-600 shadow-sm">
                        <SourceIcon size={17} />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{sourceBadge.label}</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3 p-4">
                    <div className="grid grid-cols-2 gap-3">
                      <MetricCard label={t('平台')} value={result.extractor ?? t('未知平台')} />
                      <MetricCard label={t('时长')} value={result.duration_human} />
                      <MetricCard label={t('语言')} value={formatLanguageLabel(sourceStatus?.language)} />
                      <MetricCard label={t('文本段数')} value={String(sourceStatus?.segment_count ?? '--')} />
                    </div>

                    <div className="rounded-[1.25rem] bg-white p-4 shadow-sm ring-1 ring-slate-100">
                      <div className="flex flex-wrap gap-2">
                        <InfoPill>{formatSourceTypeLabel(sourceStatus)}</InfoPill>
                        <InfoPill>{sourceStatus?.fallback_used ? t('启用兜底') : t('优先路径')}</InfoPill>
                        <InfoPill>{`${sourceStatus?.character_count ?? '--'} ${t('字')}`}</InfoPill>
                        <InfoPill>{summaryProgress.message}</InfoPill>
                      </div>
                    </div>

                    <div className="space-y-3 rounded-[1.5rem] bg-white p-4 shadow-sm ring-1 ring-slate-100">
                      <ActionButton
                        icon={isGeneratingSummary ? <LoaderCircle size={16} className="animate-spin" /> : <Sparkles size={16} />}
                        onClick={handleGenerateSummary}
                        disabled={isGeneratingSummary}
                        className="bg-slate-950 text-white hover:bg-slate-800 disabled:bg-slate-400"
                      >
                        {isGeneratingSummary ? t('正在生成...') : t('重新生成总结')}
                      </ActionButton>

                      <ActionButton
                        icon={isLoadingTranscript ? <LoaderCircle size={16} className="animate-spin" /> : <Subtitles size={16} />}
                        onClick={() => void handleLoadTranscript()}
                        disabled={isLoadingTranscript}
                        className="border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 disabled:text-slate-400"
                      >
                        {isLoadingTranscript ? t('正在加载...') : t('加载字幕文本')}
                      </ActionButton>

                      <ActionButton
                        icon={isGeneratingMindmap ? <LoaderCircle size={16} className="animate-spin" /> : <GitBranch size={16} />}
                        onClick={() => void handleGenerateMindmap()}
                        disabled={!summary.trim() || isGeneratingMindmap}
                        className="border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                      >
                        {isGeneratingMindmap ? t('正在生成...') : t('生成思维导图')}
                      </ActionButton>
                    </div>
                  </div>
                </aside>

                <div className="flex min-h-0 flex-col overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-sm">
                  <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
                    {activeTab === 'summary' ? (
                      <div>
                        {summaryError ? <ErrorNotice message={summaryError} /> : null}

                        {summary ? (
                          <article className="mx-auto max-w-[1040px] rounded-[1.9rem] border border-slate-200 bg-white px-8 py-8 shadow-[0_16px_40px_rgba(15,23,42,0.05)] sm:px-10 sm:py-10">
                            <div
                              className="summary-rich max-w-none [&_h1+*]:mt-0 [&_h2:first-child]:mt-0 [&_h2:first-child]:border-t-0 [&_h2:first-child]:pt-0 [&_h3:first-child]:mt-0 [&_li>strong]:text-slate-950 [&_ol]:space-y-4 [&_ul]:space-y-4"
                              dangerouslySetInnerHTML={{ __html: formattedSummary }}
                            />
                          </article>
                        ) : (
                          <EmptyPane
                            text={
                              isGeneratingSummary
                                ? summaryProgress.message
                                : t('点击左侧“重新生成总结”后开始输出。')
                            }
                          />
                        )}
                      </div>
                    ) : null}

                    {activeTab === 'transcript' ? (
                      <div className="space-y-4">
                        {transcriptError ? <ErrorNotice message={transcriptError} /> : null}

                        {transcriptSegments.length ? (
                          <>
                            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[1.5rem] bg-[linear-gradient(135deg,_#f8fbff,_#ffffff)] p-4 ring-1 ring-slate-100">
                              <div>
                                <p className="text-sm font-semibold text-slate-900">{t('字幕文本')}</p>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <InfoPill>{formatSourceTypeLabel(sourceStatus)}</InfoPill>
                                <InfoPill>{formatLanguageLabel(sourceStatus?.language)}</InfoPill>
                                <InfoPill>{transcriptCountLabel}</InfoPill>
                                <button
                                  type="button"
                                  onClick={handleDownloadTranscriptSrt}
                                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-blue-200 hover:text-blue-700"
                                >
                                  <Download size={13} />
                                  {t('下载 .srt')}
                                </button>
                                <button
                                  type="button"
                                  onClick={handleDownloadTranscriptTxt}
                                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-blue-200 hover:text-blue-700"
                                >
                                  <Download size={13} />
                                  {t('下载 .txt')}
                                </button>
                              </div>
                            </div>

                            <div className="space-y-3">
                              {transcriptSegments.map((segment, index) => (
                                <div
                                  key={`${segment.start_seconds ?? 'na'}-${index}`}
                                  className="grid gap-3 rounded-[1.35rem] border border-slate-200 bg-white px-4 py-4 shadow-sm md:grid-cols-[112px_minmax(0,1fr)]"
                                >
                                  <div className="text-sm font-semibold text-blue-600">
                                    {segment.start_human || t('未标注')}
                                  </div>
                                  <div className="min-w-0">
                                    <p className="text-sm leading-7 text-slate-700">{segment.text}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </>
                        ) : transcript ? (
                          <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50 p-4 text-sm leading-7 text-slate-700">
                            {transcript}
                          </div>
                        ) : (
                          <EmptyPane
                            text={
                              isLoadingTranscript
                                ? t('正在加载字幕文本...')
                                : t('点击左侧“加载字幕文本”后查看字幕时间轴。')
                            }
                          />
                        )}
                      </div>
                    ) : null}

                    {activeTab === 'mindmap' ? (
                      <div className="h-full min-h-[640px]">
                        {mindmapError ? <ErrorNotice message={mindmapError} /> : null}

                        {mindmapData ? (
                          <MindmapCanvas rawMindmap={mindmapData} />
                        ) : (
                          <EmptyPane text={t('先生成总结，再点击左侧“生成思维导图”。')} />
                        )}
                      </div>
                    ) : null}

                    {activeTab === 'qa' ? (
                      <div className="space-y-4">
                        <div className="rounded-[1.5rem] bg-slate-50 p-4 ring-1 ring-slate-100">
                          <div className="flex flex-col gap-3 md:flex-row">
                            <input
                              value={question}
                              onChange={(event) => setQuestion(event.target.value)}
                              placeholder={t('请输入你想追问的问题，例如：这段视频最关键的三个方法是什么？')}
                              className="flex-1 rounded-[1rem] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-blue-300 focus:ring-4 focus:ring-blue-100"
                            />
                            <button
                              type="button"
                              onClick={handleAskQuestion}
                              disabled={isAsking || !question.trim() || !summary.trim()}
                              className="inline-flex items-center justify-center gap-2 rounded-[1rem] bg-orange-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:bg-slate-300"
                            >
                              {isAsking ? <LoaderCircle size={16} className="animate-spin" /> : <MessageSquareText size={16} />}
                              {isAsking ? t('回答中...') : t('提问')}
                            </button>
                          </div>
                        </div>

                        {qaError ? <ErrorNotice message={qaError} /> : null}

                        {answer ? (
                          <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
                            <p className="text-sm font-semibold text-slate-900">{t('问题')}</p>
                            <p className="mt-2 text-sm text-slate-600">{question}</p>
                            <div className="mt-5 border-t border-slate-100 pt-5">
                              <p className="text-sm font-semibold text-slate-900">{t('回答')}</p>
                              <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-700">{answer}</p>
                            </div>
                          </div>
                        ) : (
                          <EmptyPane text={t('在这里对当前视频继续追问，回答会严格基于字幕或转写文本生成。')} />
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </>
  )
}

function ActionButton({
  children,
  className,
  disabled,
  icon,
  onClick,
}: {
  children: string
  className: string
  disabled?: boolean
  icon: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex w-full items-center justify-center gap-2 rounded-[1rem] px-4 py-3 text-sm font-semibold transition disabled:cursor-not-allowed ${className}`}
    >
      {icon}
      {children}
    </button>
  )
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.15rem] bg-white p-3 shadow-sm ring-1 ring-slate-100">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  )
}

function InfoPill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
      {children}
    </span>
  )
}

function ErrorNotice({ message }: { message: string }) {
  return (
    <div className="rounded-[1rem] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
      {message}
    </div>
  )
}

function EmptyPane({ text }: { text: string }) {
  return (
    <div className="flex min-h-[320px] items-center justify-center rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50 px-6 text-center text-sm leading-7 text-slate-400">
      {text}
    </div>
  )
}
