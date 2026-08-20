import {
  Loader,
  stripTerminalSequences,
  truncateToWidth,
  visibleWidth,
  type TUI,
} from '@earendil-works/pi-tui'
import type { ToolPresenter } from '../../runtime/tool-presentation.js'
import type { AssistantTranscriptEntry, ToolTranscriptEntry, TuiSnapshot } from '../state.js'
import { theme } from '../theme.js'
import { fitLines } from './common.js'

const MAX_ACTIVITY_WIDTH = 64
const SPINNER_WIDTH = 2
const INTERRUPT_HINT = '⟨esc⟩'

function stripControlCharacters(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint < 32 || codePoint === 127 ? ' ' : character
  }).join('')
}

function cleanActivityCandidate(value: string): string {
  return stripControlCharacters(value)
    .replace(/^\s*(?:#{1,6}\s+|[-*+>]\s+|\d+[.)、]\s*)/, '')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/[`*_~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function truncateActivityTail(value: string, width = MAX_ACTIVITY_WIDTH): string {
  if (visibleWidth(value) <= width) return value
  const marker = '…'
  const available = Math.max(0, width - visibleWidth(marker))
  const characters = Array.from(value)
  let tail = ''
  for (let index = characters.length - 1; index >= 0; index--) {
    const character = characters[index]
    if (character === undefined || visibleWidth(`${character}${tail}`) > available) break
    tail = `${character}${tail}`
  }
  return `${marker}${tail}`
}

function latestGeneratedPhrase(source: string): string | undefined {
  const recent = stripTerminalSequences(source.slice(-4096)).replaceAll('\r', '\n')
  const lines = recent.split('\n')
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index]
    if (line === undefined || /^\s*```/.test(line)) continue
    const candidate = cleanActivityCandidate(line)
    if (candidate.length === 0) continue
    const clauses = candidate
      .split(/(?:[。！？；!?;]\s*|\.(?:\s+|$))/)
      .map((clause) => clause.trim())
      .filter((clause) => clause.length > 0)
    const phrase = clauses.at(-1) ?? candidate
    if (!/[\p{L}\p{N}]/u.test(phrase)) continue
    return truncateActivityTail(phrase)
  }
  return undefined
}

function resolveToolIntent(entry: ToolTranscriptEntry): string | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(entry.arguments) as unknown
  } catch {
    return undefined
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
  const record = parsed as Record<string, unknown>
  const intent = typeof record.i === 'string'
    ? record.i
    : typeof record.intent === 'string'
      ? record.intent
      : undefined
  if (intent === undefined) return undefined
  const cleaned = cleanActivityCandidate(stripTerminalSequences(intent))
  return cleaned.length > 0 ? truncateToWidth(cleaned, MAX_ACTIVITY_WIDTH, '…') : undefined
}

export function formatWorkingElapsed(elapsedMs: number): string {
  const totalSeconds = Math.floor(Math.max(0, elapsedMs) / 1000)
  const seconds = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  if (totalMinutes === 0) return `${seconds}s`
  const minutes = totalMinutes % 60
  const paddedSeconds = String(seconds).padStart(2, '0')
  if (totalMinutes < 60) return `${minutes}m ${paddedSeconds}s`
  const hours = Math.floor(totalMinutes / 60)
  return `${hours}h ${String(minutes).padStart(2, '0')}m ${paddedSeconds}s`
}

export function resolveWorkingActivity(snapshot: TuiSnapshot, tools: ToolPresenter): string | undefined {
  if (snapshot.status !== 'running' || snapshot.lifecycle !== 'active') return undefined

  for (let index = snapshot.transcript.length - 1; index >= 0; index--) {
    const entry = snapshot.transcript[index]
    if (entry?.kind !== 'tool' || entry.status !== 'running') continue
    const intent = resolveToolIntent(entry)
    if (intent !== undefined) return intent
    const title = tools.presentSummary(entry).title.trim()
    return title.length > 0 ? title : entry.name
  }

  const assistant = [...snapshot.transcript].reverse().find(
    (entry): entry is AssistantTranscriptEntry => entry.kind === 'assistant'
      && (entry.streaming || (snapshot.currentTurn !== undefined && entry.turn === snapshot.currentTurn))
      && (entry.reasoning.length > 0 || entry.text.length > 0),
  )
  if (assistant !== undefined) {
    const tail = assistant.streaming ? assistant.blocks.at(-1) : undefined
    if (tail?.kind === 'reasoning' || (assistant.reasoning.length > 0 && assistant.text.length === 0)) {
      const phrase = latestGeneratedPhrase(tail?.text ?? assistant.reasoning)
      return phrase === undefined ? '正在思考' : `正在思考：${phrase}`
    }
    const phrase = latestGeneratedPhrase(tail?.text ?? assistant.text)
    return phrase ?? '正在生成回复'
  }

  return '正在等待模型响应'
}

export class WorkingStatus {
  private readonly loader: Loader
  private active = false
  private activity = ''
  private message = ''
  private startedAt = 0

  constructor(tui: TUI, private readonly now: () => number = Date.now) {
    this.loader = new Loader(tui, theme.warning, (text) => text, '')
    this.loader.stop()
  }

  setActivity(activity: string | undefined): void {
    if (activity === undefined) {
      this.active = false
      this.activity = ''
      this.message = ''
      this.startedAt = 0
      this.loader.stop()
      return
    }

    this.activity = activity
    if (!this.active) {
      this.active = true
      this.startedAt = this.now()
      this.updateMessage(80)
      this.loader.start()
    }
  }

  render(width: number): string[] {
    if (!this.active) return []
    const safeWidth = Math.max(1, width)
    this.updateMessage(safeWidth)
    return fitLines(this.loader.render(safeWidth).slice(1), safeWidth)
  }

  dispose(): void {
    this.active = false
    this.activity = ''
    this.startedAt = 0
    this.loader.stop()
  }

  private updateMessage(width: number): void {
    const elapsed = formatWorkingElapsed(this.now() - this.startedAt)
    const messageWidth = Math.max(1, width - SPINNER_WIDTH)
    const suffix = [
      ` · ${elapsed} ${INTERRUPT_HINT}`,
      ` ${elapsed} ${INTERRUPT_HINT}`,
      ` ${elapsed}`,
      '',
    ].find((candidate) => visibleWidth(candidate) <= messageWidth) ?? ''
    const activityWidth = Math.max(0, messageWidth - visibleWidth(suffix))
    const activity = activityWidth === 0 ? '' : truncateToWidth(this.activity, activityWidth, '…')
    const message = `${activity.length === 0 ? '' : theme.text(activity)}${theme.muted(suffix)}`
    if (message === this.message) return
    this.message = message
    this.loader.setMessage(message)
  }
}
