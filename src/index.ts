import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-cmdline'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-compaction'
import type {} from '@deepseek-ai/dsh-permission-presets'
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-session-stats'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-token-meter'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-user-questions'
import type { SkillRegistry as HarnessSkillRegistry } from '@deepseek-ai/dsh-skill'
import type { Config as OmpTuiConfig } from './config.js'
import { AgentController } from './runtime/agent-controller.js'
import { createCordisEventSource } from './runtime/agent-session.js'
import { executeHarnessCommand } from './runtime/command-execution.js'
import { installHarnessInteractions, type HarnessInteractionInstallation } from './runtime/harness-interactions.js'
import { InteractionQueue } from './runtime/interaction-queue.js'
import { createModelCatalog } from './runtime/model-catalog.js'
import { createRecentSessionCatalog } from './runtime/recent-sessions.js'
import { formatResumeHint, resolveLaunchProfile } from './runtime/resume-hint.js'
import { StatusLineRuntime } from './runtime/status-line-runtime.js'
import { ProcessSafety, assertInteractiveTerminal } from './runtime/terminal-restore.js'
import { mountTui, type MountedTui } from './tui/mount.js'
import { TuiStore } from './tui/store.js'

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
  let removeCommandChangeListener: (() => void) | undefined
  let removeSkillChangeListener: (() => void) | undefined
  let removeToolChangeListener: (() => void) | undefined
  let recentSessionsAbort: AbortController | undefined
  let refreshRecentSessions: (() => Promise<void>) | undefined
  let statusLine: StatusLineRuntime | undefined
  const launchProfile = resolveLaunchProfile()
  let resumeHintPrinted = false

  const printResumeHint = (): void => {
    if (resumeHintPrinted || mounted === undefined) return
    const sessionId = controller?.store.getSnapshot().sessionId
    if (sessionId === undefined) return
    try {
      process.stderr.write(formatResumeHint(sessionId, launchProfile))
      resumeHintPrinted = true
    } catch (error) {
      report(`无法输出恢复命令：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  ctx.effect(() => () => {
    processSafety?.dispose()
    removeCommandChangeListener?.()
    removeSkillChangeListener?.()
    removeToolChangeListener?.()
    recentSessionsAbort?.abort()
    statusLine?.dispose()
    interactionInstallation?.dispose()
    mounted?.stop()
    void controller?.shutdown().catch(report)
  })

  const run = async (): Promise<void> => {
    await ctx.get('loader')?.await()
    const presets = ctx.get('agentPresets')
    const tools = ctx.get('tools')
    const llm = ctx.get('llm')
    const commands = ctx.get('commands')
    const skills = ctx.get('skills')
    const sessionQuery = ctx.get('sessionQuery')
    const tokenMeter = ctx.get('tokenMeter')
    const sandboxPolicy = ctx.get('sandboxPolicy')
    const compactionAvailable = ctx.get('compaction') !== undefined
    const cwd = process.cwd()
    interactions = new InteractionQueue()
    const store = new TuiStore()
    statusLine = new StatusLineRuntime(store, {
      cwd,
      compactionAvailable,
      ...(llm === undefined ? {} : { llm }),
      ...(tokenMeter === undefined ? {} : { tokenMeter }),
      ...(sandboxPolicy === undefined ? {} : { sandboxPolicy }),
    })
    controller = new AgentController({
      agents: ctx.agents,
      sessions: ctx.sessions,
      defaultModel: ctx.agentDefaultModel,
      ...(presets === undefined ? {} : { presets }),
      eventSource: createCordisEventSource(ctx),
      cwd,
      store,
      statusLine,
      stopUi: () => {
        try {
          mounted?.stop()
        } finally {
          printResumeHint()
        }
      },
      requestExit: appExit,
    })
    interactionInstallation = installHarnessInteractions(ctx, interactions, () => controller?.agent)
    controller.store.setCapabilities({
      tools: tools !== undefined,
      approval: interactionInstallation.approvalAvailable,
      userQuestions: interactionInstallation.userQuestionsAvailable,
      permissionPresets: ctx.get('permissionPresets') !== undefined,
      compaction: compactionAvailable,
      sessionProjections: ctx.get('sessionProjections') !== undefined,
      agentPresets: presets !== undefined,
    })
    const missing = [
      ...(interactionInstallation.approvalAvailable ? [] : ['授权确认']),
      ...(interactionInstallation.userQuestionsAvailable ? [] : ['用户问题']),
    ]
    if (missing.length > 0) controller.store.setNotice(`可选服务未挂载：${missing.join('、')}。相关请求将被拒绝处理。`)

    await controller.start({
      ...(config.resume === undefined ? {} : { resume: config.resume }),
      ...(config.agentPreset === undefined ? {} : { agentPreset: config.agentPreset }),
    })
    const recentSessionCatalog = sessionQuery === undefined
      ? undefined
      : createRecentSessionCatalog(sessionQuery)
    refreshRecentSessions = async (): Promise<void> => {
      recentSessionsAbort?.abort()
      if (recentSessionCatalog === undefined || controller === undefined) {
        controller?.store.setRecentSessions({ status: 'unavailable', items: [] })
        return
      }
      const request = new AbortController()
      recentSessionsAbort = request
      controller.store.setRecentSessions({ status: 'loading', items: [] })
      const sessionId = controller.store.getSnapshot().sessionId
      try {
        const items = await recentSessionCatalog.list({
          cwd: process.cwd(),
          limit: 4,
          signal: request.signal,
          ...(sessionId === undefined ? {} : { currentSessionId: sessionId }),
        })
        if (request.signal.aborted || recentSessionsAbort !== request) return
        controller.store.setRecentSessions({ status: 'ready', items })
      } catch {
        if (request.signal.aborted || recentSessionsAbort !== request) return
        controller.store.setRecentSessions({ status: 'error', items: [] })
      } finally {
        if (recentSessionsAbort === request) recentSessionsAbort = undefined
      }
    }
    void refreshRecentSessions()
    const commandRegistry = commands === undefined ? undefined : {
      list: () => {
        const agent = controller?.agent
        return agent === undefined ? [] : commands.list(agent as Parameters<typeof commands.list>[0])
      },
      execute: (line: string, signal: AbortSignal) => {
        const agent = controller?.agent
        return agent === undefined
          ? Promise.resolve(undefined)
          : executeHarnessCommand(commands, agent as Parameters<typeof commands.execute>[0], line, signal)
      },
    }
    const skillRegistry = skills === undefined && presets === undefined ? undefined : {
      list: async (signal: AbortSignal) => {
        const agent = controller?.agent
        if (agent === undefined) return []
        const presetServices = presets as {
          serviceFor?: (scope: unknown, name: string) => unknown
        } | undefined
        const scopedSkills = presetServices?.serviceFor === undefined
          ? undefined
          : presetServices.serviceFor(agent, 'skills')
        const registry = (scopedSkills ?? skills) as HarnessSkillRegistry | undefined
        if (registry === undefined) return []
        const all = await registry.list({
          cwd: process.cwd(),
          scope: agent,
          signal,
        })
        return all.filter((skill) => skill.invocation.userInvocable)
      },
    }
    const mcpRegistry = tools === undefined ? undefined : {
      list: () => {
        const agent = controller?.agent
        if (agent === undefined) return []
        return tools.schemas(agent as Parameters<typeof tools.schemas>[0])
          .filter((tool) => tool.name.startsWith('mcp__'))
          .map((tool) => ({ name: tool.name, description: tool.description }))
      },
    }
    const modelCatalog = llm === undefined ? undefined : createModelCatalog(llm)
    mounted = mountTui({
      store: controller.store,
      actions: {
        send: (text) => {
          controller?.send(text)
        },
        cancel: () => {
          controller?.cancel()
        },
        selectModel: async (selection) => {
          await controller?.selectModel(selection)
        },
        ...(sandboxPolicy === undefined ? {} : {
          selectSandboxMode: (mode) => Promise.resolve().then(() => {
            const session = controller?.agent?.session
            if (session === undefined) throw new Error('当前 Agent 尚未就绪。')
            if (sandboxPolicy.resolve({ session }).mode !== mode) setSandboxMode(session, mode)
          }),
        }),
        newSession: async () => {
          await controller?.newSession()
          await refreshRecentSessions?.()
        },
        shutdown: async () => {
          await controller?.shutdown()
        },
      },
      ...(tools === undefined ? {} : { tools }),
      ...(commandRegistry === undefined ? {} : { commands: commandRegistry }),
      ...(skillRegistry === undefined ? {} : { skills: skillRegistry }),
      ...(mcpRegistry === undefined ? {} : { mcp: mcpRegistry }),
      ...(modelCatalog === undefined ? {} : { models: modelCatalog }),
      interactions,
      ...(config.maxToolLines === undefined ? {} : { maxToolLines: config.maxToolLines }),
    })
    if (commands !== undefined) {
      removeCommandChangeListener = ctx.on('commands/change', () => mounted?.refreshSlashCommands())
    }
    if (skills !== undefined) {
      removeSkillChangeListener = ctx.on('skills/change', () => mounted?.refreshSlashCommands())
    }
    if (tools !== undefined) {
      removeToolChangeListener = ctx.on('tools/change', () => mounted?.refreshSlashCommands())
    }
    processSafety = new ProcessSafety({
      shutdown: async (code) => {
        await controller?.shutdown(code)
      },
      restore: () => mounted?.stop(),
      beginClosing: () => controller?.store.beginClosing(),
      report,
    })
    processSafety.install()
  }

  void run().catch(async (error: unknown) => {
    report(error)
    statusLine?.dispose()
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
