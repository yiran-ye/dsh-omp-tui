import { createRequire } from 'node:module'

interface PackageManifest {
  readonly name?: unknown
  readonly version?: unknown
}

const require = createRequire(import.meta.url)

function readPackageManifest(): PackageManifest {
  try {
    return require('../package.json') as PackageManifest
  } catch {
    return {}
  }
}

const manifest = readPackageManifest()

export const APP_NAME = typeof manifest.name === 'string' ? manifest.name : 'dsh-omp-tui'
export const APP_VERSION = typeof manifest.version === 'string' ? manifest.version : '0.0.0'
