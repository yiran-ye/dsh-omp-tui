import { SessionId, type SessionHeader } from '@deepseek-ai/dsh-session'
import type {
  SessionRecord,
  SessionTitleObservationResult,
} from '@deepseek-ai/dsh-session-query'
import { describe, expect, it, vi } from 'vitest'
import {
  createRecentSessionCatalog,
  formatRelativeTime,
  type RecentSessionQueryPort,
} from '../src/runtime/recent-sessions.js'

function header(id: string, createdAt: number): SessionHeader {
  return { version: 0, id: SessionId(id), createdAt, cwd: '/repo' }
}

describe('最近会话目录', () => {
  it('只取当前工作区、排除当前会话并限制四条', async () => {
    const now = 2_000_000
    const records: SessionRecord[] = [
      'session-current',
      'session-aaaaaaaaaaaaaa',
      'session-bbbbbbbbbbbbbb',
      'session-cccccccccccccc',
      'session-dddddddddddddd',
      'session-eeeeeeeeeeeeee',
    ].map((id, index) => ({
      header: header(id, now - ((index + 1) * 60_000)),
      live: index === 0,
      persisted: true,
    }))
    const filterSessions = vi.fn(async () => records)
    const readTitleSnapshots = vi.fn(async (ids: readonly ReturnType<typeof SessionId>[]) => ids.map((id, index) => {
      if (index !== 0) {
        return { sessionId: id, status: 'rejected', reason: new Error('无标题') } satisfies SessionTitleObservationResult
      }
      return {
        sessionId: id,
        status: 'fulfilled',
        value: {
          session: header(String(id), now - 120_000),
          title: {
            title: '修复欢迎页布局',
            messageSeqs: [1],
            source: { kind: 'fallback' },
            eventSeq: 2,
            updatedAt: now - 30_000,
          },
        },
      } satisfies SessionTitleObservationResult
    }))
    const query = { filterSessions, readTitleSnapshots } as RecentSessionQueryPort

    const items = await createRecentSessionCatalog(query).list({
      cwd: '/repo',
      currentSessionId: 'session-current',
      limit: 4,
      now,
    })

    expect(filterSessions).toHaveBeenCalledWith([{ kind: 'cwd', values: ['/repo'] }], undefined)
    expect(readTitleSnapshots.mock.calls[0]?.[0]).toHaveLength(4)
    expect(items).toHaveLength(4)
    expect(items[0]).toMatchObject({ label: '修复欢迎页布局', timeAgo: '刚刚' })
    expect(items[1]?.label).toBe('bbbbbbbbbbbb…')
    expect(items.map((item) => item.id)).not.toContain('session-current')
    expect(items.map((item) => item.id)).not.toContain('session-eeeeeeeeeeeeee')
  })

  it('使用中文相对时间，并让查询级故障向调用方传播', async () => {
    expect(formatRelativeTime(1_940_000, 2_000_000)).toBe('1 分钟前')
    expect(formatRelativeTime(200_000, 2_000_000)).toBe('30 分钟前')
    const query = {
      filterSessions: vi.fn(async () => { throw new Error('数据库不可用') }),
      readTitleSnapshots: vi.fn(async () => []),
    } as RecentSessionQueryPort
    await expect(createRecentSessionCatalog(query).list({ cwd: '/repo' })).rejects.toThrow('数据库不可用')
  })
})
