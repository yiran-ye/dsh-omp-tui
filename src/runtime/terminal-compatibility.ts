import type { Terminal } from '@earendil-works/pi-tui'

const ESCAPE = '\u001b'
const BELL = '\u0007'
const STRING_TERMINATOR = `${ESCAPE}\\`
const PROGRESS_KEEPALIVE_MS = 1_000

function startsBellTerminatedControlSequence(data: string, index: number): boolean {
  if (data[index] !== ESCAPE) return false
  const kind = data[index + 1]
  return kind === ']' || kind === '_'
}

/**
 * OSC and APC accept either BEL or ST as their terminator. Some terminal hosts
 * surface BEL as a notification even when it terminates a control sequence, so
 * prefer the equivalent ST form without touching standalone audible bells.
 */
export function normalizeTerminalStringTerminators(data: string): string {
  let copyFrom = 0
  let searchFrom = 0
  let output = ''
  let changed = false

  while (searchFrom < data.length - 1) {
    let start = searchFrom
    while (start < data.length - 1 && !startsBellTerminatedControlSequence(data, start)) start += 1
    if (start >= data.length - 1) break

    let cursor = start + 2
    let terminated = false
    while (cursor < data.length) {
      if (data[cursor] === BELL) {
        output += `${data.slice(copyFrom, cursor)}${STRING_TERMINATOR}`
        copyFrom = cursor + 1
        searchFrom = cursor + 1
        changed = true
        terminated = true
        break
      }
      if (data[cursor] === ESCAPE && data[cursor + 1] === '\\') {
        searchFrom = cursor + 2
        terminated = true
        break
      }
      cursor += 1
    }
    if (!terminated) break
  }

  return changed ? `${output}${data.slice(copyFrom)}` : data
}

/** Terminal adapter that emits string-terminated OSC/APC sequences. */
export class CompatibleTerminal implements Terminal {
  private progressTimer: ReturnType<typeof setInterval> | undefined

  constructor(private readonly terminal: Terminal) {}

  get columns(): number {
    return this.terminal.columns
  }

  get rows(): number {
    return this.terminal.rows
  }

  get kittyProtocolActive(): boolean {
    return this.terminal.kittyProtocolActive
  }

  start(onInput: (data: string) => void, onResize: () => void): void {
    this.terminal.start(onInput, onResize)
  }

  stop(): void {
    if (this.progressTimer !== undefined) this.setProgress(false)
    this.terminal.stop()
  }

  async drainInput(maxMs?: number, idleMs?: number): Promise<void> {
    await this.terminal.drainInput(maxMs, idleMs)
  }

  write(data: string): void {
    this.terminal.write(normalizeTerminalStringTerminators(data))
  }

  moveBy(lines: number): void {
    this.terminal.moveBy(lines)
  }

  hideCursor(): void {
    this.terminal.hideCursor()
  }

  showCursor(): void {
    this.terminal.showCursor()
  }

  clearLine(): void {
    this.terminal.clearLine()
  }

  clearFromCursor(): void {
    this.terminal.clearFromCursor()
  }

  clearScreen(): void {
    this.terminal.clearScreen()
  }

  setTitle(title: string): void {
    this.write(`${ESCAPE}]0;${title}${STRING_TERMINATOR}`)
  }

  setProgress(active: boolean): void {
    this.clearProgressTimer()
    const sequence = `${ESCAPE}]9;4;${active ? '3' : '0'}${STRING_TERMINATOR}`
    this.write(sequence)
    if (!active) return
    this.progressTimer = setInterval(() => this.write(sequence), PROGRESS_KEEPALIVE_MS)
    this.progressTimer.unref()
  }

  private clearProgressTimer(): void {
    if (this.progressTimer === undefined) return
    clearInterval(this.progressTimer)
    this.progressTimer = undefined
  }
}
