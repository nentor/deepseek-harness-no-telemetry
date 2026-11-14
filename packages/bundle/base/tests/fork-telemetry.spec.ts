/**
 * Guard for the fork-owned no-telemetry layer: every shipped bundle applies
 * its upstream patches first and `cordis.fork.patch.yml` last via the
 * loader's fork-sibling hook (no manifest edit), and the telemetry rows in
 * that composition end up disabled. A renamed or removed upstream row fails
 * here instead of silently re-enabling capture or export.
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { bundlePatchPaths } from '@deepseek-ai/dsh-app-boot'
import { applyEntryPatches, parseEntryYaml, type PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'

/** Compose the listed bundle layers in profile order over an empty root. */
function compose(...bundles: string[]): { rows: EntryOptions[]; warnings: string[] } {
  const warnings: string[] = []
  let rows: EntryOptions[] = []
  for (const bundle of bundles) {
    const dir = fileURLToPath(new URL(`../../${bundle}`, import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8')) as {
      dsh?: { bundle?: { patch?: string | string[] } }
    }
    const declared = manifest.dsh?.bundle
    expect(declared?.patch, `${bundle} must declare dsh.bundle.patch`).toBeDefined()
    const files = bundlePatchPaths(dir, { patch: declared!.patch! })
    // A bundle that ships the fork layer applies it last without a manifest edit.
    if (existsSync(resolve(dir, 'cordis.fork.patch.yml'))) {
      expect(files.at(-1), `${bundle} must apply the fork layer last`).toMatch(/cordis\.fork\.patch\.yml$/)
    }
    for (const file of files) {
      const patches = parseEntryYaml(readFileSync(file, 'utf8')) as PatchOptions[]
      rows = applyEntryPatches(rows, patches, (format, ...args) => { warnings.push(`${format} ${args.join(' ')}`) })
    }
  }
  return { rows, warnings }
}

/** Assert the composed row exists and is disabled, reporting drift by id. */
function expectDisabled(rows: EntryOptions[], id: string): void {
  const row = rows.find(candidate => candidate.id === id)
  expect(row, `row ${id} must exist in the composed bundle`).toBeDefined()
  expect(row?.disabled, `row ${id} must stay disabled`).toBe(true)
}

/** Assert the composed row stays mounted with its outbound contribution disabled. */
function expectContributionOff(rows: EntryOptions[], id: string): void {
  const row = rows.find(candidate => candidate.id === id)
  expect(row, `row ${id} must exist in the composed bundle`).toBeDefined()
  expect(row?.config, `row ${id} must keep its contribution off`).toMatchObject({ enabled: false })
}

/** Provider names that carry telemetry, attribution, or request diagnostics. */
const OUTBOUND_ROW = /telemetry|analytics|session-log-deepseek|anonymous-user-id|plugin-package-inventory/iu

/** Mounted transport provider; its constructor opens no queue, identity, or connection. */
const INERT_ROWS = new Set(['@deepseek-ai/dsh-otel'])

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

describe('fork no-telemetry layer', () => {
  it('disables both base capture paths and clears the request-diagnostics inventory', () => {
    const { rows, warnings } = compose('base')
    expect(warnings).toEqual([])
    expectDisabled(rows, 'session-log-deepseek')
    expectDisabled(rows, 'session-telemetry-otel')
    expectContributionOff(rows, 'plugin-package-inventory-deepseek')
  })

  it('disables both Web product-telemetry rows and keeps the release office budget', () => {
    const { rows, warnings } = compose('base', 'web-app')
    expect(warnings).toEqual([])
    expectDisabled(rows, 'session-log-deepseek')
    expectContributionOff(rows, 'plugin-package-inventory-deepseek')
    expectDisabled(rows, 'desktop-product-telemetry')
    expectDisabled(rows, 'product-analytics')
    expect(rows.find(row => row.id === 'office-kit')?.config).toMatchObject({ timeoutMs: 240000 })
  })

  it('disables the standalone minimal SDK capture paths', () => {
    const { rows, warnings } = compose('sdk-minimal')
    expect(warnings).toEqual([])
    expectDisabled(rows, 'session-log-deepseek')
    expectContributionOff(rows, 'plugin-package-inventory-deepseek')
  })

  it('fails when a shipped chain mounts an outbound row the fork layer does not turn off', () => {
    for (const chain of SHIPPED_CHAINS) {
      const { rows } = compose(...chain)
      const offenders = rows.filter(row => OUTBOUND_ROW.test(row.name)
        && !INERT_ROWS.has(row.name)
        && !telemetryOff(row))
      expect(
        offenders.map(row => `${row.id} (${row.name})`),
        `${chain.join(' + ')} mounts an outbound row the fork layer does not turn off`,
      ).toEqual([])
    }
  })
})
