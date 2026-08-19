import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { isJsonValue, type JsonValue } from '@deepseek-ai/dsh-session'
import type { ToolCallView, ToolDefinition, ToolResult, ToolResultView } from '@deepseek-ai/dsh-tools'
import type { ToolTranscriptEntry } from '../tui/state.js'

export type ToolCardKind = 'terminal' | 'diff' | 'read' | 'search' | 'web' | 'generic'

export interface PresentedTool {
  readonly kind: ToolCardKind
  readonly title: string
  readonly summaryLines: readonly string[]
  readonly detailLines: readonly string[]
}

export interface ToolLookup {
  get(name: string): Pick<ToolDefinition, 'presentCall' | 'presentResult'> | undefined
}

interface LineSummary {
  readonly lines: string[]
  count: number
}

interface PreparedToolPresentation {
  readonly kind: ToolCardKind
  readonly title: string
  readonly fallback: string
  readonly resultView: ToolResultView | undefined
  readonly detailPrefix: readonly string[]
}

function isValidatedJsonValue(value: unknown): value is JsonValue {
  return isJsonValue(value)
}

function parseArguments(source: string): unknown {
  try {
    return JSON.parse(source) as unknown
  } catch (error) {
    return { raw: source, parseError: error instanceof Error ? error.message : String(error) }
  }
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return String(value)
  try {
    return JSON.stringify(value, undefined, 2)
  } catch (error) {
    return `[无法格式化：${error instanceof Error ? error.message : String(error)}]`
  }
}

function contentText(content: readonly ContentBlock[] | undefined): string[] {
  if (content === undefined) return []
  const lines: string[] = []
  for (const block of content) {
    if (block.type === 'text' || block.type === 'reasoning') lines.push(...block.text.split('\n'))
    else if (block.type === 'image') lines.push('[image]')
    else if (block.type === 'tool-call') lines.push(`${block.name} ${block.arguments}`)
    else lines.push(...contentText(block.content))
  }
  return lines
}

function appendLine(summary: LineSummary, line: string, maxLines: number): void {
  summary.count += 1
  if (summary.lines.length < maxLines) summary.lines.push(line)
}

function appendTextLines(summary: LineSummary, text: string, maxLines: number, prefix = ''): void {
  let start = 0
  let end = text.indexOf('\n', start)
  while (end !== -1) {
    appendLine(summary, `${prefix}${text.slice(start, end)}`, maxLines)
    start = end + 1
    end = text.indexOf('\n', start)
  }
  appendLine(summary, `${prefix}${text.slice(start)}`, maxLines)
}

function summarizeContentText(content: readonly ContentBlock[] | undefined, maxLines: number): LineSummary {
  const summary: LineSummary = { lines: [], count: 0 }
  if (content === undefined) return summary
  for (const block of content) {
    if (block.type === 'text' || block.type === 'reasoning') appendTextLines(summary, block.text, maxLines)
    else if (block.type === 'image') appendLine(summary, '[image]', maxLines)
    else if (block.type === 'tool-call') appendLine(summary, `${block.name} ${block.arguments}`, maxLines)
    else {
      const nested = summarizeContentText(block.content, Math.max(0, maxLines - summary.lines.length))
      summary.count += nested.count
      summary.lines.push(...nested.lines)
    }
  }
  return summary
}

function kindFromCall(view: ToolCallView | undefined): ToolCardKind {
  if (view?.card === 'terminal') return 'terminal'
  if (view?.card === 'diff') return 'diff'
  if (view?.card === 'generic') {
    if (view.kind === 'read') return 'read'
    if (view.kind === 'search') return 'search'
    if (view.kind === 'fetch') return 'web'
  }
  return 'generic'
}

function resultLines(view: ToolResultView | undefined, fallback: string): string[] {
  if (view === undefined) return fallback.split('\n')
  switch (view.card) {
    case 'generic':
      return view.content === undefined ? fallback.split('\n') : contentText(view.content)
    case 'terminal':
      return (view.output ?? fallback).split('\n')
    case 'diff':
      return view.diffs.flatMap((diff) => [
        `--- ${diff.path}`,
        `+++ ${diff.path}`,
        ...diff.newText.split('\n').map((line) => `+ ${line}`),
      ])
    case 'read':
      return view.lines.map((line) => `${String(line.number).padStart(5)} │ ${line.text}`)
    case 'search':
      return view.shape === 'paths'
        ? view.paths
        : view.files.flatMap((file) => [file.path, ...file.matches.map((match) => `  ${match.lineNumber}: ${match.line}`)])
    case 'web':
      return view.kind === 'fetch'
        ? [`${view.statusCode} ${view.url}${view.truncated ? ' · 已截断' : ''}`]
        : [
            ...(view.answer === undefined ? [] : view.answer.split('\n')),
            ...view.sources.map((source) => `${source.title ?? source.url} · ${source.url}`),
          ]
  }
}

