import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { createStartupCommand, readStartupValues } from '../src/startup.js'

describe('startup 参数', () => {
  it('解析 --resume 与 --agent-preset', () => {
    const command = createStartupCommand()
    command.parse(['node', 'dsh', '--resume', 'abc', '--agent-preset', 'code'])
    expect(readStartupValues(command)).toEqual({ resume: 'abc', agentPreset: 'code' })
  })

  it('未提供参数时保持可选值为空', () => {
    const command = createStartupCommand()
    command.parse(['node', 'dsh'])
    expect(readStartupValues(command)).toEqual({ resume: undefined, agentPreset: undefined })
  })

  it('Bundle patch 是可解析的 YAML', async () => {
    const source = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
    const normalized = source.replaceAll(/!!js ([^\n]+)/g, (_, expression: string) => JSON.stringify(expression))
    const patch: unknown = parse(normalized)
    expect(Array.isArray(patch)).toBe(true)
    expect(source).toContain('dsh-omp-tui/startup')
    expect(source).not.toContain('dsh-web-app')
  })
})
