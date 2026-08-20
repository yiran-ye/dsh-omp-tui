import { execFile } from 'node:child_process'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import type { LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import type { TuiStore } from '../tui/store.js'
import type { StatusLineState } from '../tui/state.js'

const GIT_QUERY_TIMEOUT_MS = 2_000
const GIT_REFRESH_INTERVAL_MS = 5_000

export interface ModelInfoPort {
  resolveModelInfo(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo>
}

export interface TokenMeterPort {
  measure(session: Session): { readonly totalTokens: number }
}

export interface GitBranchPort {
  resolve(cwd: string, signal: AbortSignal): Promise<string | undefined>
}

export interface StatusLineRuntimeOptions {
  readonly cwd: string
  readonly compactionAvailable: boolean
  readonly llm?: ModelInfoPort
  readonly tokenMeter?: TokenMeterPort
  readonly git?: GitBranchPort
  readonly gitRefreshIntervalMs?: number
}

export interface StatusLineRuntimePort {
  setSession(session: Session, selection: ModelSelection): void
  detachSession(session: Session): void
  setSelection(selection: ModelSelection): void
  syncContext(): void
  dispose(): void
}

function cleanLabel(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const cleaned = Array.from(value, (character) => {
    const code = character.codePointAt(0) ?? 0
    return code <= 0x1f || code === 0x7f ? ' ' : character
  }).join('').trim()
  return cleaned.length === 0 ? undefined : cleaned
}

function finitePositive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : undefined
}

function finiteTokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined
}

function sameStatusLine(left: StatusLineState | undefined, right: StatusLineState): boolean {
  return left?.cwd === right.cwd
    && left?.modelName === right.modelName
    && left?.reasoningEffort === right.reasoningEffort
    && left?.gitBranch === right.gitBranch
    && left?.contextTokens === right.contextTokens
    && left?.contextWindow === right.contextWindow
    && left?.compactionAvailable === right.compactionAvailable
}

function runGit(cwd: string, args: readonly string[], signal: AbortSignal): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      {
        cwd,
        encoding: 'utf8',
        maxBuffer: 1_024,
        signal,
        timeout: GIT_QUERY_TIMEOUT_MS,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error !== null || signal.aborted) {
          resolve(undefined)
          return
        }
        resolve(cleanLabel(stdout))
      },
    )
  })
}

export const defaultGitBranchPort: GitBranchPort = {
  async resolve(cwd, signal) {
    const branch = await runGit(cwd, ['--no-optional-locks', 'symbolic-ref', '--quiet', '--short', 'HEAD'], signal)
    if (branch !== undefined) return branch
    if (signal.aborted) return undefined
    const head = await runGit(cwd, ['--no-optional-locks', 'rev-parse', '--verify', '--quiet', 'HEAD'], signal)
    return head === undefined ? undefined : 'detached'
  },
}

/**
 * Keeps status-line facts out of rendering and keeps all I/O asynchronous.
 * The renderer only reads the immutable TuiSnapshot, so an expensive Git or
 * model-metadata lookup can never block a terminal repaint.
 */
export class StatusLineRuntime implements StatusLineRuntimePort {
  private session: Session | undefined
  private modelName: string | undefined
  private reasoningEffort: string | undefined
  private contextTokens: number | undefined
  private contextWindow: number | undefined
  private gitBranch: string | undefined
  private modelRequest: AbortController | undefined
  private gitRequest: AbortController | undefined
  private modelRevision = 0
  private gitRevision = 0
  private gitTimer: NodeJS.Timeout | undefined
  private published: StatusLineState | undefined
  private disposed = false

  constructor(
    private readonly store: TuiStore,
    private readonly options: StatusLineRuntimeOptions,
  ) {
    this.publish()
    this.refreshGitBranch()
    const intervalMs = Math.max(250, options.gitRefreshIntervalMs ?? GIT_REFRESH_INTERVAL_MS)
    this.gitTimer = setInterval(() => this.refreshGitBranch(), intervalMs)
    this.gitTimer.unref()
  }

