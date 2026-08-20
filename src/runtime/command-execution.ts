type LegacyCommandExecute<Agent, Execution> = (
  agent: Agent,
  line: string,
  signal: AbortSignal,
) => Promise<Execution>

type ImageCommandExecute<Agent, Execution> = (
  agent: Agent,
  line: string,
  images: readonly unknown[],
  signal: AbortSignal,
) => Promise<Execution>

export interface HarnessCommandExecutor<Agent, Execution> {
  readonly execute: LegacyCommandExecute<Agent, Execution> | ImageCommandExecute<Agent, Execution>
}

/**
 * DSH rc.8 inserted composer images before the AbortSignal. Keep the bundle
 * compatible with both command-service ABIs while this package still supports
 * rc.7 profiles. The native TUI has no image composer yet, so rc.8 receives an
 * explicitly empty attachment list.
 */
export function executeHarnessCommand<Agent, Execution>(
  commands: HarnessCommandExecutor<Agent, Execution>,
  agent: Agent,
  line: string,
  signal: AbortSignal,
): Promise<Execution> {
  const execute = commands.execute
  if (execute.length >= 4) {
    return (execute as ImageCommandExecute<Agent, Execution>).call(commands, agent, line, [], signal)
  }
  return (execute as LegacyCommandExecute<Agent, Execution>).call(commands, agent, line, signal)
}
