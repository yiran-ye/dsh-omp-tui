import { Markdown, type Component } from '@earendil-works/pi-tui'
import type { AssistantTranscriptEntry } from '../state.js'
import { markdownTheme, theme } from '../theme.js'
import { fitLine, fitLines, padLine, wrapPlain } from './common.js'
import { ReasoningBlock } from './reasoning-block.js'

interface ProgressiveLinesCache {
  readonly width: number
  readonly source: string
  readonly stableEnd: number
  readonly stableLines: readonly string[]
  readonly lines: string[]
}

interface AssistantRenderCache {
  readonly entry: AssistantTranscriptEntry
  readonly reasoningVisible: boolean
  readonly width: number
  readonly lines: string[]
}

export class AssistantBlock implements Component {
  private reasoningCache: ProgressiveLinesCache | undefined
  private textCache: ProgressiveLinesCache | undefined
  private renderCache: AssistantRenderCache | undefined

  constructor(
    private entry: AssistantTranscriptEntry,
    private reasoningVisible: boolean,
  ) {}

  setEntry(entry: AssistantTranscriptEntry, reasoningVisible: boolean): void {
    if (this.entry === entry && this.reasoningVisible === reasoningVisible) return
    this.entry = entry
    this.reasoningVisible = reasoningVisible
    this.renderCache = undefined
    if (!entry.streaming) {
      this.reasoningCache = undefined
      this.textCache = undefined
    }
  }

  invalidate(): void {
    this.reasoningCache = undefined
    this.textCache = undefined
    this.renderCache = undefined
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, width)
    if (
      this.renderCache?.entry === this.entry
      && this.renderCache.reasoningVisible === this.reasoningVisible
      && this.renderCache.width === safeWidth
    ) {
      return this.renderCache.lines
    }
    const lines: string[] = []
    if (this.entry.reasoning.length > 0 && this.reasoningVisible) {
      if (this.entry.streaming) lines.push(...this.renderStreamingReasoning(safeWidth))
      else lines.push(...new ReasoningBlock(this.entry.reasoning, true).render(safeWidth))
      if (this.entry.text.length > 0) lines.push('')
    }
    if (this.entry.text.length > 0) {
      if (this.entry.streaming) lines.push(...this.renderStreamingText(safeWidth))
      else {
        const markdown = new Markdown(this.entry.text, 1, 0, markdownTheme, { color: theme.text })
        lines.push(...fitLines(markdown.render(safeWidth), safeWidth))
      }
    }
    this.renderCache = {
      entry: this.entry,
      reasoningVisible: this.reasoningVisible,
      width: safeWidth,
      lines,
    }
    return lines
  }

  private renderStreamingReasoning(width: number): string[] {
    const contentWidth = Math.max(1, width - 2)
    this.reasoningCache = renderProgressiveLines(
      this.entry.reasoning,
      contentWidth,
      (line) => fitLine(`  ${theme.italic(theme.thinking(line))}`, width),
      this.reasoningCache,
    )
    return [fitLine(theme.muted('✦ 思考'), width), ...this.reasoningCache.lines]
  }

  private renderStreamingText(width: number): string[] {
    const padding = width >= 3 ? 1 : 0
    const contentWidth = Math.max(1, width - (padding * 2))
    const prefix = ' '.repeat(padding)
    this.textCache = renderProgressiveLines(
      this.entry.text,
      contentWidth,
      (line) => padLine(`${prefix}${theme.text(line)}`, width),
      this.textCache,
    )
    return this.textCache.lines
  }
}

function renderProgressiveLines(
  source: string,
  width: number,
  decorate: (line: string) => string,
  previous: ProgressiveLinesCache | undefined,
): ProgressiveLinesCache {
  if (previous?.source === source && previous.width === width) return previous
  const stableEnd = source.lastIndexOf('\n') + 1
  const appendOnly = previous?.width === width
    && source.startsWith(previous.source)
    && stableEnd >= previous.stableEnd
  const stableStart = appendOnly ? previous.stableEnd : 0
  const stableDelta = source.slice(stableStart, stableEnd)
  const renderedStableDelta = stableDelta.length === 0
    ? []
    : wrapPlain(stableDelta.slice(0, -1), width).map(decorate)
  const stableLines = appendOnly
    ? [...previous.stableLines, ...renderedStableDelta]
    : renderedStableDelta
  const tail = source.slice(stableEnd)
  const tailLines = tail.length === 0 ? [] : wrapPlain(tail, width).map(decorate)
  return {
    width,
    source,
    stableEnd,
    stableLines,
    lines: tailLines.length === 0 ? [...stableLines] : [...stableLines, ...tailLines],
  }
}
