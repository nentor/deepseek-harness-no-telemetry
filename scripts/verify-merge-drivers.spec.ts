/** Admission and exclusion coverage for the merge-driver gate's parsing. */
import { describe, expect, it } from 'vitest'
import { attributePatternMatches, findEmptyMergePatterns, findUnwiredMergeDrivers, parseMergeAttributes } from './verify-merge-drivers.ts'

describe('parseMergeAttributes', () => {
  it('collects custom merge drivers with their patterns', () => {
    expect(parseMergeAttributes('snapshots/** merge=ours dsh-review-layer=test\n')).toEqual([
      { pattern: 'snapshots/**', driver: 'ours' },
    ])
  })

  it('skips comments, blanks, and non-driver merge forms', () => {
    const text = [
      '# generated snapshots keep the fork side',
      '',
      '   ',
      'docs/** -merge',
      'other/** merge=unset',
      'plain/** merge',
      'text/** -text merge=ours',
      'other/** diff',
    ].join('\n')
    expect(parseMergeAttributes(text)).toEqual([{ pattern: 'text/**', driver: 'ours' }])
  })
})

describe('attributePatternMatches', () => {
  it('matches git-style directory, recursive, and basename patterns', () => {
    expect(attributePatternMatches('snapshots/**', 'snapshots/sdk/session.v4.jsonl')).toBe(true)
    expect(attributePatternMatches('snapshots/**', 'other/file.ts')).toBe(false)
    expect(attributePatternMatches('*.pdf', 'docs/guide.pdf')).toBe(true)
    expect(attributePatternMatches('*.pdf', 'docs/guide.pdf.bak')).toBe(false)
    expect(attributePatternMatches('dist/', 'dist/bundle.js')).toBe(true)
    expect(attributePatternMatches('dist/', 'src/dist.js')).toBe(false)
  })
})

describe('findEmptyMergePatterns', () => {
  it('reports patterns covering no tracked file while passing covered ones', () => {
    expect(findEmptyMergePatterns(
      [{ pattern: 'snapshots/**', driver: 'ours' }, { pattern: 'gone/**', driver: 'ours' }],
      ['snapshots/sdk/session.v4.jsonl', 'src/index.ts'],
    )).toEqual(['gone/**'])
  })
})

describe('findUnwiredMergeDrivers', () => {
  it('requires each custom driver in the sync workflow and skips a missing workflow', () => {
    const attrs = [{ pattern: 'snapshots/**', driver: 'ours' }]
    expect(findUnwiredMergeDrivers(attrs, 'run: git config merge.ours.driver true')).toEqual([])
    expect(findUnwiredMergeDrivers(attrs, 'run: git merge upstream/master')).toEqual(['ours'])
    expect(findUnwiredMergeDrivers(attrs, undefined)).toEqual([])
  })
})
