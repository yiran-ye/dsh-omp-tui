import { Editor, Key, matchesKey, type Component, type TUI } from '@earendil-works/pi-tui'
import type {
  AskUserQuestionAnswer,
  AskUserQuestionAnswerItem,
  AskUserQuestionItem,
} from '@deepseek-ai/dsh-user-questions'
import type { QuestionInteraction } from '../../runtime/interaction-queue.js'
import { editorTheme, theme } from '../theme.js'
import { fitLine, fitLines, padLine, wrapPlain } from './common.js'
import { renderOverlayFrame } from './overlay-frame.js'

type Choice =
  | { readonly kind: 'option'; readonly label: string; readonly description: string | undefined }
  | { readonly kind: 'custom'; readonly label: string }
  | { readonly kind: 'confirm'; readonly label: string }
  | { readonly kind: 'skip'; readonly label: string }

export class QuestionDialog implements Component {
  private readonly editor: Editor
  private readonly answers: AskUserQuestionAnswerItem[] = []
  private readonly selected = new Set<string>()
  private questionIndex = 0
  private cursor = 0
  private customMode = false

  constructor(
    tui: TUI,
    private readonly interaction: QuestionInteraction,
    private readonly onAnswer: (answer: AskUserQuestionAnswer) => void,
  ) {
    this.editor = new Editor(tui, editorTheme, { paddingX: 1 })
    this.editor.onSubmit = (text) => this.answerCurrent({
      id: this.currentQuestion()?.id ?? '',
      selected: [...this.selected],
      ...(text.trim().length === 0 ? {} : { custom: text.trim() }),
    })
    this.prepareQuestion()
  }

  invalidate(): void {
    this.editor.invalidate()
  }

  handleInput(data: string): void {
    if (this.customMode) {
      if (matchesKey(data, Key.escape)) {
        if ((this.currentQuestion()?.options?.length ?? 0) === 0) this.skipRemaining()
        else this.setCustomMode(false)
        return
      }
      this.editor.handleInput(data)
      return
    }

    const choices = this.choices()
    if (matchesKey(data, Key.up)) {
      this.cursor = this.cursor === 0 ? choices.length - 1 : this.cursor - 1
    } else if (matchesKey(data, Key.down)) {
      this.cursor = this.cursor === choices.length - 1 ? 0 : this.cursor + 1
    } else if (matchesKey(data, Key.space)) {
      this.activateChoice(choices[this.cursor], true)
    } else if (matchesKey(data, Key.enter)) {
      this.activateChoice(choices[this.cursor], false)
    } else if (matchesKey(data, Key.escape)) {
      this.skipRemaining()
    }
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, width)
    const bodyWidth = Math.max(1, safeWidth - 4)
    const question = this.currentQuestion()
    if (question === undefined) return renderOverlayFrame('Question', [theme.dim('没有问题。')], safeWidth)
    const progress = `${this.questionIndex + 1}/${this.interaction.questions.length}`
    const title = question.header === undefined ? `Question ${progress}` : `${question.header} · ${progress}`
    const body: string[] = [
      ...wrapPlain(theme.bold(question.question), bodyWidth),
      ...(question.detail === undefined ? [] : ['', ...wrapPlain(question.detail, bodyWidth).map(theme.dim)]),
      '',
    ]
    if (this.customMode) {
      body.push(...this.editor.render(bodyWidth), theme.dim('Enter 提交 · Shift/Alt+Enter 换行 · Esc 返回/跳过'))
    } else {
      const choices = this.choices()
      for (let index = 0; index < choices.length; index++) {
        const choice = choices[index]
        if (choice === undefined) continue
        const cursor = index === this.cursor ? theme.accent('→') : ' '
        const checked = choice.kind === 'option' && this.selected.has(choice.label)
          ? theme.success('[✓]')
          : question.multiSelect === true && choice.kind === 'option'
            ? '[ ]'
            : '   '
        body.push(fitLine(`${cursor} ${checked} ${choice.label}`, bodyWidth))
        if (choice.kind === 'option' && choice.description !== undefined) {
          body.push(fitLine(theme.dim(`      ${choice.description}`), bodyWidth))
        }
      }
      body.push('', theme.dim(question.multiSelect === true
        ? '↑/↓ 选择 · Space 切换 · Enter 确认 · Esc 跳过'
        : '↑/↓ 选择 · Enter 确认 · Esc 跳过'))
    }
    return fitLines(renderOverlayFrame(title, body.map((line) => padLine(line, bodyWidth)), safeWidth), safeWidth)
  }

  private currentQuestion(): AskUserQuestionItem | undefined {
    return this.interaction.questions[this.questionIndex]
  }

  private choices(): Choice[] {
    const question = this.currentQuestion()
    const options: Choice[] = (question?.options ?? []).map((option) => ({
      kind: 'option',
      label: option.label,
      description: option.description,
    }))
    options.push({ kind: 'custom', label: '自由文本…' })
    if (question?.multiSelect === true) options.push({ kind: 'confirm', label: '确认选择' })
    options.push({ kind: 'skip', label: '跳过' })
    return options
  }

  private activateChoice(choice: Choice | undefined, fromSpace: boolean): void {
    if (choice === undefined) return
    const question = this.currentQuestion()
    if (question === undefined) return
    if (choice.kind === 'custom') {
      this.setCustomMode(true)
    } else if (choice.kind === 'skip') {
      this.answerCurrent({ id: question.id, selected: [] })
    } else if (choice.kind === 'confirm') {
      this.answerCurrent({ id: question.id, selected: [...this.selected] })
    } else if (question.multiSelect === true) {
      if (this.selected.has(choice.label)) this.selected.delete(choice.label)
      else this.selected.add(choice.label)
      if (!fromSpace) return
    } else {
      this.answerCurrent({ id: question.id, selected: [choice.label] })
    }
  }

  private answerCurrent(answer: AskUserQuestionAnswerItem): void {
    if (answer.id.length === 0) return
    this.answers.push(answer)
    this.questionIndex++
    if (this.questionIndex >= this.interaction.questions.length) {
      this.onAnswer({ answers: [...this.answers] })
      return
    }
    this.prepareQuestion()
  }

  private prepareQuestion(): void {
    this.cursor = 0
    this.selected.clear()
    this.editor.setText('')
    this.setCustomMode((this.currentQuestion()?.options?.length ?? 0) === 0)
  }

  private setCustomMode(enabled: boolean): void {
    this.customMode = enabled
    this.editor.focused = enabled
  }

  private skipRemaining(): void {
    const remaining = this.interaction.questions.slice(this.questionIndex)
    this.onAnswer({
      answers: [
        ...this.answers,
        ...remaining.map((question) => ({ id: question.id, selected: [] })),
      ],
    })
  }
}
