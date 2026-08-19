import { displaySessionId } from '../session-id.js'

export const DEFAULT_OMP_TUI_PROFILE = 'omp-tui'

function isProfileFlag(value: string): boolean {
  return value === '--profile' || value.startsWith('--profile=')
}

function shellToken(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) return value
  return `'${value.replaceAll("'", "'\"'\"'")}'`
}

/** Resolves the launcher profile from the original dsh invocation. */
export function resolveLaunchProfile(argv: readonly string[] = process.argv): string {
  for (let index = 2; index < argv.length; index++) {
    const value = argv[index]
    if (value === undefined || !isProfileFlag(value)) continue
    const profile = value === '--profile' ? argv[index + 1] : value.slice('--profile='.length)
    if (profile !== undefined && profile.trim().length > 0) return profile
  }
  return DEFAULT_OMP_TUI_PROFILE
}

/** Formats the OMP-style, copyable command printed after the final TUI frame. */
export function formatResumeHint(sessionId: string, profile: string): string {
  const displayedSessionId = displaySessionId(sessionId).trim()
  if (displayedSessionId.length === 0) return ''
  return `\n\u001b[2mResume this session with dsh --profile ${shellToken(profile)} --resume ${shellToken(displayedSessionId)}\u001b[22m\n`
}
