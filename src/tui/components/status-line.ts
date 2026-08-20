import { homedir } from 'node:os'
import { isAbsolute, relative } from 'node:path'
import { visibleWidth, type Component } from '@earendil-works/pi-tui'
import type { StatusLineState, TuiSnapshot } from '../state.js'
import { theme } from '../theme.js'
import { fitLine } from './common.js'

interface RenderOptions {
  readonly abbreviatedPath: boolean
  readonly showPath: boolean
  readonly showReasoningEffort: boolean
  readonly showGit: boolean
  readonly showContext: boolean
  readonly showCompaction: boolean
}

const SEPARATOR = '  '

function compactNumber(value: number): string {
  const units: readonly [number, string][] = [[1_000_000_000, 'B'], [1_000_000, 'M'], [1_000, 'K']]
  for (const [divisor, suffix] of units) {
    if (value < divisor) continue
    const scaled = value / divisor
    const digits = scaled < 10 ? 1 : 0
    return `${scaled.toFixed(digits).replace(/\.0$/, '')}${suffix}`
  }
  return String(Math.round(value))
}

function displayPath(cwd: string): string {
  const home = homedir()
  const fromHome = relative(home, cwd)
  if (fromHome.length === 0) return '~'
  if (!fromHome.startsWith('..') && !isAbsolute(fromHome)) return `~/${fromHome}`
  return cwd
}

function leftTruncate(value: string, width: number): string {
  if (visibleWidth(value) <= width) return value
  if (width <= 1) return '…'
  const suffix: string[] = []
  let suffixWidth = 0
  for (const character of Array.from(value).reverse()) {
    const nextWidth = visibleWidth(character) + suffixWidth
    if (nextWidth > width - 1) break
    suffix.push(character)
    suffixWidth = nextWidth
  }
  return `…${suffix.reverse().join('')}`
}

function abbreviatePath(path: string, width: number): string {
  if (visibleWidth(path) <= width) return path
  const basename = path.split('/').filter(Boolean).at(-1) ?? path
  return leftTruncate(`…/${basename}`, width)
}

function contextText(statusLine: StatusLineState): string {
  const tokens = Math.max(0, statusLine.contextTokens ?? 0)
  const window = statusLine.contextWindow
  if (window === undefined || window <= 0) return `${compactNumber(tokens)}/?`
  return `${((tokens / window) * 100).toFixed(1)}%/${compactNumber(window)}`
}

export class StatusLine implements Component {
  constructor(private readonly snapshot: TuiSnapshot) {}

  invalidate(): void {}

  render(width: number): string[] {
    const safeWidth = Math.max(1, width)
    return [fitLine(this.renderContent(safeWidth), safeWidth)]
  }

  renderContent(width: number): string {
    const safeWidth = Math.max(1, width)
    const statusLine = this.snapshot.statusLine
    const cwd = statusLine.cwd === undefined ? undefined : displayPath(statusLine.cwd)
    const pathWidth = Math.max(8, Math.min(28, Math.floor(safeWidth / 3)))
    const modelOnly: RenderOptions = {
      abbreviatedPath: true,
      showPath: false,
      showReasoningEffort: false,
      showGit: false,
      showContext: false,
      showCompaction: false,
    }
    const candidates: readonly RenderOptions[] = [
      {
        abbreviatedPath: false,
        showPath: true,
        showReasoningEffort: true,
        showGit: true,
        showContext: true,
        showCompaction: true,
      },
      {
        abbreviatedPath: true,
        showPath: true,
        showReasoningEffort: true,
        showGit: true,
        showContext: true,
        showCompaction: true,
      },
      {
        abbreviatedPath: true,
        showPath: true,
        showReasoningEffort: false,
        showGit: true,
        showContext: true,
        showCompaction: true,
      },
      {
        abbreviatedPath: true,
        showPath: true,
        showReasoningEffort: false,
        showGit: false,
        showContext: true,
        showCompaction: true,
      },
      {
        abbreviatedPath: true,
        showPath: false,
        showReasoningEffort: false,
        showGit: false,
        showContext: true,
        showCompaction: true,
      },
      {
        abbreviatedPath: true,
        showPath: false,
        showReasoningEffort: false,
        showGit: false,
        showContext: true,
        showCompaction: false,
      },
      modelOnly,
    ]
    const rendered = candidates
      .map((options) => this.renderSegments(statusLine, cwd, pathWidth, options))
      .find((segments) => visibleWidth(segments.join(SEPARATOR)) <= safeWidth)
      ?? this.renderSegments(statusLine, undefined, pathWidth, modelOnly)
    return fitLine(rendered.join(SEPARATOR), safeWidth)
  }

  private renderSegments(
    statusLine: StatusLineState,
    cwd: string | undefined,
    pathWidth: number,
    options: RenderOptions,
  ): readonly string[] {
    const modelName = statusLine.modelName ?? this.snapshot.model ?? '未知模型'
    const effort = options.showReasoningEffort ? statusLine.reasoningEffort : undefined
    const model = [
      `${theme.accent('')} ${theme.text(modelName)}`,
      ...(effort === undefined ? [] : [`${theme.muted('·')} ${theme.warning(` ${effort}`)}`]),
    ].join(' ')
    const path = !options.showPath || cwd === undefined
      ? undefined
      : `${theme.muted('')} ${theme.muted(options.abbreviatedPath ? abbreviatePath(cwd, pathWidth) : cwd)}`
    const git = !options.showGit || statusLine.gitBranch === undefined
      ? undefined
      : `${theme.success('')} ${theme.success(statusLine.gitBranch)}`
    const context = !options.showContext
      ? undefined
      : [
          `${theme.muted('')} ${theme.muted(contextText(statusLine))}`,
          ...(options.showCompaction && statusLine.compactionAvailable ? [theme.accent('󰁨')] : []),
        ].join(' ')
    return [model, path, git, context].filter((segment): segment is string => segment !== undefined)
  }
}