function summarizeResultLines(view: ToolResultView | undefined, fallback: string, maxLines: number): LineSummary {
  const summary: LineSummary = { lines: [], count: 0 }
  if (view === undefined) {
    appendTextLines(summary, fallback, maxLines)
    return summary
  }
  switch (view.card) {
    case 'generic':
      return view.content === undefined
        ? summarizeResultLines(undefined, fallback, maxLines)
        : summarizeContentText(view.content, maxLines)
    case 'terminal':
      appendTextLines(summary, view.output ?? fallback, maxLines)
      return summary
    case 'diff':
      for (const diff of view.diffs) {
        appendLine(summary, `--- ${diff.path}`, maxLines)
        appendLine(summary, `+++ ${diff.path}`, maxLines)
        appendTextLines(summary, diff.newText, maxLines, '+ ')
      }
      return summary
    case 'read':
      summary.count = view.lines.length
      for (const line of view.lines.slice(0, maxLines)) {
        summary.lines.push(`${String(line.number).padStart(5)} │ ${line.text}`)
      }
      return summary
    case 'search':
      if (view.shape === 'paths') {
        summary.count = view.paths.length
        summary.lines.push(...view.paths.slice(0, maxLines))
        return summary
      }
      for (const file of view.files) {
        appendLine(summary, file.path, maxLines)
        for (const match of file.matches) appendLine(summary, `  ${match.lineNumber}: ${match.line}`, maxLines)
      }
      return summary
    case 'web':
      if (view.kind === 'fetch') {
        appendLine(summary, `${view.statusCode} ${view.url}${view.truncated ? ' · 已截断' : ''}`, maxLines)
        return summary
      }
      if (view.answer !== undefined) appendTextLines(summary, view.answer, maxLines)
      for (const source of view.sources) appendLine(summary, `${source.title ?? source.url} · ${source.url}`, maxLines)
      return summary
  }
}

function truncateSummary(lines: readonly string[], totalLines: number): string[] {
  const truncated = totalLines - lines.length
  return truncated > 0 ? [...lines, `… 另有 ${truncated} 行 · Ctrl+O`] : [...lines]
}

export class ToolPresenter {
  private readonly prepared = new WeakMap<ToolTranscriptEntry, PreparedToolPresentation>()
  private readonly summaryCache = new WeakMap<ToolTranscriptEntry, PresentedTool>()
  private readonly detailCache = new WeakMap<ToolTranscriptEntry, PresentedTool>()

  constructor(private readonly tools: ToolLookup | undefined, private readonly maxSummaryLines = 8) {}

  present(entry: ToolTranscriptEntry): PresentedTool {
    const cached = this.detailCache.get(entry)
    if (cached !== undefined) return cached
    const prepared = this.prepare(entry)
    const result = resultLines(prepared.resultView, prepared.fallback)
    const detailLines = [...prepared.detailPrefix, ...result]
    const maxSummaryLines = Math.max(0, Math.floor(this.maxSummaryLines))
    const presented: PresentedTool = {
      kind: prepared.kind,
      title: prepared.title,
      summaryLines: truncateSummary(result.slice(0, maxSummaryLines), result.length),
      detailLines,
    }
    this.detailCache.set(entry, presented)
    return presented
  }

  presentSummary(entry: ToolTranscriptEntry): PresentedTool {
    const cached = this.summaryCache.get(entry)
    if (cached !== undefined) return cached
    const prepared = this.prepare(entry)
    const maxSummaryLines = Math.max(0, Math.floor(this.maxSummaryLines))
    const result = summarizeResultLines(prepared.resultView, prepared.fallback, maxSummaryLines)
    const presented: PresentedTool = {
      kind: prepared.kind,
      title: prepared.title,
      summaryLines: truncateSummary(result.lines, result.count),
      detailLines: [],
    }
    this.summaryCache.set(entry, presented)
    return presented
  }

  private prepare(entry: ToolTranscriptEntry): PreparedToolPresentation {
    const cached = this.prepared.get(entry)
    if (cached !== undefined) return cached
    const args = parseArguments(entry.arguments)
    const tool = this.tools?.get(entry.name)
    let callView: ToolCallView | undefined
    let resultView: ToolResultView | undefined
    try {
      callView = tool?.presentCall?.(args)
    } catch (error) {
      callView = { card: 'generic', title: entry.name, rawInput: stringify(error) }
    }
    if (entry.result !== undefined) {
      const content: ContentBlock[] = [{ type: 'text', text: entry.result }]
      const base: ToolResult = {
        content,
        isError: entry.status === 'error',
        ...(isValidatedJsonValue(entry.resultMeta) ? { meta: entry.resultMeta } : {}),
      }
      try {
        resultView = tool?.presentResult?.(args, base)
      } catch (error) {
        resultView = { card: 'generic', content: [{ type: 'text', text: stringify(error) }] }
      }
    }

    const title = resultView?.title ?? callView?.title ?? entry.name
    const fallback = entry.result ?? stringify(args)
    const prepared: PreparedToolPresentation = {
      kind: resultView?.card === 'read' || resultView?.card === 'search' || resultView?.card === 'web'
        ? resultView.card
        : resultView?.card === 'terminal' || resultView?.card === 'diff'
          ? resultView.card
          : kindFromCall(callView),
      title,
      fallback,
      resultView,
      detailPrefix: [
        `Tool: ${entry.name}`,
        `Call ID: ${entry.callId}`,
        '',
        'Arguments:',
        stringify(args),
        '',
        'Result:',
      ],
    }
    this.prepared.set(entry, prepared)
    return prepared
  }
}
