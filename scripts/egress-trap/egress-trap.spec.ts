/** Unit coverage for the egress tripwire's pure helpers; the interposer and the scenario run are exercised by the release gate itself. */
import { describe, expect, it } from 'vitest'
import { parseTrapLog, preloadVariable, PROXY_ENV_VARS } from './run-egress-trap.ts'

describe('parseTrapLog', () => {
  it('reports activation and every blocked attempt', () => {
    expect(parseTrapLog([
      'TRAP_ACTIVE pid=123',
      'EGRESS_ATTEMPT connect 93.184.216.34:443',
      'EGRESS_ATTEMPT getaddrinfo collector.example:443',
      '',
    ].join('\n'))).toEqual({
      active: true,
      attempts: [
        'EGRESS_ATTEMPT connect 93.184.216.34:443',
        'EGRESS_ATTEMPT getaddrinfo collector.example:443',
      ],
    })
  })

  it('distinguishes a quiet run from a run where the shim never loaded', () => {
    expect(parseTrapLog('TRAP_ACTIVE pid=7\n')).toEqual({ active: true, attempts: [] })
    expect(parseTrapLog('')).toEqual({ active: false, attempts: [] })
  })
})

describe('preloadVariable', () => {
  it('maps Linux to LD_PRELOAD and rejects the rest', () => {
    expect(preloadVariable('linux')).toBe('LD_PRELOAD')
    expect(preloadVariable('darwin')).toBeUndefined()
    expect(preloadVariable('win32')).toBeUndefined()
  })

  it('covers both proxy spellings', () => {
    expect(PROXY_ENV_VARS).toContain('HTTP_PROXY')
    expect(PROXY_ENV_VARS).toContain('http_proxy')
    expect(PROXY_ENV_VARS).toContain('NO_PROXY')
  })
})
