import { VStack, type Component, type TUI } from '@earendil-works/pi-tui'
import type { ToolPresenter } from '../../runtime/tool-presentation.js'
import type { TuiStore } from '../store.js'
import type { TranscriptEntry, TuiSnapshot } from '../state.js'
import { theme } from '../theme.js'
import { paintBackground, wrapPlain } from './common.js'
import { PromptEditor } from './prompt-editor.js'
import { Transcript } from './transcript.js'
import { TranscriptScrollView } from './transcript-scroll-view.js'
import { Welcome } from './welcome.js'
import { hasVisibleAssistantStream, resolveWorkingActivity, WorkingStatus } from './working-status.js'

interface CachedStaticBody {
  readonly transcript: readonly TranscriptEntry[]
  readonly reasoningVisible: boolean
  readonly provider: string | undefined
  readonly model: string | undefined
  readonly mcpServers: TuiSnapshot['mcpServers']
  readonly recentSessions: TuiSnapshot['recentSessions']
  readonly notice: string | undefined
  readonly lifecycle: TuiSnapshot['lifecycle']
  readonly width: number
  readonly lines: string[]
}

interface CachedBody {
  readonly staticBody: readonly string[]
  readonly activity: readonly string[]
  readonly lines: string[]
}

interface CachedRender {
  readonly body: readonly string[]
  readonly prompt: readonly string[]
  readonly lines: string[]
}

export class App extends VStack {
  readonly prompt: PromptEditor
  private snapshot: TuiSnapshot
  private promptSnapshot: TuiSnapshot
  private readonly transcript: Transcript
  private readonly workingStatus: WorkingStatus
  private readonly body: Component
  private staticBodyCache: CachedStaticBody | undefined
  private bodyCache: CachedBody | undefined
  private renderCache: CachedRender | undefined
  private followingOutput = true
  private pendingSnapshot: TuiSnapshot | undefined
  private readonly unsubscribe: () => void

  constructor(
    private readonly tui: TUI,
    store: TuiStore,
    private readonly tools: ToolPresenter,
    onSubmit: (text: string) => void,
  ) {
    super()
    this.snapshot = store.getSnapshot()
    this.promptSnapshot = this.snapshot
    this.transcript = new Transcript(this.snapshot, this.tools)
    this.workingStatus = new WorkingStatus(tui)
    this.syncWorkingStatus(this.snapshot)
    this.prompt = new PromptEditor(tui, onSubmit, this.snapshot)
    this.body = {
      invalidate: () => {
        this.staticBodyCache = undefined
        this.bodyCache = undefined
        this.renderCache = undefined
        this.transcript.invalidate()
      },
      render: (width) => this.renderBody(width),
    }
    const scrollView = new TranscriptScrollView(this.body, {
      follow: 'end',
      primary: true,
      // Overlay the thumb only while scrolling. Reserving a permanent scrollbar
      // column forces pi-tui to ANSI-composite every visible transcript row on
      // every wheel frame, which is noticeably slower for long conversations.
      scrollbar: 'auto',
      scrollbarStyle: () => theme.accent('▐'),
    }, (following) => this.setFollowingOutput(following))
    this.addChild(scrollView, { basis: 1, grow: 1, shrink: 1, minSize: 1 })
    this.addChild(this.prompt, { basis: 'auto', shrink: 1, minSize: 3 })
    this.unsubscribe = store.subscribe((snapshot) => this.receiveSnapshot(snapshot))
  }

  dispose(): void {
    this.unsubscribe()
    this.workingStatus.dispose()
  }

  setFollowingOutput(following: boolean): void {
    if (this.followingOutput === following) return
    this.followingOutput = following
    if (!following || this.pendingSnapshot === undefined) return
    const snapshot = this.pendingSnapshot
    this.pendingSnapshot = undefined
    this.applySnapshot(snapshot)
  }

  override render(width: number): string[] {
    const safeWidth = Math.max(1, width)
    const body = this.renderBody(safeWidth)
    const prompt = this.prompt.render(safeWidth)
    if (this.renderCache?.body === body && sameLines(this.renderCache.prompt, prompt)) {
      return this.renderCache.lines
    }
    const lines = [...body, ...prompt]
    this.renderCache = { body, prompt, lines }
    return lines
  }

