/** The no-telemetry build omits provider attribution and request diagnostics when the process opts out. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
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

/** One request carrying every opt-out header: user id, session id, and compaction purpose. */
const attributed = () => options({ sessionId: SessionId('session-attributed'), purpose: 'compaction' })

describe('DSH_TELEMETRY_DISABLED attribution', () => {
  it('omits user-id, session-id, and compact headers for any non-empty value', async () => {
    vi.stubEnv('DSH_TELEMETRY_DISABLED', '1')
    const http = await endpoint()
    await assemble(adapter({ baseURL: http.url }).stream(attributed()))
    const headers = http.requests[0]?.headers
    expect(headers).not.toHaveProperty('x-deepseek-harness-user-id')
    expect(headers).not.toHaveProperty('x-deepseek-harness-session-id')
    expect(headers).not.toHaveProperty('x-deepseek-harness-compact')
  })

  it('keeps the headers when the switch is unset', async () => {
    vi.stubEnv('DSH_TELEMETRY_DISABLED', '')
    const http = await endpoint()
    await assemble(adapter({ baseURL: http.url }).stream(attributed()))
    const headers = http.requests[0]?.headers
    expect(headers?.['x-deepseek-harness-user-id']).toBe('test-user')
    expect(headers?.['x-deepseek-harness-session-id']).toBe('session-attributed')
    expect(headers?.['x-deepseek-harness-compact']).toBe('1')
  })
})
