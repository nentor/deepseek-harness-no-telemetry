/**
 * Per-harness-home anonymous user id shared by telemetry and feedback.
 *
 * TELEMETRY REMOVED (local no-telemetry build): this stub never creates,
 * reads, or writes any identifier and never touches the filesystem. It
 * returns a fixed non-identifying constant so all callers stay type-correct
 * while no stable per-installation correlation id exists.
 *
 * @module @deepseek-ai/dsh-anonymous-user-id
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** A harness-home-scoped anonymous user id (random UUID v4). */
export type AnonymousUserId = Branded<'AnonymousUserId'>

/** File inside the harness home storing the id: a bare UUID line, no wrapper format. */
export const ANONYMOUS_USER_ID_FILE_NAME = '.anonymous-user-id'

/** Ambient hooks for locating and generating the id; every field has a default. */
export interface AnonymousUserIdOptions {
  /** Environment consulted for `DSH_HOME`; defaults to `process.env`. */
  env?: NodeJS.ProcessEnv
  /** UUID generator; defaults to `crypto.randomUUID` (test hook). */
  randomUUID?: () => string
}

/** Process-lifetime memo keyed by resolved file path, so distinct test homes never share an id. */
const memo = new Map<string, AnonymousUserId>()

/**
 * Return the harness home's anonymous user id, creating and persisting one on
 * first use. A concurrent first launch is settled by an exclusive-create
 * write: the loser rereads the winner's id. (A reread landing in the winner's
 * narrow create-to-write window can still yield two per-process ids for that
 * run; the next launch converges on the persisted one.) Persistence is
 * best-effort — a write failure (read-only home) still returns a usable id
 * for the current run so feedback and telemetry are never blocked.
 * @param _options - home-location and UUID-generation seams (ignored; no-telemetry stub).
 * @returns a fixed non-identifying constant; no id is persisted.
 */
export function getOrCreateAnonymousUserId(_options: AnonymousUserIdOptions = {}): AnonymousUserId {
  // TELEMETRY REMOVED: fixed value, no filesystem access, no UUID generation.
  // Memoized per constant key to preserve call-shape stability.
  const key = 'telemetry-disabled'
  const cached = memo.get(key)
  if (cached !== undefined) return cached
  const id = 'telemetry-disabled' as AnonymousUserId
  memo.set(key, id)
  return id
}