  private renderBody(width: number): string[] {
    const staticBody = this.renderStaticBody(width)
    const activity = this.workingStatus.render(width)
    if (activity.length === 0) return staticBody
    if (this.bodyCache?.staticBody === staticBody && sameLines(this.bodyCache.activity, activity)) {
      return this.bodyCache.lines
    }
    const lines = [...staticBody, ...activity, '']
    this.bodyCache = { staticBody, activity, lines }
    return lines
  }

  private renderStaticBody(width: number): string[] {
    const safeWidth = Math.max(1, width)
    if (sameStaticBody(this.staticBodyCache, this.snapshot, safeWidth)) return this.staticBodyCache.lines
    const lines = new Welcome(this.snapshot).render(safeWidth)
    const transcript = this.transcript.render(safeWidth)
    if (transcript.length > 0) {
      if (lines.length > 0) lines.push('')
      lines.push(...transcript)
    }
    if (this.snapshot.notice !== undefined) {
      if (lines.length > 0) lines.push('')
      lines.push(...paintBackground(
        wrapPlain(this.snapshot.notice, Math.max(1, safeWidth - 4)).map((line) => theme.warning(`◆ ${line}`)),
        safeWidth,
        theme.customBg,
      ))
    }
    if (this.snapshot.lifecycle === 'closing') {
      if (lines.length > 0) lines.push('')
      lines.push(theme.dim('正在关闭会话…'))
    }
    if (lines.length > 0) lines.push('')
    this.staticBodyCache = {
      transcript: this.snapshot.transcript,
      reasoningVisible: this.snapshot.reasoningVisible,
      provider: this.snapshot.provider,
      model: this.snapshot.model,
      mcpServers: this.snapshot.mcpServers,
      recentSessions: this.snapshot.recentSessions,
      notice: this.snapshot.notice,
      lifecycle: this.snapshot.lifecycle,
      width: safeWidth,
      lines,
    }
    return lines
  }

  private receiveSnapshot(snapshot: TuiSnapshot): void {
    const promptChanged = this.updatePromptSnapshot(snapshot)
    if (!this.followingOutput && snapshot.lifecycle !== 'closing' && snapshot.sessionId === this.snapshot.sessionId) {
      this.pendingSnapshot = snapshot
      if (promptChanged) this.tui.requestRender()
      return
    }
    this.applySnapshot(snapshot)
  }

  private applySnapshot(snapshot: TuiSnapshot): void {
    this.pendingSnapshot = undefined
    this.snapshot = snapshot
    this.transcript.setSnapshot(snapshot)
    this.updatePromptSnapshot(snapshot)
    this.syncWorkingStatus(snapshot)
    this.renderCache = undefined
    this.tui.requestRender()
  }

  private updatePromptSnapshot(snapshot: TuiSnapshot): boolean {
    if (samePromptState(this.promptSnapshot, snapshot)) return false
    this.promptSnapshot = snapshot
    this.prompt.setSnapshot(snapshot)
    this.renderCache = undefined
    return true
  }

  private syncWorkingStatus(snapshot: TuiSnapshot): void {
    this.workingStatus.setActivity(
      hasVisibleAssistantStream(snapshot) ? undefined : resolveWorkingActivity(snapshot, this.tools),
    )
  }
}

function sameStaticBody(cache: CachedStaticBody | undefined, snapshot: TuiSnapshot, width: number): cache is CachedStaticBody {
  return cache?.transcript === snapshot.transcript
    && cache.reasoningVisible === snapshot.reasoningVisible
    && cache.provider === snapshot.provider
    && cache.model === snapshot.model
    && cache.mcpServers === snapshot.mcpServers
    && cache.recentSessions === snapshot.recentSessions
    && cache.notice === snapshot.notice
    && cache.lifecycle === snapshot.lifecycle
    && cache.width === width
}

function samePromptState(left: TuiSnapshot, right: TuiSnapshot): boolean {
  return left.statusLine === right.statusLine
    && left.harness === right.harness
    && left.model === right.model
}

function sameLines(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((line, index) => line === right[index])
}
