import { visibleWidth, type Component } from '@earendil-works/pi-tui'
import type { TuiSnapshot } from '../state.js'
import { theme } from '../theme.js'
import { fitLine } from './common.js'

export class StatusLine implements Component {
  constructor(private readonly snapshot: TuiSnapshot) {}

  invalidate(): void {}

  render(width: number): string[] {
    const safeWidth = Math.max(1, width)
    return [fitLine(this.renderContent(safeWidth), safeWidth)]
  }

  renderContent(width: number): string {
    const safeWidth = Math.max(1, width)
    const status = this.snapshot.status === 'running'
      ? theme.warning('● 工作中')
      : theme.success('● 就绪')
    const modelName = [this.snapshot.provider, this.snapshot.model].filter(Boolean).join('/')
    const model = modelName.length === 0 ? undefined : `${theme.accent('◆')} ${theme.muted(modelName)}`
    const presetName = this.snapshot.harness.agentPreset
    const preset = presetName === undefined ? undefined : `${theme.accent('⌘')} ${theme.muted(presetName)}`
    const permissionName = this.snapshot.harness.permissionPreset
      ?? this.snapshot.harness.sandboxMode
      ?? this.snapshot.harness.approvalPolicy
    const permission = permissionName === undefined
      ? undefined
      : `${theme.accent('⛨')} ${theme.muted(permissionName)}`
    const queue = this.snapshot.inboxCount === 0
      ? undefined
      : `${theme.accent('≡')} ${theme.muted(`队列 ${this.snapshot.inboxCount}`)}`
    const candidates = [
      [preset, model, permission, queue, status],
      [model, permission, queue, status],
      [model, queue, status],
      [model, status],
      [status],
    ]
    const separator = theme.borderMuted(' › ')
    const selected = candidates
      .map((parts) => parts.filter((part): part is string => part !== undefined))
      .find((parts) => visibleWidth(parts.join(separator)) <= safeWidth)
      ?? [status]
    return fitLine(selected.join(separator), safeWidth)
  }
}
