// FR-10 pure logic (decisions A5 addendum): the delay projection and the warning rule, from
// functions/queueDelay.js (authoritative) and its client copy src/lib/queue.js, which a parity test
// keeps in step. No emulator needed. Times are milliseconds; `now` is always passed in.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import * as client from '../src/lib/queue.js'

const server = createRequire(import.meta.url)('../functions/queueDelay.js')

const MIN = 60e3
const NOW = Date.UTC(2030, 0, 7, 3, 0) // 11:00 Singapore
const at = (min) => NOW + min * MIN

/** Runs the same test against both copies, so a difference in either shows up. */
for (const [name, lib] of [['functions/queueDelay.js', server], ['src/lib/queue.js', client]]) {
  const { project, warningDecision, DELAY_THRESHOLD_MS, WARN_LEAD_MS } = lib
  const run = (over) => project({ now: NOW, inService: [], bookings: [], walkIns: [], ...over })
  const bk = (id, startMin, durationMin = 30) => ({ id, start: at(startMin), durationMin })
  const byId = (rows) => Object.fromEntries(rows.map((r) => [r.id, r]))

  describe(`${name}: constants`, () => {
    it('warns above 10 minutes, at least 15 minutes ahead', () => {
      assert.equal(DELAY_THRESHOLD_MS, 10 * MIN)
      assert.equal(WARN_LEAD_MS, 15 * MIN)
    })
  })

  describe(`${name}: when the barber is free`, () => {
    it('is now when nothing is in service', () => {
      assert.equal(run({}).freeAt, NOW)
    })
    it('is the expected end of the service in progress: actualStart + durationMin', () => {
      assert.equal(run({ inService: [{ actualStart: at(-10), durationMin: 30 }] }).freeAt, at(20))
    })
    it('is clamped to now when the service has overrun, never a time in the past', () => {
      assert.equal(run({ inService: [{ actualStart: at(-50), durationMin: 30 }] }).freeAt, NOW)
      assert.equal(run({ inService: [{ actualStart: at(-30), durationMin: 30 }] }).freeAt, NOW, 'ending exactly now')
      assert.equal(run({ inService: [{ actualStart: at(-29), durationMin: 30 }] }).freeAt, at(1))
    })
    it('uses the latest expected end when more than one thing is in service', () => {
      const inService = [{ actualStart: at(-10), durationMin: 30 }, { actualStart: at(0), durationMin: 45 }]
      assert.equal(run({ inService }).freeAt, at(45))
    })
  })

  describe(`${name}: booking delay`, () => {
    it('is zero and keeps the scheduled start when the barber is free in time', () => {
      const [b] = run({ bookings: [bk('a', 5)] }).bookings
      assert.deepEqual([b.delayMs, b.delayMin, b.projectedStart], [0, 0, at(5)])
    })
    it('is free time minus scheduled start for the first booking', () => {
      const [b] = run({ inService: [{ actualStart: at(-10), durationMin: 30 }], bookings: [bk('a', 5)] }).bookings
      assert.deepEqual([b.delayMs, b.delayMin, b.projectedStart], [15 * MIN, 15, at(20)])
    })
    it('grows minute by minute while a service overruns (for a booking whose slot has begun)', () => {
      const inService = [{ actualStart: at(-40), durationMin: 30 }] // should have ended 10 minutes ago
      const later = (min) => project({ now: at(min), inService, bookings: [bk('a', 0)], walkIns: [] }).bookings[0]
      assert.equal(later(0).delayMin, 0)
      assert.equal(later(5).delayMin, 5)
      assert.equal(later(12).delayMin, 12)
    })
    it('a booking whose slot has begun but who has not started is assumed to start now', () => {
      const [b] = run({ bookings: [bk('a', -10, 30)] }).bookings
      assert.deepEqual([b.delayMin, b.projectedStart], [10, NOW])
    })
    it('is measured from actual start and completion times: finishing removes the delay', () => {
      const bookings = [bk('a', 5)]
      assert.equal(run({ inService: [{ actualStart: at(-10), durationMin: 30 }], bookings }).bookings[0].delayMin, 15)
      assert.equal(run({ inService: [], bookings }).bookings[0].delayMin, 0)
    })
    it('never starts a booking early', () => {
      const [b] = run({ bookings: [bk('a', 60)] }).bookings
      assert.equal(b.projectedStart, at(60))
    })
    it('rounds the displayed delay up to whole minutes', () => {
      const [b] = run({ inService: [{ actualStart: at(-30) + 1, durationMin: 60 }], bookings: [bk('a', 0)] }).bookings
      assert.equal(b.delayMs, 30 * MIN + 1)
      assert.equal(b.delayMin, 31)
    })
  })

  describe(`${name}: chaining through later bookings`, () => {
    it('a late booking pushes the next one, which is delayed by the chain, not just by the service', () => {
      const r = byId(run({
        inService: [{ actualStart: at(0), durationMin: 30 }],
        bookings: [bk('a', 10), bk('b', 30), bk('c', 120)],
      }).bookings)
      assert.deepEqual([r.a.delayMin, r.a.projectedStart], [20, at(30)])
      assert.deepEqual([r.b.delayMin, r.b.projectedStart], [30, at(60)])
      assert.deepEqual([r.c.delayMin, r.c.projectedStart], [0, at(120)], 'the chain absorbs into the gap')
    })
    it('orders bookings by start, ties by ID, whatever order they are given', () => {
      const out = run({
        inService: [{ actualStart: at(0), durationMin: 30 }],
        bookings: [bk('z', 10), bk('a', 10), bk('m', 5)],
      }).bookings
      assert.deepEqual(out.map((b) => b.id), ['m', 'a', 'z'])
    })
  })

  describe(`${name}: bookings first`, () => {
    it('waiting walk-ins never change any booking\'s delay or projected start', () => {
      const inService = [{ actualStart: at(-10), durationMin: 30 }]
      const bookings = [bk('a', 5), bk('b', 40)]
      const without = run({ inService, bookings }).bookings
      const withQueue = run({
        inService, bookings,
        walkIns: [{ id: 'w1', joinedAt: at(-20), durationMin: 60 }, { id: 'w2', joinedAt: at(-15), durationMin: 60 }],
      }).bookings
      assert.deepEqual(withQueue, without)
    })
    it('ignores a booking that is not delayed even with a long queue', () => {
      const r = run({ bookings: [bk('a', 20)], walkIns: [{ id: 'w', joinedAt: at(-5), durationMin: 120 }] })
      assert.equal(r.bookings[0].delayMin, 0)
    })
  })

  describe(`${name}: walk-in estimated wait (separate from booking delay)`, () => {
    const w = (id, joined, durationMin) => ({ id, joinedAt: at(joined), durationMin })
    it('starts now when the barber is free and no booking is in the way', () => {
      const [x] = run({ walkIns: [w('w', -5, 30)] }).walkIns
      assert.deepEqual([x.estimatedStart, x.waitMin], [NOW, 0])
    })
    it('waits for the service in progress', () => {
      const [x] = run({ inService: [{ actualStart: at(-10), durationMin: 30 }], walkIns: [w('w', -5, 20)] }).walkIns
      assert.deepEqual([x.estimatedStart, x.waitMin], [at(20), 20])
    })
    it('fits into a gap before a booking when it fits, otherwise goes after that booking', () => {
      assert.equal(run({ bookings: [bk('a', 30)], walkIns: [w('w', -5, 30)] }).walkIns[0].estimatedStart, NOW, 'exactly fits: [0,30) then the booking at 30')
      assert.equal(run({ bookings: [bk('a', 30)], walkIns: [w('w', -5, 31)] }).walkIns[0].estimatedStart, at(60))
    })
    it('places walk-ins in the order they joined and never lets a later one overtake an earlier one', () => {
      const r = run({ bookings: [bk('a', 30)], walkIns: [w('w1', -10, 40), w('w2', -5, 10)] }).walkIns
      assert.deepEqual(r.map((x) => [x.id, x.estimatedStart]), [['w1', at(60)], ['w2', at(100)]])
    })
    it('breaks joinedAt ties by ID', () => {
      const r = run({ walkIns: [w('b', -5, 10), w('a', -5, 10)] }).walkIns
      assert.deepEqual(r.map((x) => x.id), ['a', 'b'])
      assert.equal(r[1].estimatedStart, at(10))
    })
    it('uses a delayed booking\'s projected time, not its scheduled time', () => {
      const r = run({
        inService: [{ actualStart: at(-5), durationMin: 50 }], // free at +45
        bookings: [bk('a', 30)], // projected [45, 75)
        walkIns: [w('w', -1, 10)],
      })
      assert.equal(r.bookings[0].projectedStart, at(45))
      assert.equal(r.walkIns[0].estimatedStart, at(75))
    })
    it('rounds the wait up to whole minutes and never reports a negative wait', () => {
      const r = run({ inService: [{ actualStart: at(-30) + 1, durationMin: 30 }], walkIns: [w('w', -5, 10)] }).walkIns[0]
      assert.equal(r.waitMin, 1)
      assert.ok(run({ walkIns: [w('w', -5, 10)] }).walkIns[0].waitMin >= 0)
    })
  })

  describe(`${name}: which bookings count`, () => {
    it('ignores a booking whose scheduled end is at or before now (treated as missed)', () => {
      assert.deepEqual(run({ bookings: [bk('gone', -40, 30)] }).bookings, [], 'ended 10 minutes ago')
      assert.deepEqual(run({ bookings: [bk('edge', -30, 30)] }).bookings, [], 'ends exactly now')
    })
    it('keeps a booking that ends one millisecond after now', () => {
      const r = run({ bookings: [{ id: 'x', start: at(-30) + 1, durationMin: 30 }] })
      assert.equal(r.bookings.length, 1)
    })
    it('a missed booking does not push the next one', () => {
      const r = run({ bookings: [bk('gone', -40, 30), bk('next', 5)] })
      assert.deepEqual(r.bookings.map((b) => [b.id, b.delayMin]), [['next', 0]])
    })
  })

  describe(`${name}: warning rule (delay over 10 minutes, at least 15 minutes ahead, once)`, () => {
    const decide = (over) => warningDecision({ delayMs: 20 * MIN, start: at(60), now: NOW, taskExists: false, ...over })

    it('warns for a clear case', () => {
      assert.deepEqual(decide({}), { warn: true, reason: 'warn' })
    })
    it('10 minutes exactly is not over 10 minutes', () => {
      assert.deepEqual(decide({ delayMs: 10 * MIN }), { warn: false, reason: 'within_threshold' })
    })
    it('one millisecond over 10 minutes is over', () => {
      assert.equal(decide({ delayMs: 10 * MIN + 1 }).warn, true)
    })
    it('zero and small delays do not warn', () => {
      assert.equal(decide({ delayMs: 0 }).warn, false)
      assert.equal(decide({ delayMs: 9 * MIN }).warn, false)
    })
    it('exactly 15 minutes before the start is early enough', () => {
      assert.equal(decide({ start: NOW + 15 * MIN }).warn, true)
    })
    it('one millisecond inside 15 minutes is too late', () => {
      assert.deepEqual(decide({ start: NOW + 15 * MIN - 1 }), { warn: false, reason: 'too_late' })
    })
    it('a booking that has already started or passed is too late', () => {
      assert.equal(decide({ start: NOW }).reason, 'too_late')
      assert.equal(decide({ start: NOW - 5 * MIN }).reason, 'too_late')
    })
    it('never warns twice: an existing task blocks it', () => {
      assert.deepEqual(decide({ taskExists: true }), { warn: false, reason: 'already_exists' })
    })
    it('reason priority: within threshold, then already sent, then too late', () => {
      assert.equal(decide({ delayMs: 10 * MIN, start: NOW, taskExists: true }).reason, 'within_threshold')
      assert.equal(decide({ start: NOW, taskExists: true }).reason, 'already_exists')
    })
  })
}

