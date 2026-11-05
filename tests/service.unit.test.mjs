// FR-12 pure time guards from functions/service.js (decisions A5): start allowed from 60 min before the
// slot, no-show from 15 min after it starts, reversal within 24 h of marking. No emulator needed.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const { startAllowedAt, noShowAllowedAt, reversalDeadline } = createRequire(import.meta.url)('../functions/service.js')
const MIN = 60e3
const START = Date.UTC(2030, 0, 7, 3, 0)

describe('startService guard: no earlier than 60 minutes before the start', () => {
  it('is allowed exactly 60 minutes before, and not one millisecond earlier', () => {
    assert.equal(startAllowedAt(START), START - 60 * MIN)
    assert.equal(START - 60 * MIN >= startAllowedAt(START), true)
    assert.equal(START - 60 * MIN - 1 >= startAllowedAt(START), false)
  })
})

describe('markNoShow guard: from 15 minutes after the start', () => {
  it('is allowed exactly 15 minutes after, and not one millisecond earlier', () => {
    assert.equal(noShowAllowedAt(START), START + 15 * MIN)
    assert.equal(START + 15 * MIN - 1 >= noShowAllowedAt(START), false)
    assert.equal(START + 15 * MIN >= noShowAllowedAt(START), true)
  })
})

describe('reverseNoShow guard: within 24 hours of marking', () => {
  it('the deadline is inclusive at exactly 24 hours and closed one millisecond later', () => {
    const marked = START + 20 * MIN
    assert.equal(reversalDeadline(marked), marked + 24 * 60 * MIN)
    assert.equal(marked + 24 * 60 * MIN > reversalDeadline(marked), false)
    assert.equal(marked + 24 * 60 * MIN + 1 > reversalDeadline(marked), true)
  })
})
