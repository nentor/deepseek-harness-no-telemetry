/**
 * Release-time egress tripwire for the no-telemetry fork.
 *
 * Compiles scripts/egress-trap/trap.c, runs one deterministic replay
 * scenario under the interposer, and fails when the trap log shows any
 * non-loopback connection or resolution attempt — or when the trap never
 * activated at all (a missing TRAP_ACTIVE marker means LD_PRELOAD was
 * ignored and the run proves nothing). Proxy variables are stripped so
 * direct attempts cannot hide behind a forwarder.
 *
 * Usage: pnpm tsx scripts/egress-trap/run-egress-trap.ts [scenario]
 * Scenario defaults to 'text-turn'; it must be a scenario the SDK snapshot
 * corpus replays keylessly.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const TRAP_DIR = resolve(import.meta.dirname)
const DEFAULT_SCENARIO = 'text-turn'

/** Proxy variables stripped so attempts cannot hide behind a forwarder. */
export const PROXY_ENV_VARS = [
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
  'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
]

/** Parsed trap log: whether the interposer loaded, and every blocked attempt. */
export interface TrapLog {
  /** Whether a TRAP_ACTIVE marker is present (the shim ran in this tree). */
  active: boolean
  /** Raw EGRESS_ATTEMPT lines, oldest first. */
  attempts: string[]
}

/**
 * Parse a trap log.
 * @param text - the trap log content.
 * @returns activation state and blocked attempts.
 */
export function parseTrapLog(text: string): TrapLog {
  const attempts: string[] = []
  let active = false
  for (const line of text.split('\n')) {
    if (line.startsWith('TRAP_ACTIVE')) active = true
    else if (line.startsWith('EGRESS_ATTEMPT')) attempts.push(line)
  }
  return { active, attempts }
}

/**
 * Preload variable for the platform. Only Linux release runners gate
 * releases; anything else refuses loudly instead of proving nothing.
 * @param platform - Node's process.platform value.
 * @returns the interposer variable, or undefined for unsupported platforms.
 */
export function preloadVariable(platform: string): string | undefined {
  if (platform === 'linux') return 'LD_PRELOAD'
  return undefined
}

/**
 * Compile the interposer.
 * @param workdir - scratch directory receiving the shared object.
 * @returns the absolute path of the compiled interposer.
 */
export function compileTrap(workdir: string): string {
  const out = join(workdir, 'trap.so')
  execFileSync('cc', ['-shared', '-fPIC', '-o', out, join(TRAP_DIR, 'trap.c'), '-ldl'], { stdio: 'pipe' })
  return out
}

function scenarioEnv(shim: string, log: string): Record<string, string> {
  const preload = preloadVariable(process.platform)
  if (preload === undefined) throw new Error(`egress trap: unsupported platform ${process.platform}`)
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || PROXY_ENV_VARS.includes(key)) continue
    env[key] = value
  }
  env[preload] = shim
  env.EGRESS_TRAP_LOG = log
  env.DSH_SNAPSHOT = 'replay'
  env.DSH_SNAPSHOT_MAX_CONCURRENCY = '1'
  return env
}

/** Last bytes of subprocess output for failure reports. */
function excerpt(output: unknown): string {
  if (typeof output === 'string') return output.slice(-4000)
  if (Buffer.isBuffer(output)) return output.toString('utf8').slice(-4000)
  return ''
}

if (import.meta.filename === resolve(process.argv[1] ?? '')) {
  if (process.platform !== 'linux') {
    throw new Error(
      `egress trap: unsupported platform ${process.platform}; the release gate runs on Linux runners, `
      + 'where LD_PRELOAD interposition is reliable (macOS silences it for the Node runtime).',
    )
  }
  const scenario = process.argv[2] ?? DEFAULT_SCENARIO
  const workdir = mkdtempSync(join(tmpdir(), 'egress-trap-'))
  const log = join(workdir, 'trap.log')
  try {
    const shim = compileTrap(workdir)
    if (!existsSync(shim)) throw new Error('egress trap: compiler produced no interposer')
    let output = ''
    try {
      output = execFileSync('pnpm', [
        'vitest', 'run', '--config', 'vitest.snapshot.config.ts',
        'snapshots/sdk/sdk.snapshot.ts', '-t', scenario,
      ], { cwd: root, env: scenarioEnv(shim, log), encoding: 'utf8', timeout: 300000, maxBuffer: 64 * 1024 * 1024 })
    } catch (error) {
      let stdout: unknown
      let stderr: unknown
      if (typeof error === 'object' && error !== null) {
        if ('stdout' in error) stdout = error.stdout
        if ('stderr' in error) stderr = error.stderr
      }
      throw new Error(
        `egress trap: scenario ${JSON.stringify(scenario)} failed\n`
        + `--- stdout ---\n${excerpt(stdout)}\n`
        + `--- stderr ---\n${excerpt(stderr)}`,
      )
    }
    void output
    if (!existsSync(log)) throw new Error(`egress trap: no trap log at ${log}; the interposer never loaded`)
    const { active, attempts } = parseTrapLog(readFileSync(log, 'utf8'))
    if (!active) throw new Error('egress trap: no TRAP_ACTIVE marker; LD_PRELOAD was ignored and this run proves nothing')
    if (attempts.length > 0) {
      throw new Error(`egress trap: ${String(attempts.length)} blocked outbound attempt(s):\n${attempts.join('\n')}`)
    }
    console.log(`egress trap: scenario ${JSON.stringify(scenario)} replayed with zero non-loopback attempts`)
  } finally {
    rmSync(workdir, { recursive: true, force: true })
  }
}
