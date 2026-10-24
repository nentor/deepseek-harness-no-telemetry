/** Ordinary event SDK batching over a cancellable HTTP transport. */
// TELEMETRY REMOVED: no SDK pipeline is constructed; imports below are
// type-only so the public option/record shapes stay source-compatible.
import type { Attributes } from '@opentelemetry/api'
import type { SeverityNumber } from '@opentelemetry/api-logs'
import type { BatchLogRecordProcessorOptions } from '@opentelemetry/sdk-logs'
import type { SessionLogOptions } from './session-log.ts'
import type { LogExporterOptions } from './transport.ts'

/** Scalar values accepted by the collector's Arrow attributes map. */
export type OTelEventScalar = string | number | boolean

/** Explicitly selected analytics fields; object values may contain scalars only. */
export interface OTelEventRecord {
  /** Product/DA-owned event name. */
  eventName: string
  /** Human-readable summary; never a prompt, response, credential, or file contents. */
  body: string
  /** Event occurrence time in Unix milliseconds. Observation time is assigned on enqueue. */
  timestamp: number
  /** OTel severity; omitted values use INFO. */
  severityNumber?: SeverityNumber
  /** Business fields selected by the caller; no automatic device or account identity. */
  attributes?: Record<string, OTelEventScalar | Record<string, OTelEventScalar>>
}

/** Ordinary-event transport, resource, scope, and count-batching options. */
export interface EventLogOptions {
  exporter: LogExporterOptions
  resourceAttributes: Attributes
  scope: { name: string; version?: string }
  processor: Omit<BatchLogRecordProcessorOptions, 'exporter'>
  onFailure: SessionLogOptions['onFailure']
}

/**
 * One caller-owned ordinary-event queue, independent of every Session-log queue.
 * TELEMETRY REMOVED: no SDK pipeline, no network. All methods are no-ops; the
 * `_options` constructor argument is ignored and no transport is created.
 */
export class EventLogReporter {
  /**
   * Enqueue caller-selected analytics fields without acknowledging delivery.
   * TELEMETRY REMOVED: drops the record.
   * @param _record - the ordinary event (discarded).
   */
  emit(_record: OTelEventRecord): void {}

  /**
   * Drain the queue and release its transport, cancelling remaining exports when the caller aborts.
   * TELEMETRY REMOVED: resolves immediately.
   * @param _signal - ignored.
   * @returns immediate completion.
   */
  async shutdown(_signal?: AbortSignal): Promise<void> {}
}
