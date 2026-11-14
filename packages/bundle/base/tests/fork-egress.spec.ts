/**
 * Release-time egress tripwire for the fork-owned no-telemetry layer.
 *
 * Name-based coverage lives in fork-telemetry.spec.ts (a renamed upstream row
 * fails there). This spec is destination-based: an ENABLED row carrying a
 * telemetry destination fails even when its name is unfamiliar, so a future
 * upstream capture path cannot merge in silently. Model traffic
 * (api.deepseek.com) is deliberately not a marker; only telemetry
 * destinations are.
 *
 * LLM-extension exfiltration (session-log requests, package inventory) sends
 * through the model transport rather than a configured URL, so it is covered
 * by row state (must stay disabled or contribution-off) plus the adapter
 * header omission in llm-deepseek/tests/no-telemetry.spec.ts.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { bundlePatchPaths } from '@deepseek-ai/dsh-app-boot'
import { applyEntryPatches, parseEntryYaml, type PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'

/** Telemetry destinations; model traffic is never listed here. */
const DESTINATION_MARKERS = [
  /deepseeksvc\.com/iu,
  /OTLP_URL/u,
]

/** The default OTLP collector; it must only ever appear in disabled rows. */
const COLLECTOR_DEFAULT = 'https://dsh-otel-collector.deepseeksvc.com/v1/logs'

/** Provider names that carry telemetry, attribution, or request diagnostics. */
const OUTBOUND_ROW = /telemetry|analytics|session-log-deepseek|anonymous-user-id|plugin-package-inventory/iu

/** Shipped bundle chains; every profile is anchored on one of them. */
const SHIPPED_CHAINS = [
  ['base'],
  ['base', 'web-app'],
  ['base', 'headless'],
  ['base', 'sdk-app'],
  ['base', 'acp-app'],
  ['sdk-minimal'],
] as const

/** Whether a config object explicitly disables its outbound contribution. */
function contributionDisabled(config: unknown): boolean {
  return typeof config === 'object' && config !== null && 'enabled' in config && config.enabled === false
}

/** Whether a row is disabled outright or is a mounted row with its contribution off. */
function telemetryOff(row: EntryOptions): boolean {
  return row.disabled === true
    || (row.id === 'plugin-package-inventory-deepseek' && contributionDisabled(row.config))
}

/** Compose the listed bundle layers in profile order over an empty root. */
function compose(...bundles: string[]): EntryOptions[] {
  let rows: EntryOptions[] = []
  for (const bundle of bundles) {
    const dir = fileURLToPath(new URL(`../../${bundle}`, import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8')) as {
      dsh?: { bundle?: { patch?: string | string[] } }
    }
    const declared = manifest.dsh?.bundle
    expect(declared?.patch, `${bundle} must declare dsh.bundle.patch`).toBeDefined()
    for (const file of bundlePatchPaths(dir, { patch: declared!.patch! })) {
      const patches = parseEntryYaml(readFileSync(file, 'utf8')) as PatchOptions[]
      rows = applyEntryPatches(rows, patches, () => {})
    }
  }
  return rows
}

/** Whether the row is mounted with an outbound path: enabled and sending. */
function egressCapable(row: EntryOptions): boolean {
  if (telemetryOff(row)) return false
  // The shared OTel transport row mounts without a destination of its own;
  // endpoints arrive only through consumer rows, which must stay off.
  const config: unknown = row.config
  const surface: string = JSON.stringify({ id: row.id, name: row.name, config })
  return OUTBOUND_ROW.test(row.name) || DESTINATION_MARKERS.some(marker => marker.test(surface))
}

describe('fork egress tripwire', () => {
  it('mounts no enabled row with a telemetry name or destination', () => {
    for (const chain of SHIPPED_CHAINS) {
      const rows = compose(...chain)
      expect(rows.length, `${chain.join(' + ')} must compose a non-empty tree`).toBeGreaterThan(0)
      const offenders = rows.filter(egressCapable)
      expect(
        offenders.map(row => `${row.id} (${row.name})`),
        `${chain.join(' + ')} mounts an outbound row the fork layer does not turn off`,
      ).toEqual([])
    }
  })

  it('keeps the default OTLP collector URL in disabled rows only', () => {
    let carriers = 0
    for (const chain of SHIPPED_CHAINS) {
      for (const row of compose(...chain)) {
        const config: unknown = row.config
        if (!JSON.stringify({ id: row.id, name: row.name, config }).includes(COLLECTOR_DEFAULT)) continue
        carriers += 1
        expect(row.disabled, `row ${row.id} carries the collector default and must stay disabled`).toBe(true)
      }
    }
    expect(carriers, 'at least one row must carry the collector default or the scan proves nothing').toBeGreaterThan(0)
  })
})
