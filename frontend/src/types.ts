export type DownloadMode = 'direct' | 'proxy'

export interface DownloadStrategy {
  mode: DownloadMode
  reason: string
  label: string
}

export interface VideoFormatOption {
  format_id: string
  ext: string
  resolution: string
  label: string
  quality_rank: number
  download_mode: DownloadMode
  is_complete_media: boolean
  filesize: number | null
  filesize_human: string
  fps: number | null
  vcodec: string | null
  acodec: string | null
  protocol: string | null
  has_direct_url: boolean
  note: string
  recommended: boolean
}

export interface VideoMeta {
  source_url: string
  title: string
  thumbnail: string | null
  description: string | null
  duration_seconds: number | null
  duration_human: string
  uploader: string | null
  extractor: string | null
  view_count: number | null
  webpage_url: string | null
  can_use_direct_link: boolean
  recommended_strategy: DownloadStrategy
  formats: VideoFormatOption[]
  copyright_notice: string
}

export interface DirectLinkPayload {
  url: string | null
  strategy: DownloadStrategy
  expires_hint: string | null
  warning: string | null
}

export interface ApiError {
  code: string
  message: string
  detail?: unknown
}

export interface ApiResponse<T> {
  success: boolean
  data: T | null
  error: ApiError | null
}
