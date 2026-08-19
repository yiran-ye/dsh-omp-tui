import type { SessionQueryEngine } from '@deepseek-ai/dsh-session-query'
import { displaySessionId } from '../session-id.js'
import type { RecentSessionSummary } from '../tui/state.js'

export type RecentSessionQueryPort = Pick<SessionQueryEngine, 'filterSessions' | 'readTitleSnapshots'>

export interface RecentSessionListOptions {
  readonly cwd: string
  readonly currentSessionId?: string
  readonly limit?: number
  readonly signal?: AbortSignal
  readonly now?: number
}

export interface RecentSessionCatalog {
  list(options: RecentSessionListOptions): Promise<readonly RecentSessionSummary[]>
}

export function createRecentSessionCatalog(query: RecentSessionQueryPort): RecentSessionCatalog {
  return {
    async list(options) {
      const limit = Math.max(0, Math.floor(options.limit ?? 4))
      if (limit === 0) return []
      options.signal?.throwIfAborted()
      const records = await query.filterSessions(
        [{ kind: 'cwd', values: [options.cwd] }],
        options.signal,
      )
      const candidates = records
        .filter((record) => String(record.header.id) !== options.currentSessionId)
        .slice(0, limit)
      if (candidates.length === 0) return []
      const observations = await query.readTitleSnapshots(
        candidates.map((record) => record.header.id),
        options.signal,
      )
      const titles = new Map(observations.flatMap((observation) => {
        if (observation.status === 'rejected' || observation.value.title === undefined) return []
        return [[String(observation.sessionId), observation.value.title] as const]
      }))
      const now = options.now ?? Date.now()
      return candidates.map((record) => {
        const id = String(record.header.id)
        const title = titles.get(id)
        const normalizedTitle = title?.title.trim()
        const timestamp = Math.max(record.header.createdAt, title?.updatedAt ?? 0)
        return {
          id,
          label: normalizedTitle === undefined || normalizedTitle.length === 0
            ? shortSessionId(id)
            : normalizedTitle,
          timeAgo: formatRelativeTime(timestamp, now),
          timestamp,
        }
      })
    },
  }
}

export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  const elapsed = Math.max(0, now - timestamp)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (elapsed < minute) return '刚刚'
  if (elapsed < hour) return `${Math.floor(elapsed / minute)} 分钟前`
  if (elapsed < day) return `${Math.floor(elapsed / hour)} 小时前`
  if (elapsed < 30 * day) return `${Math.floor(elapsed / day)} 天前`
  return new Date(timestamp).toISOString().slice(0, 10)
}

function shortSessionId(id: string): string {
  const displayed = displaySessionId(id)
  return displayed.length <= 12 ? displayed : `${displayed.slice(0, 12)}…`
}
