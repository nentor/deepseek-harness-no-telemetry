#!/usr/bin/env node
/**
 * Fork-only: write an npm consumer manifest that pins packed tarballs via
 * `file:` URLs, so an install resolves every workspace dependency locally
 * instead of letting the registry substitute upstream builds.
 *
 * Mirrors the mapping in scripts/release/verify-packed-install.ts (the
 * directories are read by contents, compatible tarballs become dependencies,
 * foreign-platform ones become optional dependencies), but stops at writing
 * the manifest: callers run their own install and drive the result.
 */

import { execFileSync } from 'node:child_process'
import { readdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

/**
 * Decide whether packed os/cpu constraints accept the current host.
 * @param value - Constraint from the packed manifest, or undefined when unconstrained.
 * @param current - Host value the constraint is checked against.
 * @returns True when the tarball installs on this host.
 */
function acceptsPlatform(value, current) {
  if (value === undefined) return true
  if (!Array.isArray(value) || !value.every(tag => typeof tag === 'string')) {
    throw new Error('packed platform constraints must be arrays of strings')
  }
  let accepted = value.every(tag => tag.startsWith('!'))
  for (const tag of value) {
    if (tag === `!${current}`) return false
    if (tag === current || (tag === 'any' && value.length === 1)) accepted = true
  }
  return accepted
}

/**
 * Read the manifest contained in a packed tarball, without consulting the checkout.
 * @param tarball - Absolute tarball path.
 * @returns The packed package.json object.
 */
function packedManifest(tarball) {
  // GNU tar reads the colon in a Windows drive path as a remote-host separator, so tar runs beside the tarball.
  const raw = execFileSync('tar', ['-xOzf', basename(tarball), 'package/package.json'], {
    cwd: dirname(tarball),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const manifest = JSON.parse(raw)
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error(`${tarball} has no manifest`)
  }
  return manifest
}

/**
 * Write the consumer manifest for every tarball under the given directories.
 * @param out - Manifest path to write.
 * @param directories - Absolute directories holding packed tarballs.
 */
function writeConsumerManifest(out, directories) {
  const consumer = {
    name: 'dsh-packed-consumer',
    version: '0.0.0',
    private: true,
    dependencies: {},
    optionalDependencies: {},
  }
  for (const directory of directories) {
    const tarballs = readdirSync(directory).filter(name => name.endsWith('.tgz')).sort()
    if (tarballs.length === 0) throw new Error(`${directory} holds no packed tarball`)
    for (const filename of tarballs) {
      const tarball = join(directory, filename)
      const manifest = packedManifest(tarball)
      if (typeof manifest.name !== 'string') throw new Error(`${tarball} manifest lacks name`)
      const compatible = acceptsPlatform(manifest.os, process.platform)
        && acceptsPlatform(manifest.cpu, process.arch)
      const url = pathToFileURL(tarball).href
      if (compatible) consumer.dependencies[manifest.name] = url
      else consumer.optionalDependencies[manifest.name] = url
    }
  }
  if (Object.keys(consumer.dependencies).length === 0) throw new Error('no packed tarballs found')
  writeFileSync(out, `${JSON.stringify(consumer, null, 2)}\n`)
}

const { values } = parseArgs({
  options: { out: { type: 'string' }, from: { type: 'string', multiple: true } },
  allowPositionals: false,
})
if (values.out === undefined || values.from === undefined || values.from.length === 0) {
  throw new Error('usage: write-consumer-manifest.mjs --out <manifest> --from <packed directory> [--from ...]')
}
writeConsumerManifest(resolve(values.out), values.from.map(directory => resolve(directory)))
