import { Download, Expand, Minimize, Minus, Move, Plus, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode, type WheelEvent } from 'react'

type MindmapNode = {
  title: string
  children: MindmapNode[]
}

type PositionedNode = {
  id: string
  title: string
  depth: number
  x: number
  y: number
  width: number
  height: number
  color: string
  parentId: string | null
  lines: string[]
  nodeType: 'root' | 'branch' | 'leaf' | 'highlight' | 'conclusion'
}

type ViewState = {
  scale: number
  x: number
  y: number
}

type LayoutResult = {
  nodes: PositionedNode[]
  width: number
  height: number
}

const BRANCH_COLORS = ['#3b82f6', '#14b8a6', '#6366f1', '#0ea5e9', '#64748b', '#22c55e', '#8b5cf6']
const ROOT_WIDTH = 336
const MAX_NODE_WIDTH = 250
const MIN_NODE_WIDTH = 148
const COLUMN_GAP = 220
const ROW_GAP = 30
const NODE_HEIGHT_BASE = 54
const NODE_LINE_HEIGHT = 22
const ROOT_NODE_HEIGHT_BASE = 96
const ROOT_NODE_LINE_HEIGHT = 32
const PADDING_X = 100
const PADDING_Y = 80
const MAX_LINES_PER_NODE = 2

function t(value: string) {
  return value
}

function detectNodeType(title: string, depth: number): PositionedNode['nodeType'] {
  if (depth === 0) {
    return 'root'
  }
  const normalized = title.replaceAll(/\s+/g, '')
  if (
    normalized.includes('结论') ||
    normalized.includes('总结') ||
    normalized.includes('启发') ||
    normalized.includes('收获')
  ) {
    return 'conclusion'
  }
  if (
    normalized.includes('关键') ||
    normalized.includes('重点') ||
    normalized.includes('核心') ||
    normalized.includes('⭐') ||
    normalized.includes('★')
  ) {
    return 'highlight'
  }
  return depth === 1 ? 'branch' : 'leaf'
}

function splitLongTextToChildren(title: string) {
  const clean = title.replace(/\s+/g, ' ').trim()
  if (clean.length <= 22) {
    return null
  }

  const separators = /[；;。！？!?]/g
  const parts = clean
    .split(separators)
    .map((item) => item.replace(/^[、,，.\-\s]+|[、,，.\-\s]+$/g, '').trim())
    .filter(Boolean)

  if (parts.length >= 2) {
    return parts.map((part) => ({ title: part, children: [] as MindmapNode[] }))
  }

  return null
}

function normalizeNode(input: unknown): MindmapNode | null {
  if (typeof input === 'string') {
    const text = input.trim()
    return text ? { title: text, children: [] } : null
  }

  if (!input || typeof input !== 'object') {
    return null
  }

  const record = input as { title?: unknown; children?: unknown }
  const title = typeof record.title === 'string' ? record.title.trim() : ''
  const rawChildren = Array.isArray(record.children) ? record.children : []
  const children = rawChildren.map(normalizeNode).filter(Boolean) as MindmapNode[]

  if (!title) {
    if (children.length === 1) {
      return children[0]
    }
    if (children.length > 1) {
      return { title: t('\u672a\u547d\u540d\u4e3b\u9898'), children }
    }
    return null
  }

  const autoSplitChildren = !children.length ? splitLongTextToChildren(title) : null
  return { title, children: autoSplitChildren ?? children }
}

function parseMindmap(rawMindmap: string): MindmapNode | null {
  try {
    const parsed = JSON.parse(rawMindmap) as unknown
    return normalizeNode(parsed)
  } catch {
    return null
  }
}

function getDepth(node: MindmapNode): number {
  if (!node.children.length) {
    return 1
  }
  return 1 + Math.max(...node.children.map(getDepth))
}

function countLeaves(node: MindmapNode): number {
  if (!node.children.length) {
    return 1
  }
  return node.children.reduce((sum, child) => sum + countLeaves(child), 0)
}

