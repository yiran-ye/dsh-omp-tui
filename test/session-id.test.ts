import { describe, expect, it } from 'vitest'
import { createSessionId, displaySessionId, normalizeSessionId } from '../src/session-id.js'

describe('Session ID', () => {
  it('补齐 session- 前缀并支持显示往返', () => {
    expect(normalizeSessionId('abc')).toBe('session-abc')
    expect(normalizeSessionId('session-abc')).toBe('session-abc')
    expect(displaySessionId('session-abc')).toBe('abc')
  })

  it('生成 Harness 约定格式', () => {
    expect(createSessionId()).toMatch(/^session-[0-9a-f-]{36}$/)
  })

  it('拒绝空 ID', () => {
    expect(() => normalizeSessionId('  ')).toThrow('Session ID')
  })
})
