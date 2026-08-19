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

export function paintBackground(
  lines: readonly string[],
  width: number,
  background: (text: string) => string,
  paddingX = 1,
  paddingY = 0,
): string[] {
  const safeWidth = Math.max(1, width)
  const horizontal = Math.min(Math.max(0, paddingX), Math.floor((safeWidth - 1) / 2))
  const innerWidth = Math.max(1, safeWidth - (horizontal * 2))
  const side = ' '.repeat(horizontal)
  const blank = background(' '.repeat(safeWidth))
  return [
    ...Array.from({ length: Math.max(0, paddingY) }, () => blank),
    ...lines.map((line) => background(`${side}${padLine(line, innerWidth)}${side}`)),
    ...Array.from({ length: Math.max(0, paddingY) }, () => blank),
  ]
}