function wrapText(title: string, depth: number) {
  const clean = title.replace(/\s+/g, ' ').trim()
  const charsPerLine = depth === 0 ? 10 : depth === 1 ? 14 : 16
  const lines: string[] = []
  for (let index = 0; index < clean.length; index += charsPerLine) {
    lines.push(clean.slice(index, index + charsPerLine))
  }
  const limitedLines = lines.length ? lines.slice(0, MAX_LINES_PER_NODE) : ['']
  if (lines.length > MAX_LINES_PER_NODE) {
    const lastIndex = limitedLines.length - 1
    limitedLines[lastIndex] = `${limitedLines[lastIndex].slice(0, Math.max(0, limitedLines[lastIndex].length - 1))}…`
  }
  return limitedLines
}

function estimateNodeSize(lines: string[], depth: number, nodeType: PositionedNode['nodeType']) {
  const longestLine = Math.max(...lines.map((line) => line.length), 1)
  const width = Math.max(
    depth === 0 ? ROOT_WIDTH : MIN_NODE_WIDTH,
    Math.min(MAX_NODE_WIDTH, longestLine * (depth === 0 ? 18 : 14) + 44),
  )
  const lineHeight = depth === 0 ? ROOT_NODE_LINE_HEIGHT : NODE_LINE_HEIGHT
  const baseHeight = depth === 0 ? ROOT_NODE_HEIGHT_BASE : nodeType === 'conclusion' ? NODE_HEIGHT_BASE + 10 : NODE_HEIGHT_BASE
  const height = baseHeight + Math.max(0, lines.length - 1) * lineHeight
  return { width, height }
}

function layoutMindmap(root: MindmapNode): LayoutResult {
  const nodes: PositionedNode[] = []
  const depth = getDepth(root)
  const leafCount = countLeaves(root)
  const totalHeight = Math.max(leafCount * (NODE_HEIGHT_BASE + ROW_GAP) + PADDING_Y * 2, 560)
  const totalWidth = Math.max(depth * COLUMN_GAP + PADDING_X * 2 + 360, 1100)
  let nextLeafY = PADDING_Y
  let sequence = 0

  function visit(node: MindmapNode, currentDepth: number, parentId: string | null, color: string): number {
    const id = `node-${sequence++}`
    const nodeType = detectNodeType(node.title, currentDepth)
    const lines = wrapText(node.title, currentDepth)
    const size = estimateNodeSize(lines, currentDepth, nodeType)
    const x = PADDING_X + currentDepth * COLUMN_GAP
    let y: number

    if (!node.children.length) {
      y = nextLeafY
      nextLeafY += size.height + ROW_GAP
    } else {
      const childYs = node.children.map((child, index) =>
        visit(
          child,
          currentDepth + 1,
          id,
          currentDepth === 0 ? BRANCH_COLORS[index % BRANCH_COLORS.length] : color,
        ),
      )
      y = childYs.reduce((sum, value) => sum + value, 0) / childYs.length
    }

    nodes.push({
      id,
      title: node.title,
      depth: currentDepth,
      x,
      y,
      width: size.width,
      height: size.height,
      color,
      parentId,
      lines,
      nodeType,
    })

    return y
  }

  visit(root, 0, null, '#2563eb')
  return { nodes, width: totalWidth, height: totalHeight }
}

function buildCurvePath(from: PositionedNode, to: PositionedNode) {
  const startX = from.x + from.width
  const startY = from.y + from.height / 2
  const endX = to.x
  const endY = to.y + to.height / 2
  const offset = Math.max((endX - startX) * 0.42, 44)
  return `M ${startX} ${startY} C ${startX + offset} ${startY}, ${endX - offset} ${endY}, ${endX} ${endY}`
}

function createFitView(layout: LayoutResult, width: number, height: number): ViewState {
  const padding = 48
  const scale = Math.min(
    (width - padding * 2) / layout.width,
    (height - padding * 2) / layout.height,
    1,
  )
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1
  const x = (width - layout.width * safeScale) / 2
  const y = (height - layout.height * safeScale) / 2
  return { scale: safeScale, x, y }
}

function clampScale(scale: number) {
  return Math.min(2.2, Math.max(0.45, scale))
}