  setSession(session: Session, selection: ModelSelection): void {
    this.session = session
    this.setSelection(selection)
    this.syncContext()
  }

  detachSession(session: Session): void {
    if (this.session !== session) return
    this.session = undefined
    this.contextTokens = undefined
    this.publish()
  }

  setSelection(selection: ModelSelection): void {
    if (this.disposed) return
    this.modelName = cleanLabel(selection.model) ?? selection.model
    this.reasoningEffort = cleanLabel(selection.reasoningEffort)
    this.contextWindow = undefined
    this.publish()
    this.resolveModelInfo(selection)
  }

  syncContext(): void {
    if (this.disposed) return
    const session = this.session
    const meter = this.options.tokenMeter
    if (session === undefined || meter === undefined) return
    try {
      this.contextTokens = finiteTokenCount(meter.measure(session).totalTokens)
    } catch {
      this.contextTokens = undefined
    }
    this.publish()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.modelRequest?.abort()
    this.gitRequest?.abort()
    if (this.gitTimer !== undefined) clearInterval(this.gitTimer)
    this.gitTimer = undefined
  }

  private resolveModelInfo(selection: ModelSelection): void {
    this.modelRequest?.abort()
    const llm = this.options.llm
    if (llm === undefined) return
    const request = new AbortController()
    this.modelRequest = request
    const revision = ++this.modelRevision
    void llm.resolveModelInfo(selection.provider, selection.model, request.signal)
      .then((info) => this.applyModelInfo(revision, request, selection, info))
      .catch(() => undefined)
      .finally(() => {
        if (this.modelRequest === request) this.modelRequest = undefined
      })
  }

  private applyModelInfo(
    revision: number,
    request: AbortController,
    selection: ModelSelection,
    info: LlmResolvedModelInfo,
  ): void {
    if (this.disposed || request.signal.aborted || revision !== this.modelRevision) return
    this.modelName = cleanLabel(info.name) ?? cleanLabel(selection.model) ?? selection.model
    this.contextWindow = finitePositive(info.context?.contextWindow)
    const effort = selection.reasoningEffort === undefined
      ? undefined
      : info.reasoning?.efforts.find((candidate) => candidate.id === selection.reasoningEffort)?.name
    this.reasoningEffort = cleanLabel(effort) ?? cleanLabel(selection.reasoningEffort)
    this.publish()
  }

  private refreshGitBranch(): void {
    if (this.disposed) return
    this.gitRequest?.abort()
    const request = new AbortController()
    this.gitRequest = request
    const revision = ++this.gitRevision
    const git = this.options.git ?? defaultGitBranchPort
    void git.resolve(this.options.cwd, request.signal)
      .then((branch) => {
        if (this.disposed || request.signal.aborted || revision !== this.gitRevision) return
        this.gitBranch = cleanLabel(branch)
        this.publish()
      })
      .catch(() => {
        if (this.disposed || request.signal.aborted || revision !== this.gitRevision) return
        this.gitBranch = undefined
        this.publish()
      })
      .finally(() => {
        if (this.gitRequest === request) this.gitRequest = undefined
      })
  }

  private publish(): void {
    const next: StatusLineState = {
      ...(cleanLabel(this.options.cwd) === undefined ? {} : { cwd: this.options.cwd }),
      ...(this.modelName === undefined ? {} : { modelName: this.modelName }),
      ...(this.reasoningEffort === undefined ? {} : { reasoningEffort: this.reasoningEffort }),
      ...(this.gitBranch === undefined ? {} : { gitBranch: this.gitBranch }),
      ...(this.contextTokens === undefined ? {} : { contextTokens: this.contextTokens }),
      ...(this.contextWindow === undefined ? {} : { contextWindow: this.contextWindow }),
      compactionAvailable: this.options.compactionAvailable,
    }
    if (sameStatusLine(this.published, next)) return
    this.published = next
    this.store.setStatusLine(next)
  }
}
