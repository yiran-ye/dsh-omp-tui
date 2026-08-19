import type { Component } from '@earendil-works/pi-tui'
import type { TuiSnapshot } from '../state.js'
import { theme } from '../theme.js'
import { fitLine } from './common.js'

export class StatusLine implements Component {
  constructor(private readonly snapshot: TuiSnapshot) {}

  invalidate(): void {}

  render(width: number): string[] {
    const safeWidth = Math.max(1, width)
    const mode = this.snapshot.harness.agentPreset ?? 'code'
    const model = [this.snapshot.provider, this.snapshot.model].filter(Boolean).join('/') || 'provider/model'
    const sandbox = this.snapshot.harness.permissionPreset ?? this.snapshot.harness.sandboxMode ?? 'default'
    const queued = this.snapshot.inboxCount > 0 ? `q:${this.snapshot.inboxCount}` : ''
    const status = this.snapshot.status === 'running' ? theme.warning('running') : theme.success('ready')
    const candidates = [
      [mode, model, sandbox, queued, 'ctx --', status],
      [mode, model, queued, status],
      [model, status],
      [status],
    ]
    const selected = candidates.find((parts) => parts.filter(Boolean).join('  ').length <= safeWidth) ?? [status]
    return [fitLine(selected.filter(Boolean).join('  '), safeWidth)]
  }
}
