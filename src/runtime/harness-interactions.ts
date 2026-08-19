import type { Context } from '@deepseek-ai/cordis'
import { UserQuestionError } from '@deepseek-ai/dsh-user-questions'
import type { ControlledAgent } from './agent-controller.js'
import type { InteractionQueue } from './interaction-queue.js'

export interface HarnessInteractionInstallation {
  readonly approvalAvailable: boolean
  readonly userQuestionsAvailable: boolean
  dispose(): void
}

export function installHarnessInteractions(
  ctx: Context,
  queue: InteractionQueue,
  currentAgent: () => ControlledAgent | undefined,
): HarnessInteractionInstallation {
  const approvalAvailable = ctx.get('approval') !== undefined
  const offApproval = ctx.on('approval/request', async (request, next) => {
    if (request.agent !== currentAgent()) return next()
    return queue.enqueueApproval(request)
  })

  const userQuestions = ctx.get('userQuestions')
  const offQuestions = userQuestions?.registerProvider({
    async ask(request) {
      if (request.agent !== undefined && request.agent !== currentAgent()) {
        throw new UserQuestionError('当前 TUI 只能回答其根 Agent 的问题。', 'DELEGATED_CALLER')
      }
      return queue.enqueueQuestion(request)
    },
  })

  let disposed = false
  return {
    approvalAvailable,
    userQuestionsAvailable: userQuestions !== undefined,
    dispose() {
      if (disposed) return
      disposed = true
      offApproval()
      offQuestions?.()
      queue.shutdown()
    },
  }
}