describe('parity: the client copy gives exactly the server results', () => {
  const w = (id, joined, durationMin) => ({ id, joinedAt: at(joined), durationMin })
  const bk = (id, startMin, durationMin = 30) => ({ id, start: at(startMin), durationMin })
  const cases = {
    empty: {},
    overrun: { inService: [{ actualStart: at(-50), durationMin: 30 }], bookings: [bk('a', -5), bk('b', 25)], walkIns: [w('w', -3, 25)] },
    chain: { inService: [{ actualStart: at(0), durationMin: 30 }], bookings: [bk('a', 10), bk('b', 30), bk('c', 120)] },
    gaps: { bookings: [bk('a', 30), bk('b', 90)], walkIns: [w('w1', -10, 40), w('w2', -5, 10), w('w3', -5, 20)] },
    missed: { bookings: [bk('gone', -40), bk('edge', -30), bk('x', 5)], walkIns: [w('w', -1, 5)] },
    two: { inService: [{ actualStart: at(-10), durationMin: 30 }, { actualStart: at(0), durationMin: 45 }], bookings: [bk('a', 20)] },
    ties: { bookings: [bk('z', 10), bk('a', 10)], walkIns: [w('b', -5, 10), w('a', -5, 10)] },
  }
  for (const [name, input] of Object.entries(cases)) {
    it(`case "${name}"`, () => {
      const args = { now: NOW, inService: [], bookings: [], walkIns: [], ...input }
      assert.deepEqual(client.project(args), server.project(args))
    })
  }
  it('warningDecision agrees on the boundaries', () => {
    for (const delayMs of [0, 10 * MIN, 10 * MIN + 1, 30 * MIN]) {
      for (const start of [NOW - MIN, NOW + 15 * MIN - 1, NOW + 15 * MIN, NOW + 60 * MIN]) {
        for (const taskExists of [false, true]) {
          const a = { delayMs, start, now: NOW, taskExists }
          assert.deepEqual(client.warningDecision(a), server.warningDecision(a))
        }
      }
    }
  })
})

