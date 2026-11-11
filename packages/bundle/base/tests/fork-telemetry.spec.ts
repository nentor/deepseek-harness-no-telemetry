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

describe('fork no-telemetry layer', () => {
  it('disables both base capture paths', () => {
    const { rows, warnings } = compose('base')
    expect(warnings).toEqual([])
    expectDisabled(rows, 'session-log-deepseek')
    expectDisabled(rows, 'session-telemetry-otel')
  })

  it('disables both Web product-telemetry rows and keeps the release office budget', () => {
    const { rows, warnings } = compose('base', 'web-app')
    expect(warnings).toEqual([])
    expectDisabled(rows, 'session-log-deepseek')
    expectDisabled(rows, 'desktop-product-telemetry')
    expectDisabled(rows, 'product-analytics')
    expect(rows.find(row => row.id === 'office-kit')?.config).toMatchObject({ timeoutMs: 240000 })
  })

  it('disables the standalone minimal SDK capture path', () => {
    const { rows, warnings } = compose('sdk-minimal')
    expect(warnings).toEqual([])
    expectDisabled(rows, 'session-log-deepseek')
  })
})
