import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-cmdline'
import type {} from '@deepseek-ai/dsh-compaction'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-stats'
import type {} from '@deepseek-ai/dsh-token-meter'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-user-questions'
import type { Config as OmpTuiConfig } from './config.js'
import { AgentController } from './runtime/agent-controller.js'
import { createCordisEventSource } from './runtime/agent-session.js'
import { installHarnessInteractions, type HarnessInteractionInstallation } from './runtime/harness-interactions.js'
import { InteractionQueue } from './runtime/interaction-queue.js'
import { ProcessSafety, assertInteractiveTerminal } from './runtime/terminal-restore.js'
import { mountTui, type MountedTui } from './tui/mount.js'

export const name = 'omp-tui'
export const inject = ['agentDefaultModel', 'agents', 'sessions']
export { Config } from './config.js'

function report(error: unknown): void {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  process.stderr.write(`dsh-omp-tui: ${message}\n`)
}

export function apply(ctx: Context, config: OmpTuiConfig): void {
  const appExit = ctx.get('appExit')
  if (appExit === undefined) throw new Error('dsh-omp-tui 需要启动器提供 ctx.appExit。')
  try {
    assertInteractiveTerminal()
  } catch (error) {
    process.stderr.write(`dsh-omp-tui: ${error instanceof Error ? error.message : String(error)}\n`)
    appExit(1)
    return
  }

  let controller: AgentController | undefined
  let mounted: MountedTui | undefined
  let interactions: InteractionQueue | undefined
  let interactionInstallation: HarnessInteractionInstallation | undefined
  let processSafety: ProcessSafety | undefined

  ctx.effect(() => () => {
    processSafety?.dispose()
    interactionInstallation?.dispose()
    mounted?.stop()
    void controller?.shutdown().catch(report)
  })

  const run = async (): Promise<void> => {
    await ctx.get('loader')?.await()
    const presets = ctx.get('agentPresets')
    const tools = ctx.get('tools')
    interactions = new InteractionQueue()
    controller = new AgentController({
      agents: ctx.agents,
      sessions: ctx.sessions,
      defaultModel: ctx.agentDefaultModel,
      ...(presets === undefined ? {} : { presets }),
      eventSource: createCordisEventSource(ctx),
      cwd: process.cwd(),
      stopUi: () => mounted?.stop(),
      requestExit: appExit,
    })
    interactionInstallation = installHarnessInteractions(ctx, interactions, () => controller?.agent)
    controller.store.setCapabilities({
      tools: tools !== undefined,
      approval: interactionInstallation.approvalAvailable,
      userQuestions: interactionInstallation.userQuestionsAvailable,
      permissionPresets: ctx.get('permissionPresets') !== undefined,
      compaction: ctx.get('compaction') !== undefined,
      sessionProjections: ctx.get('sessionProjections') !== undefined,
      agentPresets: presets !== undefined,
    })
    const missing = [
      ...(interactionInstallation.approvalAvailable ? [] : ['Approval']),
      ...(interactionInstallation.userQuestionsAvailable ? [] : ['User Questions']),
    ]
    if (missing.length > 0) controller.store.setNotice(`可选服务未挂载：${missing.join('、')}。相关请求将 fail-closed。`)

    await controller.start({
      ...(config.resume === undefined ? {} : { resume: config.resume }),
      ...(config.agentPreset === undefined ? {} : { agentPreset: config.agentPreset }),
    })
    mounted = mountTui({
      store: controller.store,
      actions: {
        send: (text) => {
          controller?.send(text)
        },
        cancel: () => {
          controller?.cancel()
        },
        newSession: async () => {
          await controller?.newSession()
        },
        shutdown: async () => {
          await controller?.shutdown()
        },
      },
      ...(tools === undefined ? {} : { tools }),
      interactions,
      ...(config.maxToolLines === undefined ? {} : { maxToolLines: config.maxToolLines }),
    })
    processSafety = new ProcessSafety({
      shutdown: async (code) => {
        await controller?.shutdown(code)
      },
      restore: () => mounted?.stop(),
      report,
    })
    processSafety.install()
  }

  void run().catch(async (error: unknown) => {
    report(error)
    processSafety?.dispose()
    interactionInstallation?.dispose()
    mounted?.stop()
    if (controller === undefined) appExit(1)
    else {
      try {
        await controller.shutdown(1)
      } catch (shutdownError) {
        report(shutdownError)
      }
    }
  })
}