describe('src/lib/queue.js: what UI-B2 shows', () => {
  const { delayLabel, warningStatus, waitLabel } = client
  const start = NOW + 60 * MIN

  it('labels a delay in words, not by colour alone', () => {
    assert.equal(delayLabel(0), 'On time')
    assert.equal(delayLabel(1), 'Delayed 1 min')
    assert.equal(delayLabel(25), 'Delayed 25 min')
  })
  it('labels an estimated wait', () => {
    assert.equal(waitLabel(0), 'Next up')
    assert.equal(waitLabel(20), 'About 20 min')
  })
  it('says no warning is needed at 10 minutes or under', () => {
    const s = warningStatus({ delayMs: 10 * MIN, start, now: NOW, task: null })
    assert.equal(s.key, 'not_needed')
    assert.match(s.label, /No warning needed/)
  })
  it('says a warning is about to be written when the delay is over 10 minutes and there is still time', () => {
    const s = warningStatus({ delayMs: 10 * MIN + 1, start, now: NOW, task: null })
    assert.equal(s.key, 'pending_detection')
  })
  it('says why nothing was sent when it is too close to the start', () => {
    const s = warningStatus({ delayMs: 20 * MIN, start: NOW + 15 * MIN - 1, now: NOW, task: null })
    assert.equal(s.key, 'too_late')
    assert.match(s.label, /Not sent: too close to the start/)
  })
  it('reports the state of the delay task: queued, sent (with the time), failed, cancelled', () => {
    const base = { delayMs: 20 * MIN, start, now: NOW }
    assert.equal(warningStatus({ ...base, task: { status: 'pending' } }).key, 'queued')
    const sent = warningStatus({ ...base, task: { status: 'sent', sentAt: NOW } })
    assert.equal(sent.key, 'sent')
    assert.match(sent.label, /^Warning sent \d{1,2}:\d{2}/)
    assert.match(warningStatus({ ...base, task: { status: 'failed' } }).label, /failed after 3 attempts/)
    assert.equal(warningStatus({ ...base, task: { status: 'cancelled' } }).key, 'cancelled')
  })
  it('keeps showing "sent" after the delay has gone: the warning was still sent', () => {
    const s = warningStatus({ delayMs: 0, start, now: NOW, task: { status: 'sent', sentAt: NOW } })
    assert.equal(s.key, 'sent')
  })
})
