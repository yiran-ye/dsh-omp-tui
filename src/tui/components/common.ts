import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui'

export function fitLine(line: string, width: number): string {
  if (width <= 0) return ''
  return visibleWidth(line) <= width ? line : truncateToWidth(line, width, '')
}

export function fitLines(lines: readonly string[], width: number): string[] {
  return lines.map((line) => fitLine(line, width))
}

export function padLine(line: string, width: number): string {
  const fitted = fitLine(line, width)
  return `${fitted}${' '.repeat(Math.max(0, width - visibleWidth(fitted)))}`
}

export function indentLines(lines: readonly string[], prefix: string, width: number): string[] {
  const contentWidth = Math.max(1, width - visibleWidth(prefix))
  return lines.map((line) => fitLine(`${prefix}${fitLine(line, contentWidth)}`, width))
}

export function wrapPlain(text: string, width: number): string[] {
  if (width <= 0) return []
  const source = text.length === 0 ? '' : text
  return source.split('\n').flatMap((line) => wrapTextWithAnsi(line, width))
}
