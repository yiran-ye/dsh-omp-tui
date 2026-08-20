import { describe, expect, it } from 'vitest'
import {
  configuredMcpServerNames,
  McpStatusRuntime,
  mcpServerNameFromTool,
} from '../src/runtime/mcp-status.js'
import type { McpServerConnection } from '../src/tui/state.js'

describe('MCP 后台连接状态', () => {
  it('从 Loader 条目识别已启用的 MCP Server', () => {
    expect(configuredMcpServerNames([
      {
        options: {
          name: '@deepseek-ai/dsh-mcp-client',
          config: { serverName: 'context7' },
        },
      },
      {
        disabled: true,
        options: {
          name: '@deepseek-ai/dsh-mcp-client',
          config: { serverName: 'disabled' },
        },
      },
      { options: { name: 'other-plugin', config: { serverName: 'ignored' } } },
    ])).toEqual(['context7'])
  })

  it('从公开工具名提取 Server 名称', () => {
    expect(mcpServerNameFromTool('mcp__context7__resolve-library-id')).toBe('context7')
    expect(mcpServerNameFromTool('read')).toBeUndefined()
    expect(mcpServerNameFromTool('mcp____tool')).toBeUndefined()
  })

  it('连接时立即发布状态，并在工具到达后切换为 Ready', () => {
    let servers: readonly McpServerConnection[] = []
    const runtime = new McpStatusRuntime({ setMcpServers: (next) => { servers = next } })

    runtime.setConfigured(['context7'])
    expect(servers).toEqual([{ name: 'context7', phase: 'connecting', toolCount: 0 }])

    runtime.syncTools([
      'mcp__context7__resolve-library-id',
      'mcp__context7__query-docs',
      'terminal',
    ])
    expect(servers).toEqual([{ name: 'context7', phase: 'ready', toolCount: 2 }])
  })

  it('把重连和最终失败日志投影到 TUI', () => {
    let servers: readonly McpServerConnection[] = []
    const runtime = new McpStatusRuntime({ setMcpServers: (next) => { servers = next } })
    runtime.setConfigured(['context7'])

    runtime.handleLog('mcp-client(context7): connection failed; retrying in 1000ms')
    expect(servers[0]).toMatchObject({ name: 'context7', phase: 'retrying', toolCount: 0 })

    runtime.handleLog('mcp-client(context7): giving up after 3 consecutive failed reconnect attempts')
    expect(servers[0]).toMatchObject({ name: 'context7', phase: 'failed', toolCount: 0 })
  })
})
