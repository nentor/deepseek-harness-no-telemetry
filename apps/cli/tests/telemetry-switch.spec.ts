import { describe, expect, it } from 'vitest'
import { resolveTelemetryPatches } from '@deepseek-ai/dsh-app-boot'

const ROWS = ['session-log-deepseek', 'session-telemetry-otel', 'desktop-product-telemetry']
const CONTRIBUTIONS = ['plugin-package-inventory-deepseek']

describe('resolveTelemetryPatches', () => {
  it('preserves the configured telemetry mode when the hard-disable switch is unset or empty', () => {
    expect(resolveTelemetryPatches(undefined, ROWS, CONTRIBUTIONS)).toEqual([])
    expect(resolveTelemetryPatches('', ROWS, CONTRIBUTIONS)).toEqual([])
  })

  it('disables every present row and clears every mounted contribution on ANY non-empty value', () => {
    for (const value of ['1', '0', 'false', 'no']) {
      expect(resolveTelemetryPatches(value, ROWS, CONTRIBUTIONS)).toEqual([
        { id: 'session-log-deepseek', disabled: true },
        { id: 'session-telemetry-otel', disabled: true },
        { id: 'desktop-product-telemetry', disabled: true },
        { id: 'plugin-package-inventory-deepseek', config: { enabled: false } },
      ])
    }
  })

  it('is trivially satisfied by a composition without telemetry rows', () => {
    // A custom profile need not mount telemetry: nothing exports, so the
    // privacy switch has nothing to disable and generates no patch.
    expect(resolveTelemetryPatches('1', [], [])).toEqual([])
    expect(resolveTelemetryPatches(undefined, [], [])).toEqual([])
  })
})
