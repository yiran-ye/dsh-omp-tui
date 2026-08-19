import { SelectList, type Component } from '@earendil-works/pi-tui'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import type { ApprovalInteraction } from '../../runtime/interaction-queue.js'
import { selectListTheme, theme } from '../theme.js'
import { fitLines, wrapPlain } from './common.js'
import { renderOverlayFrame } from './overlay-frame.js'

export class ApprovalDialog implements Component {
  private readonly choices = new SelectList(
    [
      { value: 'allowed-once', label: 'Allow once', description: '仅允许本次工具调用' },
      { value: 'rejected', label: 'Reject', description: '拒绝本次工具调用' },
    ],
    4,
    selectListTheme,
  )

  constructor(
    private readonly interaction: ApprovalInteraction,
    onAnswer: (outcome: ApprovalOutcome) => void,
  ) {
    this.choices.onSelect = (item) => onAnswer(item.value === 'allowed-once' ? 'allowed-once' : 'rejected')
    this.choices.onCancel = () => onAnswer('cancelled')
  }

  invalidate(): void {
    this.choices.invalidate()
  }

  handleInput(data: string): void {
    this.choices.handleInput(data)
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, width)
    const bodyWidth = Math.max(1, safeWidth - 4)
    const call = this.interaction.callId === undefined ? '' : theme.dim(` · ${this.interaction.callId}`)
    const body = [
      ...wrapPlain(`${theme.warning('●')} ${theme.bold(this.interaction.toolName)}${call}`, bodyWidth),
      ...(this.interaction.reason === undefined ? [] : ['', ...wrapPlain(this.interaction.reason, bodyWidth).map(theme.dim)]),
      '',
      ...this.choices.render(bodyWidth),
      '',
      theme.dim('↑/↓ 选择 · Enter 确认 · Esc 取消'),
    ]
    return fitLines(renderOverlayFrame('Approval', body, safeWidth), safeWidth)
  }
}
