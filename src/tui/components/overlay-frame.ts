import { visibleWidth } from '@earendil-works/pi-tui'
import { theme } from '../theme.js'
import { fitLine, padLine } from './common.js'

export function renderOverlayFrame(title: string, body: readonly string[], width: number): string[] {
  const safeWidth = Math.max(1, width)
  if (safeWidth < 6) return body.map((line) => fitLine(line, safeWidth))
  const innerWidth = safeWidth - 2
  const label = ` ${title} `
  const styledLabel = fitLine(theme.bold(theme.accent(label)), innerWidth)
  const labelWidth = Math.min(innerWidth, visibleWidth(styledLabel))
  return [
    `${theme.border('╭')}${styledLabel}${theme.border('─'.repeat(Math.max(0, innerWidth - labelWidth)))}${theme.border('╮')}`,
    ...body.map((line) => `${theme.border('│')}${theme.customBg(padLine(line, innerWidth))}${theme.border('│')}`),
    theme.border(`╰${'─'.repeat(innerWidth)}╯`),
  ]
}
