import type { EditorTheme, MarkdownTheme, SelectListTheme } from '@earendil-works/pi-tui'

function ansi(open: number, close: number): (text: string) => string {
  return (text) => `\u001b[${open}m${text}\u001b[${close}m`
}

export const theme = {
  accent: ansi(36, 39),
  assistant: ansi(94, 39),
  dim: ansi(2, 22),
  muted: ansi(90, 39),
  success: ansi(32, 39),
  warning: ansi(33, 39),
  error: ansi(31, 39),
  border: ansi(90, 39),
  bold: ansi(1, 22),
  code: ansi(96, 39),
  inverse: ansi(7, 27),
}

export const selectListTheme: SelectListTheme = {
  selectedPrefix: theme.accent,
  selectedText: theme.inverse,
  description: theme.dim,
  scrollInfo: theme.dim,
  noMatch: theme.warning,
}

export const editorTheme: EditorTheme = {
  borderColor: theme.border,
  selectList: selectListTheme,
}

export const markdownTheme: MarkdownTheme = {
  heading: (text) => theme.bold(theme.accent(text)),
  link: theme.accent,
  linkUrl: theme.dim,
  code: theme.code,
  codeBlock: theme.code,
  codeBlockBorder: theme.border,
  quote: theme.dim,
  quoteBorder: theme.border,
  hr: theme.border,
  listBullet: theme.accent,
  bold: theme.bold,
  italic: ansi(3, 23),
  strikethrough: ansi(9, 29),
  underline: ansi(4, 24),
  codeBlockIndent: '  ',
}