function svgMarkup(layout: LayoutResult, nodeMap: Map<string, PositionedNode>) {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}">
      <defs>
        <filter id="mindmap-shadow-export" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="10" stdDeviation="18" flood-color="#cbd5e1" flood-opacity="0.38" />
        </filter>
      </defs>
      <rect width="${layout.width}" height="${layout.height}" fill="#ffffff" />
      ${layout.nodes
        .map((node) => {
          if (!node.parentId) {
            return ''
          }
          const parent = nodeMap.get(node.parentId)
          if (!parent) {
            return ''
          }
          return `<path d="${buildCurvePath(parent, node)}" fill="none" stroke="${node.color}" stroke-width="1" stroke-linecap="round" opacity="0.45" />`
        })
        .join('')}
      ${layout.nodes
        .map((node) => {
          const textColor =
            node.nodeType === 'root' ? '#ffffff' : node.nodeType === 'leaf' ? '#475569' : '#0f172a'
          const rectFill =
            node.nodeType === 'root'
              ? '#0f172a'
              : node.nodeType === 'conclusion'
                ? '#fff8db'
                : node.nodeType === 'highlight'
                  ? '#f8fafc'
                  : '#ffffff'
          const rectStroke =
            node.nodeType === 'root'
              ? '#0f172a'
              : node.nodeType === 'conclusion'
                ? '#facc15'
                : '#e5e7eb'
          const textX = node.depth === 0 ? node.width / 2 : 24
          const textAnchor = node.depth === 0 ? 'middle' : 'start'
          const currentLineHeight = node.depth === 0 ? ROOT_NODE_LINE_HEIGHT : NODE_LINE_HEIGHT
          const textY =
            node.depth === 0
              ? node.height / 2 - ((node.lines.length - 1) * currentLineHeight) / 2
              : 28
          const tspans = node.lines
            .map(
              (line, index) =>
                `<tspan x="${textX}" dy="${index === 0 ? 0 : currentLineHeight}">${escapeXml(line)}</tspan>`,
            )
            .join('')

          return `
            <g transform="translate(${node.x}, ${node.y})" filter="url(#mindmap-shadow-export)">
              <rect width="${node.width}" height="${node.height}" rx="${node.depth === 0 ? 28 : 18}" fill="${rectFill}" stroke="${rectStroke}" stroke-width="${node.depth === 0 ? 0 : 1}" />
              ${
                node.depth !== 0
                  ? `<rect x="0" y="0" width="6" height="${node.height}" rx="6" fill="${node.color}" />`
                  : ''
              }
              ${
                node.nodeType === 'highlight'
                  ? `<text x="${node.width - 20}" y="22" text-anchor="middle" font-size="14" font-weight="700" fill="#f59e0b">★</text>`
                  : ''
              }
              <text x="${textX}" y="${textY}" text-anchor="${textAnchor}" font-size="${node.depth === 0 ? 22 : node.depth === 1 ? 16 : 14}" font-weight="${node.depth <= 1 ? 700 : 600}" fill="${textColor}" font-family="Segoe UI, PingFang SC, Microsoft YaHei, sans-serif">
                ${tspans}
              </text>
            </g>
          `
        })
        .join('')}
    </svg>
  `
}

function escapeXml(text: string) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

export function MindmapCanvas({ rawMindmap }: { rawMindmap: string }) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const dragState = useRef<{
    pointerId: number
    startX: number
    startY: number
    viewX: number
    viewY: number
  } | null>(null)
  const hasInteractedRef = useRef(false)
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })
  const [view, setView] = useState<ViewState>({ scale: 1, x: 0, y: 0 })
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)

  const layout = useMemo(() => {
    const root = parseMindmap(rawMindmap)
    return root ? layoutMindmap(root) : null
  }, [rawMindmap])

  useEffect(() => {
    const element = containerRef.current
    if (!element) {
      return
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) {
        return
      }
      setContainerSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(document.fullscreenElement === rootRef.current)
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  useEffect(() => {
    if (!layout || !containerSize.width || !containerSize.height || hasInteractedRef.current) {
      return
    }
    setView(createFitView(layout, containerSize.width, containerSize.height))
  }, [containerSize.height, containerSize.width, layout])

  function handleResetView() {
    if (!layout || !containerSize.width || !containerSize.height) {
      return
    }
    hasInteractedRef.current = false
    setView(createFitView(layout, containerSize.width, containerSize.height))
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    if (!layout || !containerRef.current) {
      return
    }
    event.preventDefault()
    hasInteractedRef.current = true
    const rect = containerRef.current.getBoundingClientRect()
    const cursorX = event.clientX - rect.left
    const cursorY = event.clientY - rect.top
    const nextScale = clampScale(view.scale * (event.deltaY > 0 ? 0.92 : 1.08))
    const ratio = nextScale / view.scale
    setView((current) => ({
      scale: nextScale,
      x: cursorX - (cursorX - current.x) * ratio,
      y: cursorY - (cursorY - current.y) * ratio,
    }))
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return
    }
    event.preventDefault()
    hasInteractedRef.current = true
    dragState.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      viewX: view.x,
      viewY: view.y,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragState.current
    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }
    const deltaX = event.clientX - drag.startX
    const deltaY = event.clientY - drag.startY
    setView((current) => ({
      ...current,
      x: drag.viewX + deltaX,
      y: drag.viewY + deltaY,
    }))
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    if (dragState.current?.pointerId === event.pointerId) {
      dragState.current = null
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  function zoomBy(multiplier: number) {
    hasInteractedRef.current = true
    setView((current) => ({ ...current, scale: clampScale(current.scale * multiplier) }))
  }

  async function toggleFullscreen() {
    if (!rootRef.current) {
      return
    }
    if (document.fullscreenElement === rootRef.current) {
      await document.exitFullscreen()
      return
    }
    await rootRef.current.requestFullscreen()
  }

  async function downloadPng() {
    if (!layout) {
      return
    }
    const nodeMap = new Map(layout.nodes.map((node) => [node.id, node]))
    const markup = svgMarkup(layout, nodeMap)
    const blob = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const image = new Image()
    image.decoding = 'async'

    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('mindmap image load failed'))
      image.src = url
    })

    const scale = 2
    const canvas = document.createElement('canvas')
    canvas.width = layout.width * scale
    canvas.height = layout.height * scale
    const context = canvas.getContext('2d')
    if (!context) {
      URL.revokeObjectURL(url)
      return
    }
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.scale(scale, scale)
    context.drawImage(image, 0, 0, layout.width, layout.height)
    URL.revokeObjectURL(url)

    const pngUrl = canvas.toDataURL('image/png')
    const anchor = document.createElement('a')
    anchor.href = pngUrl
    anchor.download = 'video-mindmap.png'
    anchor.click()
  }

  if (!layout) {
    return (
      <pre className="overflow-auto rounded-[1.5rem] bg-slate-950 p-4 text-xs leading-6 text-slate-100">
        {rawMindmap}
      </pre>
    )
  }

  const nodeMap = new Map(layout.nodes.map((node) => [node.id, node]))

  return (
    <div
      ref={rootRef}
      className={`flex flex-col overflow-hidden rounded-[1.75rem] border border-slate-200 bg-[radial-gradient(circle_at_top_left,_#eff6ff,_transparent_32%),linear-gradient(180deg,_#f9fbff,_#ffffff_42%,_#f8fafc)] ${
        isFullscreen ? 'h-screen w-screen rounded-none border-0' : 'h-full min-h-[640px]'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <p className="text-sm font-semibold text-slate-900">{t('\u5b66\u4e60\u578b\u601d\u7ef4\u5bfc\u56fe')}</p>
        <div className="flex items-center gap-2">
          <ControlButton onClick={() => zoomBy(1.1)} title={t('\u653e\u5927')}>
            <Plus size={14} />
          </ControlButton>
          <ControlButton onClick={() => zoomBy(0.9)} title={t('\u7f29\u5c0f')}>
            <Minus size={14} />
          </ControlButton>
          <ControlButton onClick={handleResetView} title={t('\u9002\u5e94\u753b\u5e03')}>
            <RotateCcw size={14} />
          </ControlButton>
          <ControlButton onClick={downloadPng} title={t('\u4e0b\u8f7d\u9ad8\u6e05\u56fe\u7247')}>
            <Download size={14} />
          </ControlButton>
          <ControlButton onClick={() => void toggleFullscreen()} title={isFullscreen ? t('\u9000\u51fa\u5168\u5c4f') : t('\u5168\u5c4f\u67e5\u770b')}>
            {isFullscreen ? <Minimize size={14} /> : <Expand size={14} />}
          </ControlButton>
          <div className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500">
            <Move size={12} />
            {t('\u62d6\u52a8\u753b\u5e03')}
          </div>
        </div>
      </div>

      <div
        ref={containerRef}
        className="relative min-h-0 flex-1 touch-none overflow-hidden select-none"
        style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <svg ref={svgRef} className="absolute inset-0 h-full w-full select-none" style={{ userSelect: 'none' }}>
          <defs>
            <filter id="mindmap-shadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="8" stdDeviation="10" floodColor="#94a3b8" floodOpacity="0.16" />
            </filter>
          </defs>

          <g transform={`translate(${view.x}, ${view.y}) scale(${view.scale})`}>
            {layout.nodes.map((node) => {
              if (!node.parentId) {
                return null
              }
              const parent = nodeMap.get(node.parentId)
              if (!parent) {
                return null
              }
              return (
                <path
                  key={`${parent.id}-${node.id}`}
                  d={buildCurvePath(parent, node)}
                  fill="none"
                  stroke={node.color}
                  strokeWidth={1}
                  strokeLinecap="round"
                  opacity={0.48}
                />
              )
            })}

            {layout.nodes.map((node) => (
              <g
                key={node.id}
                transform={`translate(${node.x}, ${node.y})`}
                filter="url(#mindmap-shadow)"
                style={{ userSelect: 'none' }}
                onMouseEnter={() => setHoveredNodeId(node.id)}
                onMouseLeave={() => setHoveredNodeId((current) => (current === node.id ? null : current))}
              >
                <rect
                  width={node.width}
                  height={node.height}
                  rx={node.depth === 0 ? 28 : 18}
                  fill={
                    node.nodeType === 'root'
                      ? '#0f172a'
                      : node.nodeType === 'conclusion'
                        ? '#fff8db'
                        : node.nodeType === 'highlight'
                          ? '#f8fafc'
                          : '#ffffff'
                  }
                  stroke={
                    hoveredNodeId === node.id
                      ? '#93c5fd'
                      : node.nodeType === 'root'
                      ? '#0f172a'
                      : node.nodeType === 'conclusion'
                        ? '#facc15'
                        : '#e5e7eb'
                  }
                  strokeWidth={node.depth === 0 ? 0 : hoveredNodeId === node.id ? 1.4 : 1}
                />
                {node.depth !== 0 ? (
                  <rect x="0" y="0" width="4" height={node.height} rx="4" fill={node.color} opacity={node.depth === 1 ? 0.9 : 0.45} />
                ) : null}
                {node.nodeType === 'highlight' ? (
                  <text x={node.width - 20} y={22} textAnchor="middle" fontSize={14} fontWeight={700} fill="#f59e0b">
                    ★
                  </text>
                ) : null}
                <text
                  x={node.depth === 0 ? node.width / 2 : 24}
                  y={
                    node.depth === 0
                      ? node.height / 2 -
                        ((node.lines.length - 1) * (node.depth === 0 ? ROOT_NODE_LINE_HEIGHT : NODE_LINE_HEIGHT)) / 2
                      : 28
                  }
                  textAnchor={node.depth === 0 ? 'middle' : 'start'}
                  fontSize={node.depth === 0 ? 24 : node.depth === 1 ? 16 : 14}
                  fontWeight={node.depth <= 1 ? 700 : 500}
                  fill={
                    node.nodeType === 'root' ? '#ffffff' : node.nodeType === 'leaf' ? '#475569' : '#0f172a'
                  }
                  style={{ userSelect: 'none', pointerEvents: 'none' }}
                >
                  {node.lines.map((line, index) => (
                    <tspan
                      key={`${node.id}-${index}`}
                      x={node.depth === 0 ? node.width / 2 : 24}
                      dy={index === 0 ? 0 : node.depth === 0 ? ROOT_NODE_LINE_HEIGHT : NODE_LINE_HEIGHT}
                      style={{ dominantBaseline: 'hanging' }}
                    >
                      {line}
                    </tspan>
                  ))}
                </text>
              </g>
            ))}
          </g>
        </svg>
      </div>
    </div>
  )
}

function ControlButton({
  children,
  onClick,
  title,
}: {
  children: ReactNode
  onClick: () => void | Promise<void>
  title: string
}) {
  return (
    <button
      type="button"
      onClick={() => void onClick()}
      title={title}
      className="inline-flex size-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-blue-200 hover:text-blue-700"
    >
      {children}
    </button>
  )
}
