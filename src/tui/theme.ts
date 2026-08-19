import {
  getCapabilities,
  type EditorTheme,
  type MarkdownTheme,
  type SelectListTheme,
} from '@earendil-works/pi-tui'

export type ColorMode = 'truecolor' | 'ansi256' | 'ansi16'

type Rgb = readonly [red: number, green: number, blue: number]
type Paint = (text: string) => string

const COLORS = {
  accent: [254, 188, 56],
  text: [230, 230, 230],
  muted: [119, 125, 136],
  dim: [95, 102, 115],
  thinking: [145, 150, 160],
  success: [137, 210, 129],
  warning: [228, 192, 15],
  error: [252, 58, 75],
  border: [23, 143, 185],
  borderAccent: [0, 136, 250],
  borderMuted: [61, 66, 74],
  assistant: [119, 191, 255],
  code: [229, 193, 255],
  codeBlock: [156, 220, 254],
  customLabel: [178, 129, 214],
  diffAdded: [137, 210, 129],
  diffRemoved: [252, 98, 109],
  selectedBg: [49, 54, 63],
  userBg: [34, 29, 26],
  toolPendingBg: [29, 33, 41],
  toolSuccessBg: [22, 26, 31],
  toolErrorBg: [41, 29, 29],
  customBg: [42, 37, 48],
} as const satisfies Record<string, Rgb>

type ColorName = keyof typeof COLORS

const ANSI16_FOREGROUND: Record<ColorName, number> = {
  accent: 93,
  text: 97,
  muted: 90,
  dim: 90,
  thinking: 90,
  success: 92,
  warning: 93,
  error: 91,
  border: 36,
  borderAccent: 96,
  borderMuted: 90,
  assistant: 94,
  code: 95,
  codeBlock: 96,
  customLabel: 95,
  diffAdded: 92,
  diffRemoved: 91,
  selectedBg: 97,
  userBg: 97,
  toolPendingBg: 97,
  toolSuccessBg: 97,
  toolErrorBg: 97,
  customBg: 97,
}

const ANSI16_BACKGROUND: Partial<Record<ColorName, number>> = {
  selectedBg: 100,
  userBg: 40,
  toolPendingBg: 100,
  toolSuccessBg: 40,
  toolErrorBg: 41,
  customBg: 45,
}

const GRADIENT_START: Rgb = [255, 94, 168]
const GRADIENT: readonly Rgb[] = [
  GRADIENT_START,
  [205, 115, 255],
  [142, 158, 255],
  [73, 202, 255],
  [100, 234, 190],
]
const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function sgr(open: string | number, close: string | number): Paint {
  return (text) => `\u001b[${open}m${text}\u001b[${close}m`
}

function backgroundSgr(open: string | number): Paint {
  const prefix = `\u001b[${open}m`
  const reset = '\u001b[49m'
  return (text) => `${prefix}${text.replaceAll(reset, `${reset}${prefix}`)}${reset}`
}

function rgbToAnsi256([red, green, blue]: Rgb): number {
  if (red === green && green === blue) {
    if (red < 8) return 16
    if (red > 248) return 231
    return Math.round(((red - 8) / 247) * 24) + 232
  }
  const r = Math.round((red / 255) * 5)
  const g = Math.round((green / 255) * 5)
  const b = Math.round((blue / 255) * 5)
  return 16 + (36 * r) + (6 * g) + b
}

function colorPaint(mode: ColorMode, name: ColorName, background = false): Paint {
  if (mode === 'truecolor') {
    const [red, green, blue] = COLORS[name]
    const open = `${background ? 48 : 38};2;${red};${green};${blue}`
    return background ? backgroundSgr(open) : sgr(open, 39)
  }
  if (mode === 'ansi256') {
    const open = `${background ? 48 : 38};5;${rgbToAnsi256(COLORS[name])}`
    return background ? backgroundSgr(open) : sgr(open, 39)
  }
  const code = background ? (ANSI16_BACKGROUND[name] ?? 40) : ANSI16_FOREGROUND[name]
  return background ? backgroundSgr(code) : sgr(code, 39)
}

