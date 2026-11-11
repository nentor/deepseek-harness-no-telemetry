/** The no-telemetry build omits per-install attribution when the process opts out. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { adapter, assemble, options, server } from './helpers.ts'

const cleanups: (() => Promise<void>)[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  while (cleanups.length > 0) await cleanups.pop()!()
})

/** Start a loopback Messages endpoint torn down after the test. */
async function endpoint(): Promise<Awaited<ReturnType<typeof server>>> {
  const http = await server()
  cleanups.push(() => http.close())
  return http
}

describe('DSH_TELEMETRY_DISABLED attribution', () => {
  it('omits the per-install user-id header for any non-empty value', async () => {
    vi.stubEnv('DSH_TELEMETRY_DISABLED', '1')
    const http = await endpoint()
    await assemble(adapter({ baseURL: http.url }).stream(options()))
    expect(http.requests[0]?.headers).not.toHaveProperty('x-deepseek-harness-user-id')
  })

  it('keeps the per-install user-id header when the switch is unset', async () => {
    const http = await endpoint()
    await assemble(adapter({ baseURL: http.url }).stream(options()))
    expect(http.requests[0]?.headers['x-deepseek-harness-user-id']).toBe('test-user')
  })
})
