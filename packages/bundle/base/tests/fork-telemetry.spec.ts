/**
 * Guard for the fork-owned no-telemetry layer: every shipped bundle composes
 * its upstream patch first and `cordis.fork.patch.yml` last, and the telemetry
 * rows in that composition end up disabled. A renamed or removed upstream row
 * fails here instead of silently re-enabling capture or export.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { applyEntryPatches, entryListSchema, type PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'

const FORK_PATCH = './cordis.fork.patch.yml'

/** Compose the listed bundle layers in profile order over an empty root. */
function compose(...bundles: string[]): { rows: EntryOptions[]; warnings: string[] } {
  const warnings: string[] = []
  let rows: EntryOptions[] = []
  for (const bundle of bundles) {
    const dir = fileURLToPath(new URL(`../../${bundle}`, import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8')) as {
      dsh?: { bundle?: { patch?: string | string[] } }
    }
    const declared = manifest.dsh?.bundle?.patch
    const files = typeof declared === 'string' ? [declared] : declared ?? []
    expect(files, `${bundle} must declare the fork layer`).toContain(FORK_PATCH)
    for (const file of files) {
      const patches = yaml.load(readFileSync(resolve(dir, file), 'utf8'), { schema: entryListSchema }) as PatchOptions[]
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

/** Compose a shipped chain whose later bundles layer over the fork layer. */
function composeChain(...bundles: string[]): EntryOptions[] {
  let rows: EntryOptions[] = []
  for (const bundle of bundles) {
    const dir = fileURLToPath(new URL(`../../${bundle}`, import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8')) as {
      dsh?: { bundle?: { patch?: string | string[] } }
    }
    const declared = manifest.dsh?.bundle?.patch
    const files = typeof declared === 'string' ? [declared] : declared ?? []
    for (const file of files) {
      const patches = yaml.load(readFileSync(resolve(dir, file), 'utf8'), { schema: entryListSchema }) as PatchOptions[]
      rows = applyEntryPatches(rows, patches, () => {})
    }
  }
  return rows
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
      const rows = composeChain(...chain)
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