function rgbPaint(mode: ColorMode, rgb: Rgb, fallbackIndex: number): Paint {
  if (mode === 'truecolor') {
    return sgr(`38;2;${rgb[0]};${rgb[1]};${rgb[2]}`, 39)
  }
  if (mode === 'ansi256') return sgr(`38;5;${rgbToAnsi256(rgb)}`, 39)
  return sgr([95, 95, 94, 96, 92][fallbackIndex % 5] ?? 96, 39)
}

export function resolveColorMode(
  trueColor = getCapabilities().trueColor,
  term = process.env.TERM ?? '',
): ColorMode {
  if (trueColor) return 'truecolor'
  return /(?:256color|direct)/i.test(term) ? 'ansi256' : 'ansi16'
}

export function createTheme(mode: ColorMode) {
  const foreground = (name: ColorName): Paint => colorPaint(mode, name)
  const background = (name: ColorName): Paint => colorPaint(mode, name, true)
  return {
    mode,
    accent: foreground('accent'),
    text: foreground('text'),
    assistant: foreground('assistant'),
    dim: foreground('dim'),
    muted: foreground('muted'),
    thinking: foreground('thinking'),
    success: foreground('success'),
    warning: foreground('warning'),
    error: foreground('error'),
    border: foreground('border'),
    borderAccent: foreground('borderAccent'),
    borderMuted: foreground('borderMuted'),
    customLabel: foreground('customLabel'),
    code: foreground('code'),
    codeBlock: foreground('codeBlock'),
    diffAdded: foreground('diffAdded'),
    diffRemoved: foreground('diffRemoved'),
    selectedBg: background('selectedBg'),
    userBg: background('userBg'),
    toolPendingBg: background('toolPendingBg'),
    toolSuccessBg: background('toolSuccessBg'),
    toolErrorBg: background('toolErrorBg'),
    customBg: background('customBg'),
    bold: sgr(1, 22),
    italic: sgr(3, 23),
    strikethrough: sgr(9, 29),
    underline: sgr(4, 24),
    inverse: sgr(7, 27),
    gradient(text: string): string {
      const characters = Array.from(GRAPHEME_SEGMENTER.segment(text), ({ segment }) => segment)
      const colored = Math.max(1, characters.filter((character) => character !== ' ').length - 1)
      let position = 0
      return characters.map((character) => {
        if (character === ' ') return character
        const scaled = (position / colored) * (GRADIENT.length - 1)
        const lower = Math.floor(scaled)
        const upper = Math.min(GRADIENT.length - 1, Math.ceil(scaled))
        const mix = scaled - lower
        const start = GRADIENT[lower] ?? GRADIENT_START
        const end = GRADIENT[upper] ?? start
        const rgb: Rgb = [
          Math.round(start[0] + ((end[0] - start[0]) * mix)),
          Math.round(start[1] + ((end[1] - start[1]) * mix)),
          Math.round(start[2] + ((end[2] - start[2]) * mix)),
        ]
        position += 1
        return rgbPaint(mode, rgb, Math.round(scaled))(character)
      }).join('')
    },
  }
}

export const theme = createTheme(resolveColorMode())

export const selectListTheme: SelectListTheme = {
  selectedPrefix: theme.accent,
  selectedText: (text) => theme.selectedBg(theme.accent(text)),
  description: theme.muted,
  scrollInfo: theme.dim,
  noMatch: theme.warning,
}

export const editorTheme: EditorTheme = {
  borderColor: theme.borderAccent,
  selectList: selectListTheme,
}

export const markdownTheme: MarkdownTheme = {
  heading: (text) => theme.bold(theme.accent(text)),
  link: theme.accent,
  linkUrl: theme.dim,
  code: theme.code,
  codeBlock: theme.codeBlock,
  codeBlockBorder: theme.borderMuted,
  quote: theme.muted,
  quoteBorder: theme.border,
  hr: theme.borderMuted,
  listBullet: theme.accent,
  bold: theme.bold,
  italic: theme.italic,
  strikethrough: theme.strikethrough,
  underline: theme.underline,
  codeBlockIndent: '  ',
}
