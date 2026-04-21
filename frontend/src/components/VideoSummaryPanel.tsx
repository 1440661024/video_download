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

type SummarySectionKey = 'overview' | 'points' | 'timeline' | 'takeaways' | 'other'

type ParsedSummarySection = {
  key: SummarySectionKey
  title: string
  icon: string
  content: string
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
      if (orderedItems.length) {
        html.push(wrapList(orderedItems, true))
        orderedItems = []
      }
      listItems.push(`<li>${applyInlineMarkdown(unorderedMatch[1])}</li>`)
      continue
    }

    const orderedMatch = trimmed.match(/^\d+\.\s+(.*)$/)
    if (orderedMatch) {
      flushParagraph()
      if (listItems.length) {
        html.push(wrapList(listItems, false))
        listItems = []
      }
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

function normalizeHeadingKey(title: string): SummarySectionKey {
  const normalized = title.replaceAll(/\s+/g, '')
  if (normalized.includes('视频主题概览') || normalized.includes('核心总结') || normalized.includes('总结摘要')) {
    return 'overview'
  }
  if (normalized.includes('核心知识点') || normalized.includes('核心观点')) {
    return 'points'
  }
  if (normalized.includes('分段总结') || normalized.includes('分段解析') || normalized.includes('时间轴')) {
    return 'timeline'
  }
  if (normalized.includes('关键结论') || normalized.includes('学习收获') || normalized.includes('结论') || normalized.includes('启发')) {
    return 'takeaways'
  }
  return 'other'
}

function getSectionMeta(key: SummarySectionKey, title: string) {
  if (key === 'overview') {
    return { title: '核心总结', icon: '🎯' }
  }
  if (key === 'points') {
    return { title: '核心观点', icon: '🧠' }
  }
  if (key === 'timeline') {
    return { title: '分段解析', icon: '⏱' }
  }
  if (key === 'takeaways') {
    return { title: '结论 / 启发', icon: '💡' }
  }
  return { title, icon: '📝' }
}

function parseSummarySections(markdown: string): ParsedSummarySection[] {
  const normalized = markdown.replace(/\r\n/g, '\n').trim()
  if (!normalized) {
    return []
  }

  const sections: ParsedSummarySection[] = []
  const headingPattern = /^##\s+(.+)$/gm
  const matches = [...normalized.matchAll(headingPattern)]
  if (!matches.length) {
    return [
      {
        key: 'overview',
        title: '核心总结',
        icon: '🎯',
        content: normalized,
      },
    ]
  }

  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index]
    const next = matches[index + 1]
    const rawTitle = current[1].trim()
    const start = current.index! + current[0].length
    const end = next?.index ?? normalized.length
    const content = normalized.slice(start, end).trim()
    if (!content) {
      continue
    }
    const key = normalizeHeadingKey(rawTitle)
    const meta = getSectionMeta(key, rawTitle)
    sections.push({
      key,
      title: meta.title,
      icon: meta.icon,
      content,
    })
  }

  return sections
}

