import type { AgentStatus } from '@deepseek-ai/dsh-agent'

export interface SessionEventLike {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: unknown
  readonly surfaceOp?: unknown
}

export interface UserTranscriptEntry {
  readonly kind: 'user'
  readonly key: string
  readonly seq: number
  readonly text: string
  readonly detail?: string
  readonly injected: boolean
  readonly sourceLabel?: string
}

export interface StreamBlock {
  readonly index: number
  readonly kind: 'text' | 'reasoning'
  readonly text: string
}

export interface AssistantTranscriptEntry {
  readonly kind: 'assistant'
  readonly key: string
  readonly seq: number
  readonly turn: number
  readonly step: number
  readonly text: string
  readonly reasoning: string
  readonly streaming: boolean
  readonly blocks: readonly StreamBlock[]
}

export interface ToolTranscriptEntry {
  readonly kind: 'tool'
  readonly key: string
  readonly seq: number
  readonly callId: string
  readonly name: string
  readonly arguments: string
  readonly result: string | undefined
  readonly resultMeta: unknown
  readonly status: 'running' | 'success' | 'error'
  readonly startedAt: number
  readonly durationMs: number | undefined
}

export interface ErrorTranscriptEntry {
  readonly kind: 'error'
  readonly key: string
  readonly seq: number
  readonly text: string
  readonly code?: string
}

export type TranscriptEntry = UserTranscriptEntry | AssistantTranscriptEntry | ToolTranscriptEntry | ErrorTranscriptEntry

export interface HarnessStateSnapshot {
  readonly permissionPreset?: string
  readonly sandboxMode?: string
  readonly approvalPolicy?: string
  readonly agentPreset?: string
}

export interface CatalogOverlayItem {
  readonly value: string
  readonly label: string
  readonly description?: string
}

export type OverlayState =
  | { readonly kind: 'none' }
  | { readonly kind: 'help' }
  | {
    readonly kind: 'catalog'
    readonly id: number
    readonly title: string
    readonly body?: string
    readonly items: readonly CatalogOverlayItem[]
    readonly selected?: number
  }
  | { readonly kind: 'tools'; readonly selected: number }
  | { readonly kind: 'tool-detail'; readonly callId: string; readonly scroll: number }
  | { readonly kind: 'approval'; readonly requestId: number }
  | { readonly kind: 'question'; readonly requestId: number }

export interface CapabilityState {
  readonly tools: boolean
  readonly approval: boolean
  readonly userQuestions: boolean
  readonly permissionPresets: boolean
  readonly compaction: boolean
  readonly sessionProjections: boolean
  readonly agentPresets: boolean
}

export interface TuiSnapshot {
  readonly lastSeq: number
  readonly transcript: readonly TranscriptEntry[]
  readonly status: AgentStatus
  readonly inboxCount: number
  readonly currentTurn: number | undefined
  readonly currentStep: number | undefined
  readonly harness: HarnessStateSnapshot
  readonly overlay: OverlayState
  readonly notice: string | undefined
  readonly unknownEventCount: number
  readonly sessionId: string | undefined
  readonly provider: string | undefined
  readonly model: string | undefined
  readonly capabilities: CapabilityState
}

export const DEFAULT_CAPABILITIES: CapabilityState = {
  tools: false,
  approval: false,
  userQuestions: false,
  permissionPresets: false,
  compaction: false,
  sessionProjections: false,
  agentPresets: false,
}

export function createInitialSnapshot(): TuiSnapshot {
  return {
    lastSeq: -1,
    transcript: [],
    status: 'idle',
    inboxCount: 0,
    currentTurn: undefined,
    currentStep: undefined,
    harness: {},
    overlay: { kind: 'none' },
    notice: undefined,
    unknownEventCount: 0,
    sessionId: undefined,
    provider: undefined,
    model: undefined,
    capabilities: DEFAULT_CAPABILITIES,
  }
}
