export interface TerminalStreams {
  readonly stdin: {
    readonly isTTY?: boolean
    setRawMode?(mode: boolean): unknown
  }
  readonly stdout: {
    readonly isTTY?: boolean
    write(chunk: string): unknown
  }
}

export interface InteractiveInput {
  readonly isTTY?: boolean
}

export interface InteractiveOutput {
  readonly isTTY?: boolean
}

const RESTORE_SEQUENCE = '\u001b[?2026l\u001b[?2004l\u001b[<u\u001b[?25h'

export class TerminalRestore {
  private restored = false

  constructor(
    private readonly stopTui: () => void,
    private readonly streams: TerminalStreams = { stdin: process.stdin, stdout: process.stdout },
  ) {}

  restore(): void {
    if (this.restored) return
    this.restored = true
    const errors: unknown[] = []
    try {
      this.stopTui()
    } catch (error) {
      errors.push(error)
    }
    if (this.streams.stdin.isTTY && this.streams.stdin.setRawMode !== undefined) {
      try {
        this.streams.stdin.setRawMode(false)
      } catch (error) {
        errors.push(error)
      }
    }
    try {
      this.streams.stdout.write(RESTORE_SEQUENCE)
    } catch (error) {
      errors.push(error)
    }
    if (errors.length > 0) {
      try {
        this.streams.stdout.write(`\n终端恢复遇到 ${errors.length} 个非致命错误。\n`)
      } catch (error) {
        process.exitCode = error instanceof Error ? 1 : process.exitCode
      }
    }
  }
}

export interface ProcessSafetyHooks {
  shutdown(code: number): Promise<void>
  restore(): void
  report(message: string): void
}

const SIGNAL_EXIT_CODES: Readonly<Record<'SIGINT' | 'SIGTERM' | 'SIGHUP', number>> = {
  SIGINT: 130,
  SIGTERM: 143,
  SIGHUP: 129,
}

export class ProcessSafety {
  private installed = false
  private readonly onSigint = (): void => this.handleSignal('SIGINT')
  private readonly onSigterm = (): void => this.handleSignal('SIGTERM')
  private readonly onSighup = (): void => this.handleSignal('SIGHUP')
  private readonly onExit = (): void => this.hooks.restore()
  private readonly onStdinEnd = (): void => this.requestShutdown(0)
  private readonly onUncaughtException = (error: Error): void => {
    this.hooks.report(`未捕获异常：${error.stack ?? error.message}`)
    this.hooks.restore()
    this.requestShutdown(1)
  }
  private readonly onUnhandledRejection = (reason: unknown): void => {
    this.hooks.report(`未处理 Promise rejection：${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`)
    this.hooks.restore()
    this.requestShutdown(1)
  }
  private readonly onStdoutError = (error: Error): void => {
    this.hooks.report(`stdout 已断开：${error.message}`)
    this.hooks.restore()
    this.requestShutdown(1)
  }

  constructor(private readonly hooks: ProcessSafetyHooks) {}

  install(): () => void {
    if (this.installed) return () => this.dispose()
    this.installed = true
    process.once('SIGINT', this.onSigint)
    process.once('SIGTERM', this.onSigterm)
    process.once('SIGHUP', this.onSighup)
    process.once('uncaughtException', this.onUncaughtException)
    process.once('unhandledRejection', this.onUnhandledRejection)
    process.once('exit', this.onExit)
    process.stdin.once('end', this.onStdinEnd)
    process.stdin.once('close', this.onStdinEnd)
    process.stdout.once('error', this.onStdoutError)
    return () => this.dispose()
  }

  dispose(): void {
    if (!this.installed) return
    this.installed = false
    process.off('SIGINT', this.onSigint)
    process.off('SIGTERM', this.onSigterm)
    process.off('SIGHUP', this.onSighup)
    process.off('uncaughtException', this.onUncaughtException)
    process.off('unhandledRejection', this.onUnhandledRejection)
    process.off('exit', this.onExit)
    process.stdin.off('end', this.onStdinEnd)
    process.stdin.off('close', this.onStdinEnd)
    process.stdout.off('error', this.onStdoutError)
  }

  private handleSignal(signal: keyof typeof SIGNAL_EXIT_CODES): void {
    this.hooks.restore()
    this.requestShutdown(SIGNAL_EXIT_CODES[signal])
  }

  private requestShutdown(code: number): void {
    void this.hooks.shutdown(code).catch((error: unknown) => {
      this.hooks.report(`优雅关闭失败：${error instanceof Error ? error.message : String(error)}`)
      this.hooks.restore()
    })
  }
}

export function assertInteractiveTerminal(
  stdin: InteractiveInput = process.stdin,
  stdout: InteractiveOutput = process.stdout,
): void {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error('omp-tui 需要交互式 TTY；管道任务请使用 headless Profile。')
  }
}
