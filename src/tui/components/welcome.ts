import { visibleWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui'
import { APP_NAME, APP_VERSION } from '../../app-meta.js'
import type { RecentSessionSummary, TuiSnapshot } from '../state.js'
import { theme } from '../theme.js'
import { fitLine, padLine } from './common.js'

const MAX_BOX_WIDTH = 100
const DUAL_COLUMN_THRESHOLD = 62

const DSH_LOGO = [
  '█████   █████  ██  ██',
  '██  ██  ██     ██  ██',
  '██  ██  ████   ██████',
  '██  ██     ██  ██  ██',
  '█████   █████  ██  ██',
] as const

const TIPS = [
  ['/  ', '查看命令'],
  ['↑/↓ ', '浏览输入历史'],
  ['Ctrl+O ', '查看工具详情'],
  ['Ctrl+C ', '取消或退出'],
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

function recentLine(item: RecentSessionSummary, width: number): string {
  const time = theme.dim(item.timeAgo)
  const timeWidth = visibleWidth(time)
  if (width <= timeWidth + 4) return fitLine(`• ${item.label}`, width)
  const labelWidth = width - timeWidth - 3
  const label = fitLine(item.label, labelWidth)
  return `• ${label}${' '.repeat(Math.max(1, labelWidth - visibleWidth(label) + 1))}${time}`
}

function recentLines(snapshot: TuiSnapshot, width: number): string[] {
  const state = snapshot.recentSessions
  if (state.status === 'loading') return [theme.warning('⟳ 正在读取…')]
  if (state.status === 'unavailable') return [theme.dim('当前环境不支持会话历史')]
  if (state.status === 'error') return [theme.error('暂时无法读取会话历史')]
  if (state.items.length === 0) return [theme.dim('当前工作区暂无其他会话')]
  return state.items.slice(0, 4).map((item) => recentLine(item, width))
}

function renderTip(width: number): string[] {
  if (width < 16) return []
  return wrapTextWithAnsi(
    `${theme.bold('提示：')}${theme.italic(theme.muted('输入 /help 查看完整命令和快捷键。'))}`,
    width,
  ).map((line) => fitLine(line, width))
}

/** OMP 风格的静态欢迎页，保留 DSH / DeepSeek 品牌。 */
export class Welcome {
  constructor(private readonly snapshot: TuiSnapshot) {}

  render(width: number): string[] {
    const safeWidth = Math.max(1, width)
    if (safeWidth < 6) return [fitLine(`${APP_NAME} v${APP_VERSION}`, safeWidth)]

    const boxWidth = Math.min(MAX_BOX_WIDTH, safeWidth - 2)
    const margin = ' '.repeat(Math.max(0, Math.floor((safeWidth - boxWidth) / 2)))
    const innerWidth = boxWidth - 2
    const showDualColumn = innerWidth >= DUAL_COLUMN_THRESHOLD
    const leftWidth = showDualColumn ? Math.min(30, Math.floor((innerWidth - 1) * 0.4)) : innerWidth
    const rightWidth = showDualColumn ? innerWidth - leftWidth - 1 : 0
    const identity = [this.snapshot.provider, this.snapshot.model].filter(Boolean).join(' / ')
    const leftLines = [
      '',
      center(theme.bold('欢迎回来！'), leftWidth),
      '',
      ...DSH_LOGO.map((line) => center(theme.gradient(line), leftWidth)),
      '',
      ...(identity.length === 0 ? [] : [center(theme.muted(identity), leftWidth)]),
      '',
    ]
    const rightContentWidth = Math.max(1, (showDualColumn ? rightWidth : innerWidth) - 2)
    const rightLines = [
      ` ${theme.bold(theme.accent('快捷提示'))}`,
      ...TIPS.map(([key, description]) => ` ${theme.accent(key)}${theme.muted(description)}`),
      ` ${theme.borderMuted('─'.repeat(rightContentWidth))}`,
      ` ${theme.bold(theme.accent('最近会话'))}`,
      ...recentLines(this.snapshot, rightContentWidth).map((line) => ` ${line}`),
      '',
    ]
    const border = theme.border
    const lines = [framedTop(innerWidth)]
    if (showDualColumn) {
      const rowCount = Math.max(leftLines.length, rightLines.length)
      for (let index = 0; index < rowCount; index++) {
        lines.push(
          `${border('│')}${padLine(leftLines[index] ?? '', leftWidth)}${border('│')}`
          + `${padLine(rightLines[index] ?? '', rightWidth)}${border('│')}`,
        )
      }
      lines.push(`${border('╰')}${border('─'.repeat(leftWidth))}${border('┴')}${border('─'.repeat(rightWidth))}${border('╯')}`)
    } else {
      for (const line of [...leftLines, ...rightLines]) {
        lines.push(`${border('│')}${padLine(line, innerWidth)}${border('│')}`)
      }
      lines.push(`${border('╰')}${border('─'.repeat(innerWidth))}${border('╯')}`)
    }
    lines.push(...renderTip(boxWidth))
    return lines.map((line) => fitLine(`${margin}${line}`, safeWidth))
  }
}
