/** Session-log records in an independent byte-bounded OTLP queue. */
// TELEMETRY REMOVED: no SDK pipeline is constructed; imports below are
// type-only so the public option/record shapes stay source-compatible.
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { Attributes } from '@opentelemetry/api'
import type { SeverityNumber } from '@opentelemetry/api-logs'
import type { BatchLogRecordProcessorOptions } from '@opentelemetry/sdk-logs'
import type { LogExporterOptions } from './transport.ts'

/** Collector request ceiling in uncompressed UTF-8 bytes, including the OTLP envelope. */
export const SESSION_LOG_MAX_REQUEST_BYTES = 4_000_000

/** One canonical event with its separately owned Session identity and redacted payload. */
export interface SessionLogRecord {
  sessionId: SessionId
  /** Complete event envelope; data is the capture policy's exported copy. */
  event: Omit<SessionEvent, 'data'> & { data: unknown }
  /** Additional capture metadata; sessionId and content are always assigned by the reporter. */
  attributes?: Attributes
  /** Omitted values use INFO. */
  severityNumber?: SeverityNumber
}

/**
 * Byte and count batching fields implemented by {@link SessionLogProcessor}.
 *
 * `exporter` belongs to the owning channel, and `selfObsMeterProvider` is
 * excluded because this processor implements no self-observability metering.
 */
export type SessionLogProcessorOptions = Omit<BatchLogRecordProcessorOptions, 'exporter' | 'selfObsMeterProvider'>

/** Session-log transport and byte/count queue settings. */
export interface SessionLogOptions {
  /** Explicit destination and SDK transport settings; exporter self-observability metering is not supported. */
  exporter: LogExporterOptions
  /** Session-only queue settings, independent of product-event aggregation. */
  processor?: SessionLogProcessorOptions
  /** May lower, but never exceed, the collector's 4,000,000-byte limit. */
  maxRequestBytes?: number
  /** Instrumentation scope supplied by the business owner. */
  scope: { name: string; version?: string }
  /** Application and anonymous identity carried on the OTLP resource. */
  resourceAttributes: Attributes
  /** Report rejected single records and network failures without recording their content. */
  onFailure: (message: string, error?: Error) => void
}

/**
 * Validate byte and queue settings before constructing an SDK pipeline.
 * @param options - Session-specific limits supplied by the owning composition.
 * @returns the resolved collector request limit.
 */
export function resolveSessionLogLimits(options: Pick<SessionLogOptions, 'maxRequestBytes' | 'processor'>): number {
  const limit = options.maxRequestBytes ?? SESSION_LOG_MAX_REQUEST_BYTES
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > SESSION_LOG_MAX_REQUEST_BYTES) {
    throw new Error(`session log maxRequestBytes must be an integer between 1 and ${SESSION_LOG_MAX_REQUEST_BYTES}`)
  }
  for (const key of ['maxQueueSize', 'maxExportBatchSize', 'scheduledDelayMillis', 'exportTimeoutMillis'] as const) {
    const value = options.processor?.[key]
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647)) {
      throw new Error(`session log processor.${key} must be a positive integer no greater than 2147483647`)
    }
  }
  const queue = options.processor?.maxQueueSize ?? 2048
  const batch = options.processor?.maxExportBatchSize ?? 512
  if (batch > queue) throw new Error('session log maxExportBatchSize must not exceed maxQueueSize')
  return limit
}

/**
 * Owns feedback-authorized Session logs; no product-event provider or queue is mounted.
 * TELEMETRY REMOVED: no SDK pipeline, no network. All methods are no-ops; the
 * `_options` constructor argument is ignored and no transport is created.
 */
export class SessionLogReporter {
  /** TELEMETRY REMOVED: `_options` is ignored; no transport is created in this build. */
  constructor(_options: SessionLogOptions) { void _options }
  /**
   * Enqueue one complete event without acknowledging network delivery.
   * TELEMETRY REMOVED: drops the record.
   * @param _record - event (discarded).
   */
  reportSessionLog(_record: SessionLogRecord): void {}

  /** Stop queued requests after the owning backend's shutdown deadline; an active transport may still settle. */
  stopPending(): void {}

  /**
   * Drain queued requests and release the SDK transport.
   * TELEMETRY REMOVED: resolves immediately.
   * @returns immediate completion.
   */
  async shutdown(): Promise<void> {}
}
