/** Launcher-owned profile locations and composition inputs. */
import { join } from 'node:path'
import { composeEntries, loadProfileDirectory, PROFILE_PATCH_FILENAME, type Profile } from './profile.ts'
import { loadOptionalPatches } from './index.ts'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'

/** Application-owned package manager executable; environment applies only to package operations. */
export interface ProfilePnpmInvocation {
  readonly command: string
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string>>
}

/** Current profile facts; scheduling and mutation belong to their callers. */
export interface ProfileContext {
  readonly name: string
  /** Packaged applications supply their bundled runtime instead of a PATH executable. */
  readonly packageManager?: ProfilePnpmInvocation
  readonly dir: string
  readonly patchPath: string
  readonly installAnchor: string
  readonly cwd: string
  readonly home: string
  /** Bundle packages used to start this process, before any persisted edits. */
  readonly startedBundles: readonly string[]
  /** Parsed command-line overlays, applied above profile and home patches. */
  readonly overlays: readonly PatchOptions[]
  /** Launch-time DSH_TELEMETRY_DISABLED value; any non-empty value opts out. */
  readonly telemetryDisabledEnv: string | undefined
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Present only in a profile launched by dsh. */
    profileContext: ProfileContext
  }
}

/**
 * Rows that send telemetry or per-install attribution. The opt-out switch
 * disables each row the composed profile actually carries, after every user
 * and `--patch` overlay has applied.
 */
const TELEMETRY_ROW_IDS = [
  'session-log-deepseek',
  'session-telemetry-otel',
  'desktop-product-telemetry',
  'product-analytics',
] as const

/**
 * Rows that must stay mounted but send no outbound contribution. Disabling the
 * row would also skip its hosting work (the package inventory initializes the
 * live agent registry), so the opt-out clears the contribution instead.
 */
const TELEMETRY_CONTRIBUTION_ROW_IDS = [
  'plugin-package-inventory-deepseek',
] as const

/**
 * Resolve the telemetry opt-out switch into its boot patches. ANY non-empty
 * value (including `'0'`/`'false'`) opts out: a privacy switch prefers
 * off-by-mistake over on-by-mistake. A composition without a telemetry row
 * exports nothing, so the switch is then trivially satisfied and no patch is
 * generated for that row — custom profiles need not mount telemetry to run
 * with the switch set.
 * @param disabledEnv - the raw `DSH_TELEMETRY_DISABLED` value (`undefined` when unset).
 * @param rowIds - telemetry row ids present in the composed profile.
 * @param contributionRowIds - mounted rows whose outbound contribution is disabled.
 * @returns disable and contribution patches for the present rows, in order.
 */
export function resolveTelemetryPatches(
  disabledEnv: string | undefined,
  rowIds: readonly string[],
  contributionRowIds: readonly string[] = [],
): PatchOptions[] {
  if ((disabledEnv ?? '') === '') return []
  return [
    ...rowIds.map(id => ({ id, disabled: true })),
    ...contributionRowIds.map(id => ({ id, config: { enabled: false } })),
  ]
}

/** Read the selected bundles' patches, which apply before the profile patch file.
 * @param binName Diagnostic prefix for malformed or missing configuration.
 * @param context Data supplied by the profile launcher.
 * @param initialProfile Already loaded startup profile; omitted reads the current files.
 * @returns Bundle patches in application order.
 */
export function readBundlePatches(binName: string, context: ProfileContext, initialProfile?: Profile): PatchOptions[] {
  const profile = initialProfile ?? loadProfileDirectory(binName, context.dir, context.installAnchor, { userLayer: false })
  return profile.layers.flatMap(layer => layer.patches)
}

/** Read current bundle and user layers with the launch-time overlays.
 * @param binName Diagnostic prefix for malformed or missing configuration.
 * @param context Data supplied by the profile launcher.
 * @param initialProfile Already loaded startup profile; omitted reads the current files.
 * @returns Detached ordered patches; this function does not update the Loader.
 */
export function readProfilePatches(binName: string, context: ProfileContext, initialProfile?: Profile): PatchOptions[] {
  const patches = structuredClone([
    ...readBundlePatches(binName, context, initialProfile),
    ...(initialProfile?.patches ?? loadOptionalPatches(binName, context.patchPath) ?? []),
    ...(loadOptionalPatches(binName, join(context.home, PROFILE_PATCH_FILENAME)) ?? []),
    ...context.overlays,
  ])
  const rows = composeEntries([patches])
  const presentTelemetryIds = TELEMETRY_ROW_IDS.filter(id => rows.some(row => row.id === id))
  const presentContributionIds = TELEMETRY_CONTRIBUTION_ROW_IDS.filter(id => rows.some(row => row.id === id))
  patches.push(...resolveTelemetryPatches(
    context.telemetryDisabledEnv,
    presentTelemetryIds,
    presentContributionIds,
  ))
  return patches
}