function robustParseSummarySections(markdown: string): ParsedSummarySection[] {
  const normalized = markdown
    .replace(/\r\n/g, '\n')
    .replace(/^(#{1,3})([^\s#])/gm, '$1 $2')
    .replace(/(^|\n)\s*(视频主题概览|核心总结|总结摘要|核心知识点|核心观点|分段总结|分段解析|时间轴|关键结论\s*\/\s*学习收获|关键结论|学习收获|结论\s*\/\s*启发|结论|启发)\s*/g, '\n## $2\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  const strictSections = parseSummarySections(normalized)
  if (strictSections.length > 1) {
    return strictSections
  }

  const headingPattern =
    /(^|\n)\s*(?:#{1,3}\s*)?(视频主题概览|核心总结|总结摘要|核心知识点|核心观点|分段总结|分段解析|时间轴|关键结论\s*\/\s*学习收获|关键结论|学习收获|结论\s*\/\s*启发|结论|启发)\s*/g
  const matches = [...normalized.matchAll(headingPattern)]
  if (!matches.length) {
    return strictSections
  }

  const resolveKey = (title: string): SummarySectionKey => {
    const compact = title.replaceAll(/\s+/g, '').replaceAll('：', '').replaceAll(':', '')
    if (compact.includes('视频主题概览') || compact.includes('核心总结') || compact.includes('总结摘要')) {
      return 'overview'
    }
    if (compact.includes('核心知识点') || compact.includes('核心观点')) {
      return 'points'
    }
    if (compact.includes('分段总结') || compact.includes('分段解析') || compact.includes('时间轴')) {
      return 'timeline'
    }
    if (compact.includes('关键结论') || compact.includes('学习收获') || compact.includes('结论') || compact.includes('启发')) {
      return 'takeaways'
    }
    return 'other'
  }

  const resolveMeta = (key: SummarySectionKey, fallbackTitle: string) => {
    if (key === 'overview') {
      return { title: '核心总结', icon: '🎯' }
    }
    if (key === 'points') {
      return { title: '核心观点', icon: '🧠' }
    }
    if (key === 'timeline') {
      return { title: '分段解析', icon: '⏱' }
    }
    if (key === 'takeaways') {
      return { title: '结论 / 启发', icon: '💡' }
    }
    return { title: fallbackTitle, icon: '📘' }
  }

  const sections: ParsedSummarySection[] = []
  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index]
    const next = matches[index + 1]
    const rawTitle = current[2].trim()
    const start = (current.index ?? 0) + current[0].length
    const end = next?.index ?? normalized.length
    const content = normalized.slice(start, end).trim().replace(/^[:：-]\s*/, '')
    if (!content) {
      continue
    }
    const key = resolveKey(rawTitle)
    const meta = resolveMeta(key, rawTitle)
    sections.push({
      key,
      title: meta.title,
      icon: meta.icon,
      content,
    })
  }

  return sections.length ? sections : strictSections
}

function parseBulletItems(content: string) {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*•]\s*/, '').replace(/^\d+\.\s*/, '').trim())
    .filter(Boolean)
}

function parseTimelineItems(content: string) {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*•]\s*/, '').trim())
    .filter(Boolean)
    .map((line, index) => {
      const match = line.match(/^(\d{1,2}:\d{2}(?:\s*[-—]\s*\d{1,2}:\d{2})?)[:：]?\s*(.*)$/)
      if (match) {
        return {
          id: `${match[1]}-${index}`,
          time: match[1].replace(/\s*/g, ''),
          text: match[2].trim(),
        }
      }
      return {
        id: `timeline-${index}`,
        time: `片段 ${index + 1}`,
        text: line,
      }
    })
}

