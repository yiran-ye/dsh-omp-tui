import { randomUUID } from 'node:crypto'
import { SessionId } from '@deepseek-ai/dsh-session'

const SESSION_ID_PREFIX = 'session-'

export function normalizeSessionId(value: string): SessionId {
  const trimmed = value.trim()
  if (trimmed.length === 0) throw new Error('Session ID 不能为空。')
  return SessionId(trimmed.startsWith(SESSION_ID_PREFIX) ? trimmed : `${SESSION_ID_PREFIX}${trimmed}`)
}

export function createSessionId(): SessionId {
  return SessionId(`${SESSION_ID_PREFIX}${randomUUID()}`)
}

export function displaySessionId(value: string): string {
  return value.startsWith(SESSION_ID_PREFIX) ? value.slice(SESSION_ID_PREFIX.length) : value
}
