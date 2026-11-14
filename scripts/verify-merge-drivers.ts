/**
 * Verify merge-driver seams stay registered and wired.
 *
 * A `.gitattributes` `merge=<driver>` rule applies only when the driver is
 * defined in git config, which fresh checkouts do not carry. The fork's
 * upstream sync therefore registers each custom driver before merging; this
 * gate keeps the declarations, their file coverage, and that wiring from
 * drifting apart silently.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const ATTRIBUTES = '.gitattributes'
/** Fork-owned sync workflow that must register every custom driver before merging. */
const SYNC_WORKFLOW = '.github/workflows/fork-upstream-sync.yml'

/** A merge-attribute declaration parsed from .gitattributes. */
export interface MergeAttribute {
  /** File pattern the rule applies to, as written. */
  pattern: string
  /** Custom driver name from `merge=<driver>`. */
  driver: string
}

/**
 * Parse `merge=<driver>` declarations, skipping comments, blanks, `-merge`,
 * `merge=unset`, and bare `merge` (none of which need a driver definition).
 * @param text - the .gitattributes content.
 * @returns the custom-driver declarations in file order.
 */
export function parseMergeAttributes(text: string): MergeAttribute[] {
  const found: MergeAttribute[] = []
  for (const raw of text.split('\n')) {
    const line = raw.split(/(?<!\\)#/)[0]?.trim() ?? ''
    if (line === '') continue
    const [pattern, ...attrs] = line.split(/\s+/)
    if (pattern === undefined || pattern === '' || attrs.length === 0) continue
    for (const attr of attrs) {
      if (!attr.startsWith('merge=')) continue
      const driver = attr.slice('merge='.length)
      if (driver === '' || driver === 'unset') continue
      found.push({ pattern, driver })
    }
  }
  return found
}

/**
 * Match a .gitattributes pattern against repository-relative `/`-separated
 * paths. Supports `**`, `*`, `?`, and directory-only patterns; a pattern
 * without a `/` matches basenames at any depth, mirroring git.
 * @param pattern - the attribute pattern as written.
 * @param file - the repository-relative path to test.
 * @returns whether the pattern covers the file.
 */
export function attributePatternMatches(pattern: string, file: string): boolean {
  let body = pattern.startsWith('/') ? pattern.slice(1) : pattern
  if (body.endsWith('/')) body += '**'
  const segment = (part: string): string => part === '**'
    ? '.*'
    : part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')
  const source = body.includes('/')
    ? `^(?:${body.split('/').map(segment).join('/')})$`
    : `^(?:.*/)?${segment(body)}$`
  return new RegExp(source).test(file)
}

/**
 * Find merge patterns covering no tracked file: a rule that matches nothing
 * silently stops protecting anything, usually after a path rename.
 * @param attrs - parsed merge declarations.
 * @param files - repository-relative tracked paths with `/` separators.
 * @returns the uncovered patterns in file order.
 */
export function findEmptyMergePatterns(attrs: readonly MergeAttribute[], files: readonly string[]): string[] {
  return attrs
    .map(attr => attr.pattern)
    .filter((pattern, index, all) => all.indexOf(pattern) === index)
    .filter(pattern => !files.some(file => attributePatternMatches(pattern, file)))
}

/**
 * Find custom drivers the sync workflow does not register before merging.
 * @param attrs - parsed merge declarations.
 * @param workflow - the sync workflow content, or `undefined` when the
 *   workflow is absent from this checkout (the check then has no wiring to verify).
 * @returns the distinct unregistered driver names.
 */
export function findUnwiredMergeDrivers(attrs: readonly MergeAttribute[], workflow: string | undefined): string[] {
  if (workflow === undefined) return []
  const missing: string[] = []
  for (const { driver } of attrs) {
    if (!missing.includes(driver) && !workflow.includes(`merge.${driver}.driver`)) missing.push(driver)
  }
  return missing
}

/** Tracked repository-relative paths with `/` separators. */
function listTrackedFiles(): string[] {
  const output = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  return output.split('\n').filter(line => line !== '')
}

if (import.meta.filename === resolve(process.argv[1] ?? '')) {
  const attrs = parseMergeAttributes(readFileSync(resolve(root, ATTRIBUTES), 'utf8'))
  const violations: string[] = []
  const empty = findEmptyMergePatterns(attrs, listTrackedFiles())
  for (const pattern of empty) violations.push(`${ATTRIBUTES}: merge rule ${JSON.stringify(pattern)} matches no tracked file`)
  let workflow: string | undefined
  try {
    workflow = readFileSync(resolve(root, SYNC_WORKFLOW), 'utf8')
  } catch {
    workflow = undefined
  }
  for (const driver of findUnwiredMergeDrivers(attrs, workflow)) {
    violations.push(`${SYNC_WORKFLOW} must register the ${JSON.stringify(driver)} driver (git config merge.${driver}.driver) before merging`)
  }
  if (violations.length > 0) {
    for (const violation of violations) console.error(`verify-merge-drivers: ${violation}`)
    process.exitCode = 1
  } else {
    console.log(`verify-merge-drivers: ${String(attrs.length)} merge driver rule(s) cover tracked files and stay wired.`)
  }
}
