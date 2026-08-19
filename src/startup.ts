import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'
import { Command } from 'commander'

export const name = 'omp-tui-startup'
export const inject = ['cmdlineArgs']
export const OMP_TUI_STARTUP_SERVICE = 'ompTuiStartup'

export interface OmpTuiStartupValues {
  readonly resume: string | undefined
  readonly agentPreset: string | undefined
}

export function createStartupCommand(): Command {
  return new Command()
    .name('dsh --profile omp-tui')
    .description('DeepSeek Harness native OMP-style terminal interface.')
    .helpOption('-h, --help', 'show this help')
    .option('--resume <session-id>', 'resume a persisted Harness session')
    .option('--agent-preset <preset-id>', 'select an Agent Preset for a new session')
    .addHelpText(
      'after',
      `\nExamples:\n  dsh --profile omp-tui\n  dsh --profile omp-tui --resume <session-id>\n  dsh --profile omp-tui --agent-preset code\n`,
    )
}

export function readStartupValues(command: Command): OmpTuiStartupValues {
  const options = command.opts<{ resume?: string; agentPreset?: string }>()
  return { resume: options.resume, agentPreset: options.agentPreset }
}

export function apply(ctx: Context): void {
  const command = createStartupCommand()
  command.action(() => {
    ctx.provide(OMP_TUI_STARTUP_SERVICE, readStartupValues(command))
  })
  parseCmdline(ctx, command)
}
