/** Desktop-only analytics RPC and live compaction collection. */
import { type Context, type Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-host-product-telemetry-otel'
import type {} from '@deepseek-ai/dsh-deepseek-account'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-compaction/types'
import type { ProductEvent } from './events.ts'
import type { EnvironmentAttributes } from './environment.ts'

/** Application-owned collection policy; no user settings surface. */
export interface Config {
  /** Live application collection policy; ordinary Web does not mount this service. */
  enabled: Volatile<boolean>
  /** Running Desktop release, absent when unavailable. */
  appVersion?: string
  /** Maximum execution time per static environment query, in milliseconds. */
  environmentQueryTimeoutMillis: number
  /** Maximum captured bytes per environment query output stream. */
  environmentQueryMaxOutputBytes: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    productAnalytics: ProductAnalytics
  }
}

/** Authenticated event intake; disabled instances do not inspect identity or accept new events. */
export default class ProductAnalytics extends TypertRemoteService {
  static inject = ['deepseekAccount', 'productTelemetry']
  static Config = z.object({
    enabled: z.boolean().default(false).volatile(), appVersion: z.string(),
    environmentQueryTimeoutMillis: z.number().step(1).min(1).max(2_147_483_647).default(5000),
    environmentQueryMaxOutputBytes: z.number().step(1).min(1).max(2_147_483_647).default(16384),
  })
  private active = true
  private readonly environmentLifetime = new AbortController()
  private environment: Promise<EnvironmentAttributes> | undefined
  private readonly listeners = new Set<() => void>()

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'productAnalytics')
    ctx.effect(() => async () => {
      this.active = false
      for (const listener of this.listeners) listener()
      this.environmentLifetime.abort()
      await this.environment
    })
    ctx.on('loader/volatile-update', () => { for (const listener of this.listeners) listener() })
    ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
    ctx.on('session/event', (session, event) => {
      if (event.type !== 'compaction/start') return
      void this.report({ eventName: 'context_compression', timestamp: Date.now(),
        attributes: { session_id: session.id, trigger_type: event.data.turn === null ? 'manual' : 'auto' } })
    })
  }

  /**
   * Read the collection policy.
   * TELEMETRY REMOVED: always reports disabled in this build.
   * @returns always `false`.
   */
  @Remote
  enabled(): boolean {
    void this.active
    void this.config
    return false
  }

  /**
   * Stream the effective policy initially and after live configuration edits.
   * @param signal - subscriber lifetime.
   * @returns current policy values until cancellation or service disposal.
   */
  @Remote({ mode: 'stream' })
  async *watchPolicy(signal: AbortSignal): AsyncIterable<boolean> {
    let update = Promise.withResolvers<void>()
    const changed = (): void => { update.resolve() }
    this.listeners.add(changed)
    signal.addEventListener('abort', changed, { once: true })
    try {
      while (this.active && !signal.aborted) {
        yield this.enabled()
        await update.promise
        update = Promise.withResolvers<void>()
      }
    } finally {
      this.listeners.delete(changed)
      signal.removeEventListener('abort', changed)
    }
  }

  /**
   * Submit selected Desktop fields; missing identity is omitted and never generated.
   * TELEMETRY REMOVED: drops the event; no network traffic leaves this build.
   * @param _event - typed product event (discarded).
   * @returns immediately without submission.
   */
  @Remote
  async report(_event: ProductEvent): Promise<void> {
    return
  }
}
