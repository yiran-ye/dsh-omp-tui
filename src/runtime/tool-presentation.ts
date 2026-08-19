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
        ? [`${view.statusCode} ${view.url}${view.truncated ? ' · truncated' : ''}`]
        : [
            ...(view.answer === undefined ? [] : view.answer.split('\n')),
            ...view.sources.map((source) => `${source.title ?? source.url} · ${source.url}`),
          ]
  }
}

export class ToolPresenter {
  constructor(private readonly tools: ToolLookup | undefined, private readonly maxSummaryLines = 8) {}

  present(entry: ToolTranscriptEntry): PresentedTool {
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
    const detailLines = resultLines(resultView, fallback)
    const summaryLines = detailLines.slice(0, this.maxSummaryLines)
    const truncated = detailLines.length - summaryLines.length
    return {
      kind: resultView?.card === 'read' || resultView?.card === 'search' || resultView?.card === 'web'
        ? resultView.card
        : resultView?.card === 'terminal' || resultView?.card === 'diff'
          ? resultView.card
          : kindFromCall(callView),
      title,
      summaryLines: truncated > 0 ? [...summaryLines, `… ${truncated} more lines · Ctrl+O`] : summaryLines,
      detailLines: [
        `Tool: ${entry.name}`,
        `Call ID: ${entry.callId}`,
        '',
        'Arguments:',
        stringify(args),
        '',
        'Result:',
        ...detailLines,
      ],
    }
  }
}
