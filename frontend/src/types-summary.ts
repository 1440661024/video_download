export type SummarySourceType =
  | 'human_subtitles'
  | 'auto_subtitles'
  | 'speech_to_text'
  | 'metadata'

export interface VideoSummarySourceStatus {
  source_type: SummarySourceType
  language: string | null
  segment_count: number
  character_count: number
  fallback_used: boolean
}

export interface VideoMindmapResponse {
  mindmap: string
  source_status?: VideoSummarySourceStatus
}

export interface VideoTranscriptSegment {
  start_seconds: number | null
  start_human: string | null
  end_seconds: number | null
  end_human: string | null
  text: string
}

export interface VideoTranscriptResponse {
  transcript: string
  source_status?: VideoSummarySourceStatus
  segments: VideoTranscriptSegment[]
}
