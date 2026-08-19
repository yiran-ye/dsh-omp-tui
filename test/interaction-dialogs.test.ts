import { TuiMainScreen, type Terminal, visibleWidth } from '@earendil-works/pi-tui'
import { describe, expect, it, vi } from 'vitest'
import { ApprovalDialog } from '../src/tui/components/approval-dialog.js'
import { QuestionDialog } from '../src/tui/components/question-dialog.js'

class DialogTerminal implements Terminal {
  kittyProtocolActive = false
  columns = 60
  rows = 30
  start(_onInput: (data: string) => void, _onResize: () => void): void {}
  stop(): void {}
  async drainInput(): Promise<void> {}
  write(_data: string): void {}
  moveBy(_lines: number): void {}
  hideCursor(): void {}
  showCursor(): void {}
  clearLine(): void {}
  clearFromCursor(): void {}
  clearScreen(): void {}
  setTitle(_title: string): void {}
  setProgress(_active: boolean): void {}
}

function assertWidth(lines: readonly string[], width: number): void {
  for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width)
}

describe('交互 Overlay', () => {
  it('Approval 支持 Allow once 与有界渲染', () => {
    const answer = vi.fn()
    const dialog = new ApprovalDialog({
      kind: 'approval',
      id: 1,
      toolName: 'bash',
      callId: 'call-1',
      reason: '命令需要工作区写入权限',
    }, answer)
    assertWidth(dialog.render(36), 36)
    dialog.handleInput('\r')
    expect(answer).toHaveBeenCalledWith('allowed-once')
  })

  it('Question 支持单选', () => {
    const tui = new TuiMainScreen(new DialogTerminal(), true)
    const answer = vi.fn()
    const dialog = new QuestionDialog(tui, {
      kind: 'question',
      id: 2,
      questions: [{ id: 'color', question: '选择颜色', options: [{ label: '蓝色' }, { label: '绿色' }] }],
    }, answer)
    assertWidth(dialog.render(40), 40)
    dialog.handleInput('\u001b[B')
    dialog.handleInput('\r')
    expect(answer).toHaveBeenCalledWith({ answers: [{ id: 'color', selected: ['绿色'] }] })
  })

  it('Question 支持多选与确认', () => {
    const tui = new TuiMainScreen(new DialogTerminal(), true)
    const answer = vi.fn()
    const dialog = new QuestionDialog(tui, {
      kind: 'question',
      id: 3,
      questions: [{
        id: 'features',
        question: '选择功能',
        options: [{ label: 'A' }, { label: 'B' }],
        multiSelect: true,
      }],
    }, answer)
    dialog.handleInput(' ')
    dialog.handleInput('\u001b[B')
    dialog.handleInput('\u001b[B')
    dialog.handleInput('\u001b[B')
    dialog.handleInput('\r')
    expect(answer).toHaveBeenCalledWith({ answers: [{ id: 'features', selected: ['A'] }] })
  })

  it('Question 支持自由文本与跳过', () => {
    const tui = new TuiMainScreen(new DialogTerminal(), true)
    const freeAnswer = vi.fn()
    const free = new QuestionDialog(tui, {
      kind: 'question',
      id: 4,
      questions: [{ id: 'name', question: '你的名字？' }],
    }, freeAnswer)
    free.handleInput('小明')
    free.handleInput('\r')
    expect(freeAnswer).toHaveBeenCalledWith({ answers: [{ id: 'name', selected: [], custom: '小明' }] })

    const skippedAnswer = vi.fn()
    const skipped = new QuestionDialog(tui, {
      kind: 'question',
      id: 5,
      questions: [{ id: 'skip', question: '跳过？', options: [{ label: '继续' }] }],
    }, skippedAnswer)
    skipped.handleInput('\u001b')
    expect(skippedAnswer).toHaveBeenCalledWith({ answers: [{ id: 'skip', selected: [] }] })
  })
})
