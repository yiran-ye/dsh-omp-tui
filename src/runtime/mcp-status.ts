import type { McpServerConnection, McpServerPhase } from '../tui/state.js'

const MCP_CLIENT_PACKAGE = '@deepseek-ai/dsh-mcp-client'
const MCP_TOOL_PREFIX = 'mcp__'
const MCP_LOG_PATTERN = /mcp-client\(([^)]+)\):\s*(.+)/

export interface McpLoaderEntryLike {
  readonly disabled?: boolean
  readonly options: {
    readonly name?: string
    readonly config?: unknown
  }
}

export interface McpStatusSink {
  setMcpServers(servers: readonly McpServerConnection[]): void
}

function serverNameFromConfig(config: unknown): string | undefined {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) return undefined
  const serverName = (config as Record<string, unknown>).serverName
  return typeof serverName === 'string' && serverName.trim().length > 0 ? serverName.trim() : undefined
}

export function configuredMcpServerNames(entries: Iterable<McpLoaderEntryLike>): string[] {
  const names = new Set<string>()
  for (const entry of entries) {
    if (entry.disabled || entry.options.name !== MCP_CLIENT_PACKAGE) continue
    const serverName = serverNameFromConfig(entry.options.config)
    if (serverName !== undefined) names.add(serverName)
  }
  return [...names]
}

export function mcpServerNameFromTool(toolName: string): string | undefined {
  if (!toolName.startsWith(MCP_TOOL_PREFIX)) return undefined
  const separator = toolName.indexOf('__', MCP_TOOL_PREFIX.length)
  if (separator < 0) return undefined
  const serverName = toolName.slice(MCP_TOOL_PREFIX.length, separator)
  return serverName.length > 0 ? serverName : undefined
}

function phaseFromLog(detail: string): McpServerPhase | undefined {
  if (/giving up|reconnect is disabled|reconnect stopped|failed generation/i.test(detail)) return 'failed'
  if (/connection attempt failed|connection failed; retrying|connection lost|reconnecting/i.test(detail)) return 'retrying'
  if (/tool list changed|re-syncing/i.test(detail)) return 'syncing'
  if (/reconnected and re-synced/i.test(detail)) return 'ready'
  return undefined
}

export class McpStatusRuntime {
  private configured = new Set<string>()
  private states = new Map<string, McpServerConnection>()

  constructor(private readonly sink: McpStatusSink) {}

  setConfigured(serverNames: readonly string[]): void {
    const configured = new Set(serverNames)
    const next = new Map<string, McpServerConnection>()
    for (const serverName of configured) {
      next.set(serverName, this.states.get(serverName) ?? {
        name: serverName,
        phase: 'connecting',
        toolCount: 0,
      })
    }
    this.configured = configured
    this.states = next
    this.publish()
  }

  syncTools(toolNames: readonly string[]): void {
    const counts = new Map<string, number>()
    for (const toolName of toolNames) {
      const serverName = mcpServerNameFromTool(toolName)
      if (serverName === undefined) continue
      counts.set(serverName, (counts.get(serverName) ?? 0) + 1)
    }
    for (const serverName of new Set([...this.configured, ...counts.keys()])) {
      const count = counts.get(serverName) ?? 0
      const current = this.states.get(serverName)
      if (count > 0) {
        this.states.set(serverName, { name: serverName, phase: 'ready', toolCount: count })
      } else if (current === undefined) {
        this.states.set(serverName, { name: serverName, phase: 'connecting', toolCount: 0 })
      } else if (current.toolCount !== 0) {
        this.states.set(serverName, { ...current, toolCount: 0 })
      }
    }
    this.publish()
  }

  handleLog(source: string): void {
    const match = MCP_LOG_PATTERN.exec(source)
    if (match === null) return
    const serverName = match[1]?.trim()
    const detail = match[2]?.trim()
    if (serverName === undefined || serverName.length === 0 || detail === undefined) return
    const phase = phaseFromLog(detail)
    if (phase === undefined) return
    const current = this.states.get(serverName)
    this.states.set(serverName, {
      name: serverName,
      phase,
      toolCount: phase === 'ready' ? current?.toolCount ?? 0 : 0,
      detail,
    })
    this.publish()
  }

  markLoaderSettled(): void {
    for (const [serverName, current] of this.states) {
      if (current.phase !== 'connecting' && current.phase !== 'syncing') continue
      this.states.set(serverName, {
        ...current,
        phase: 'ready',
        ...(current.toolCount === 0 ? { detail: '连接成功，但未发现工具' } : {}),
      })
    }
    this.publish()
  }

  private publish(): void {
    this.sink.setMcpServers([...this.states.values()])
  }
}
