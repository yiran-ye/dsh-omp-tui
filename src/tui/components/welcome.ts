import { visibleWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui'
import { APP_NAME, APP_VERSION } from '../../app-meta.js'
import type { TuiSnapshot } from '../state.js'
import { theme } from '../theme.js'
import { fitLine, padLine } from './common.js'

const MAX_BOX_WIDTH = 100
const MIN_DUAL_LEFT_WIDTH = 20
const MIN_DUAL_RIGHT_WIDTH = 24

const DSH_LOGO = [
  '█████   █████  ██  ██',
  '██  ██  ██     ██  ██',
  '██  ██  ████   ██████',
  '██  ██     ██  ██  ██',
  '█████   █████  ██  ██',
] as const

const TIPS = [
  ['/ ', 'for commands'],
  ['↑/↓ ', 'for input history'],
  ['Ctrl+C ', 'to cancel or exit'],
  ['Ctrl+O ', 'to inspect tools'],
  ['Esc ', 'to close dialogs'],
] as const

function center(line: string, width: number): string {
  const fitted = fitLine(line, width)
  const padding = Math.max(0, width - visibleWidth(fitted))
  const left = Math.floor(padding / 2)
  return `${' '.repeat(left)}${fitted}${' '.repeat(padding - left)}`
}

function framedTop(innerWidth: number): string {
  const prefix = theme.border('─── ')
  const title = theme.muted(`${APP_NAME} v${APP_VERSION} `)
  const content = fitLine(`${prefix}${title}`, innerWidth)
  return `${theme.border('╭')}${content}${theme.border('─'.repeat(Math.max(0, innerWidth - visibleWidth(content))))}${theme.border('╮')}`
}

function renderTip(boxWidth: number): string[] {
  if (boxWidth < 16) return []
  const label = theme.bold('Tip: ')
  const message = theme.muted('Run /help to see all available commands and shortcuts.')
  return wrapTextWithAnsi(`${label}${message}`, boxWidth).map((line) => fitLine(line, boxWidth))
}

/** OMP-inspired welcome header that remains at the top of the session document. */
export class Welcome {
  constructor(private readonly snapshot: TuiSnapshot) {}

  render(width: number): string[] {
    const safeWidth = Math.max(1, width)
    if (safeWidth < 4) return [fitLine(`${APP_NAME} v${APP_VERSION}`, safeWidth)]

    const boxWidth = Math.min(MAX_BOX_WIDTH, safeWidth)
    const innerWidth = boxWidth - 2
    const showDualColumn = innerWidth >= MIN_DUAL_LEFT_WIDTH + MIN_DUAL_RIGHT_WIDTH + 1
    const leftWidth = showDualColumn
      ? Math.min(28, Math.max(MIN_DUAL_LEFT_WIDTH, Math.floor((innerWidth - 1) * 0.35)))
      : innerWidth
    const rightWidth = showDualColumn ? innerWidth - leftWidth - 1 : 0
    const model = this.snapshot.model ?? 'No model selected'
    const provider = this.snapshot.provider ?? 'No provider selected'
    const leftLines = [
      '',
      center(theme.bold('Welcome back!'), leftWidth),
      '',
      ...DSH_LOGO.map((line) => center(theme.accent(line), leftWidth)),
      '',
      center(theme.muted(model), leftWidth),
      center(theme.dim(provider), leftWidth),
      '',
    ]
    const rightLines = [
      ` ${theme.bold(theme.accent('Tips'))}`,
      ...TIPS.map(([key, description]) => ` ${theme.dim(key)}${theme.muted(description)}`),
      ` ${theme.border('─'.repeat(Math.max(0, rightWidth - 2)))}`,
      ` ${theme.dim('Use /help for the complete command list.')}`,
      '',
    ]
    const border = theme.border
    const lines = [framedTop(innerWidth)]
    const rowCount = showDualColumn ? Math.max(leftLines.length, rightLines.length) : leftLines.length
    for (let index = 0; index < rowCount; index++) {
      const left = padLine(leftLines[index] ?? '', leftWidth)
      if (showDualColumn) {
        const right = padLine(rightLines[index] ?? '', rightWidth)
        lines.push(`${border('│')}${left}${border('│')}${right}${border('│')}`)
      } else {
        lines.push(`${border('│')}${left}${border('│')}`)
      }
    }
    if (showDualColumn) {
      lines.push(`${border('╰')}${border('─'.repeat(leftWidth))}${border('┴')}${border('─'.repeat(rightWidth))}${border('╯')}`)
    } else {
      lines.push(`${border('╰')}${border('─'.repeat(leftWidth))}${border('╯')}`)
    }
    lines.push(...renderTip(boxWidth))
    return lines.map((line) => fitLine(line, safeWidth))
  }
}