function emphasizeInlineText(text: string) {
  const escaped = escapeHtml(text)
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold text-slate-950">$1</strong>')
    .replace(/`([^`]+)`/g, '<span class="rounded-md bg-blue-50 px-1.5 py-0.5 font-medium text-blue-700">$1</span>')
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
      detail: t('系统会优先使用字幕，其次再尝试语音识别，并在生成过程中自动更新当前来源。'),
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

export function VideoSummaryPanel({
  result,
  canUseAi,
  freeAiSummariesRemainingToday,
  isLoggedIn,
  onNeedLogin,
  onNeedMembership,
  onRefreshMe,
  checkoutBusy = false,
}: {
  result: VideoMeta
  canUseAi: boolean
  freeAiSummariesRemainingToday: number
  isLoggedIn: boolean
  onNeedLogin: () => void
  onNeedMembership: () => void
  onRefreshMe?: () => void
  checkoutBusy?: boolean
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [accessPrompt, setAccessPrompt] = useState<'free-trial' | 'upgrade' | null>(null)
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
  const [localFreeSummariesRemaining, setLocalFreeSummariesRemaining] = useState(freeAiSummariesRemainingToday)
  const summaryStreamRef = useRef<EventSource | null>(null)
  const qaStreamRef = useRef<EventSource | null>(null)

  const canUsePremiumAi = canUseAi
  const canUseFreeSummaryTrial = !canUsePremiumAi && localFreeSummariesRemaining > 0
  const visibleTabs = canUsePremiumAi ? tabs : tabs.filter((tab) => tab.id === 'summary')
  const formattedSummary = useMemo(() => formatMarkdownToHtml(summary), [summary])
  const parsedSummarySections = useMemo(() => robustParseSummarySections(summary), [summary])
  const sourceBadge = useMemo(() => getSourceBadge(sourceStatus), [sourceStatus])
  const transcriptCountLabel = useMemo(
    () => `${transcriptSegments.length || sourceStatus?.segment_count || 0} 段`,
    [sourceStatus?.segment_count, transcriptSegments.length],
  )

  useEffect(() => {
    setLocalFreeSummariesRemaining(freeAiSummariesRemainingToday)
  }, [freeAiSummariesRemainingToday])

  useEffect(() => {
    setIsOpen(false)
    setAccessPrompt(null)
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

    stream.addEventListener('preview-summary', (event) => {
      if (!(event instanceof MessageEvent)) {
        return
      }
      setSummary(String(event.data || ''))
    })

    stream.addEventListener('summary-reset', () => {
      setSummary('')
    })

    stream.addEventListener('done', () => {
      onRefreshMe?.()
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
      onRefreshMe?.()
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
      onRefreshMe?.()
      closeSummaryStream()
    }
  }

  async function handleLoadTranscript() {
    if (!canUsePremiumAi) {
      setTranscriptError(t('字幕查看需要开通 AI 会员后使用。'))
      return
    }

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
    if (!canUsePremiumAi) {
      setMindmapError(t('思维导图需要开通 AI 会员后使用。'))
      return
    }
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
    if (!canUsePremiumAi) {
      setQaError(t('AI 问答需要开通 AI 会员后使用。'))
      return
    }

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
    if (!isLoggedIn) {
      onNeedLogin()
      return
    }

    if (!canUsePremiumAi) {
      setAccessPrompt(canUseFreeSummaryTrial ? 'free-trial' : 'upgrade')
      return
    }

    setAccessPrompt(null)
    setIsOpen(true)
    if (!summary && !summaryError && !isGeneratingSummary) {
      handleGenerateSummary()
    }
  }

  function handleStartFreeTrial() {
    setLocalFreeSummariesRemaining(0)
    setAccessPrompt(null)
    setIsOpen(true)
    if (!summary && !summaryError && !isGeneratingSummary) {
      window.setTimeout(() => {
        handleGenerateSummary()
      }, 0)
    }
  }

  const SourceIcon = sourceBadge.icon

  return (
    <>
      <button
        type="button"
        disabled={checkoutBusy}
        onClick={handleOpen}
        className="inline-flex items-center justify-center gap-2 rounded-[1.2rem] border border-slate-200 bg-white px-6 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Bot size={18} />
        {checkoutBusy ? t('跳转支付中...') : t('AI 总结')}
      </button>

      {accessPrompt ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/55 px-4">
          <div className="absolute inset-0" aria-hidden="true" onClick={() => setAccessPrompt(null)} />
          <section className="relative z-10 w-full max-w-md rounded-[2rem] bg-white p-6 shadow-[0_30px_80px_rgba(15,23,42,0.35)]">
            <button
              type="button"
              onClick={() => setAccessPrompt(null)}
              className="absolute right-4 top-4 inline-flex size-9 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition hover:border-slate-300 hover:text-slate-900"
              aria-label={t('关闭提示')}
            >
              <X size={16} />
            </button>

            {accessPrompt === 'free-trial' ? (
              <>
                <div className="flex size-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                  <Sparkles size={22} />
                </div>
                <h3 className="mt-5 text-2xl font-black text-slate-950">{t('先体验 1 次 AI 总结')}</h3>
                <p className="mt-3 text-sm leading-7 text-slate-500">
                  {t('普通用户每天可以免费体验 1 次 AI 总结。本次体验不会直接跳转支付，你可以先免费试用，再决定是否开通会员。')}
                </p>
                <div className="mt-6 rounded-[1.25rem] border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-7 text-amber-800">
                  {t('免费体验仅包含 AI 总结，字幕查看、思维导图、AI 问答和导出仍需 AI 会员。')}
                </div>
                <div className="mt-6 flex flex-col gap-3">
                  <button
                    type="button"
                    onClick={handleStartFreeTrial}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-[1rem] bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
                  >
                    <Sparkles size={16} />
                    {t('免费体验 1 次')}
                  </button>
                  <button
                    type="button"
                    disabled={checkoutBusy}
                    onClick={onNeedMembership}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-[1rem] border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Bot size={16} />
                    {checkoutBusy ? t('跳转支付中...') : t('去开通会员')}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex size-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
                  <Bot size={22} />
                </div>
                <h3 className="mt-5 text-2xl font-black text-slate-950">{t('今日免费次数已用完')}</h3>
                <p className="mt-3 text-sm leading-7 text-slate-500">
                  {t('普通用户每天只能免费使用 1 次 AI 总结。如果你今天还想继续使用，需要开通 AI 会员。')}
                </p>
                <div className="mt-6 flex flex-col gap-3">
                  <button
                    type="button"
                    onClick={() => setAccessPrompt(null)}
                    className="inline-flex w-full items-center justify-center rounded-[1rem] border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                  >
                    {t('我知道了')}
                  </button>
                  <button
                    type="button"
                    disabled={checkoutBusy}
                    onClick={onNeedMembership}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-[1rem] bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Sparkles size={16} />
                    {checkoutBusy ? t('跳转支付中...') : t('去开通会员')}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      ) : null}

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
                    {visibleTabs.map((tab) => {
                      const Icon = tab.icon
                      const isActive = activeTab === tab.id
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setActiveTab(tab.id)}
                          className={`relative inline-flex min-w-0 items-center justify-center gap-2 rounded-t-[1rem] px-3 py-3 text-[15px] font-semibold transition ${
                            isActive ? 'bg-white text-blue-600' : 'text-slate-500 hover:text-slate-900'
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
                        <p className="mt-1 text-xs leading-6 text-slate-500">{sourceBadge.detail}</p>
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
                        <InfoPill>{`${sourceStatus?.character_count ?? '--'} 字`}</InfoPill>
                        <InfoPill>{summaryProgress.message}</InfoPill>
                      </div>
                    </div>

                    {!canUsePremiumAi ? (
                      <div className="rounded-[1.25rem] border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-7 text-amber-800">
                        {t('本次为免费 AI 总结体验，字幕查看、思维导图、AI 问答和导出功能需要开通会员后使用。')}
                      </div>
                    ) : null}

                    <div className="space-y-3 rounded-[1.5rem] bg-white p-4 shadow-sm ring-1 ring-slate-100">
                      <ActionButton
                        icon={isGeneratingSummary ? <LoaderCircle size={16} className="animate-spin" /> : <Sparkles size={16} />}
                        onClick={handleGenerateSummary}
                        disabled={isGeneratingSummary}
                        className="bg-slate-950 text-white hover:bg-slate-800 disabled:bg-slate-400"
                      >
                        {isGeneratingSummary ? t('正在生成...') : t('重新生成总结')}
                      </ActionButton>

                      {canUsePremiumAi ? (
                        <>
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
                        </>
                      ) : (
                        <button
                          type="button"
                          disabled={checkoutBusy}
                          onClick={onNeedMembership}
                          className="inline-flex w-full items-center justify-center gap-2 rounded-[1rem] border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <Sparkles size={16} />
                          {checkoutBusy ? t('跳转支付中...') : t('开通会员解锁更多 AI 功能')}
                        </button>
                      )}
                    </div>
                  </div>
                </aside>

                <div className="flex min-h-0 flex-col overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-sm">
                  <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
                    {activeTab === 'summary' ? (
                      <div>
                        {summaryError ? <ErrorNotice message={summaryError} /> : null}

                        {summary ? (
                          <article className="mx-auto max-w-[1040px]">
                            <div className="rounded-[2rem] border border-slate-200 bg-[linear-gradient(180deg,_#ffffff,_#f8fbff)] p-5 shadow-[0_20px_48px_rgba(15,23,42,0.06)] sm:p-6">
                              <div className="flex flex-wrap items-center gap-2 rounded-[1.2rem] border border-slate-200 bg-slate-50/80 px-3.5 py-2.5">
                                <span className="inline-flex items-center rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 ring-1 ring-slate-200">
                                  {t('AI Summary')}
                                </span>
                                <span className="text-sm font-medium text-slate-500">{t('⚡ 10 秒看重点')}</span>
                                <span className="hidden text-slate-300 sm:inline">·</span>
                                <span className="text-sm text-slate-400">{t('核心 → 观点 → 时间线')}</span>
                              </div>

                              {parsedSummarySections.length ? (
                                <div className="mt-5 grid gap-4">
                                  {parsedSummarySections.map((section) => (
                                    <SummarySectionCard key={`${section.key}-${section.title}`} section={section} />
                                  ))}
                                </div>
                              ) : (
                                <div
                                  className="summary-rich mt-5 max-w-none rounded-[1.6rem] border border-slate-200 bg-white px-6 py-6 shadow-sm [&_h1+*]:mt-0 [&_h2:first-child]:mt-0 [&_h2:first-child]:border-t-0 [&_h2:first-child]:pt-0 [&_h3:first-child]:mt-0 [&_li>strong]:text-slate-950 [&_ol]:space-y-4 [&_ul]:space-y-4"
                                  dangerouslySetInnerHTML={{ __html: formattedSummary }}
                                />
                              )}
                            </div>
                          </article>
                        ) : (
                          <EmptyPane
                            text={
                              isGeneratingSummary ? summaryProgress.message : t('点击左侧“重新生成总结”后开始输出。')
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
                            text={isLoadingTranscript ? t('正在加载字幕文本...') : t('点击左侧“加载字幕文本”后查看字幕时间轴。')}
                          />
                        )}
                      </div>
                    ) : null}

                    {activeTab === 'mindmap' ? (
                      <div className="h-full min-h-[640px]">
                        {mindmapError ? <ErrorNotice message={mindmapError} /> : null}

                        {mindmapData ? <MindmapCanvas rawMindmap={mindmapData} /> : <EmptyPane text={t('先生成总结，再点击左侧“生成思维导图”。')} />}
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

function SummarySectionCard({ section }: { section: ParsedSummarySection }) {
  const bulletItems = parseBulletItems(section.content)
  const timelineItems = parseTimelineItems(section.content)

  if (section.key === 'overview') {
    return (
      <section className="overflow-hidden rounded-[1.6rem] border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
          <span className="flex size-10 items-center justify-center rounded-2xl bg-blue-50 text-lg">{section.icon}</span>
          <div>
            <h3 className="text-[18px] font-bold tracking-[-0.01em] text-slate-950">{section.title}</h3>
            <p className="text-xs font-medium text-slate-400">{t('3 行内快速看懂这条视频')}</p>
          </div>
        </div>
        <div className="px-5 py-5">
          <p
            className="max-w-4xl text-[15px] leading-[1.85] text-slate-700 sm:text-[16px]"
            dangerouslySetInnerHTML={{ __html: emphasizeInlineText(section.content) }}
          />
        </div>
      </section>
    )
  }

  if (section.key === 'points') {
    return (
      <section className="overflow-hidden rounded-[1.6rem] border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
          <span className="flex size-10 items-center justify-center rounded-2xl bg-indigo-50 text-lg">{section.icon}</span>
          <div>
            <h3 className="text-[18px] font-bold tracking-[-0.01em] text-slate-950">{section.title}</h3>
            <p className="text-xs font-medium text-slate-400">{t('只保留最值得记住的 3 到 5 个点')}</p>
          </div>
        </div>
        <div className="grid gap-3 px-5 py-5">
          {bulletItems.map((item, index) => (
            <div key={`${section.title}-${index}`} className="flex gap-3 rounded-[1.2rem] border border-slate-100 bg-slate-50/70 px-4 py-3">
              <span className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-full bg-blue-500/10 text-xs font-semibold text-blue-600">
                {index + 1}
              </span>
              <p
                className="text-[14px] leading-[1.8] text-slate-700"
                dangerouslySetInnerHTML={{ __html: emphasizeInlineText(item) }}
              />
            </div>
          ))}
        </div>
      </section>
    )
  }

  if (section.key === 'timeline') {
    return (
      <section className="overflow-hidden rounded-[1.6rem] border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
          <span className="flex size-10 items-center justify-center rounded-2xl bg-sky-50 text-lg">{section.icon}</span>
          <div>
            <h3 className="text-[18px] font-bold tracking-[-0.01em] text-slate-950">{section.title}</h3>
            <p className="text-xs font-medium text-slate-400">{t('按时间顺序快速回看视频结构')}</p>
          </div>
        </div>
        <div className="space-y-4 px-5 py-5">
          {timelineItems.map((item) => (
            <div key={item.id} className="grid gap-3 border-l border-slate-200 pl-4 md:grid-cols-[120px_minmax(0,1fr)] md:items-start">
              <div className="inline-flex w-fit items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
                {item.time}
              </div>
              <p
                className="text-[14px] leading-[1.8] text-slate-700"
                dangerouslySetInnerHTML={{ __html: emphasizeInlineText(item.text) }}
              />
            </div>
          ))}
        </div>
      </section>
    )
  }

  if (section.key === 'takeaways') {
    return (
      <section className="overflow-hidden rounded-[1.6rem] border border-blue-200 bg-[linear-gradient(135deg,_#eff6ff,_#ffffff_72%)] shadow-sm">
        <div className="flex items-center gap-3 border-b border-blue-100 px-5 py-4">
          <span className="flex size-10 items-center justify-center rounded-2xl bg-white text-lg shadow-sm">{section.icon}</span>
          <div>
            <h3 className="text-[18px] font-bold tracking-[-0.01em] text-slate-950">{section.title}</h3>
            <p className="text-xs font-medium text-blue-500">{t('最后只记住这一层就够了')}</p>
          </div>
        </div>
        <div className="px-5 py-5">
          <div className="rounded-[1.3rem] border border-white/80 bg-white/80 px-4 py-4 shadow-sm">
            <p
              className="text-[15px] leading-[1.85] text-slate-700"
              dangerouslySetInnerHTML={{ __html: emphasizeInlineText(section.content) }}
            />
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="overflow-hidden rounded-[1.6rem] border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
        <span className="flex size-10 items-center justify-center rounded-2xl bg-slate-100 text-lg">{section.icon}</span>
        <h3 className="text-[18px] font-bold tracking-[-0.01em] text-slate-950">{section.title}</h3>
      </div>
      <div
        className="summary-rich px-5 py-5 text-[14px] leading-[1.8] text-slate-700 [&_li>strong]:text-slate-950 [&_ol]:space-y-3 [&_ul]:space-y-3"
        dangerouslySetInnerHTML={{ __html: formatMarkdownToHtml(section.content) }}
      />
    </section>
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
