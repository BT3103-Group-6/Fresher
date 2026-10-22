// FR-09 pure rules from functions/notifications.js and messaging.js (decisions A4 addendum): which reminders
// are created, and how tasks are recalculated or cancelled. A fake transaction records the writes, so no
// emulator is needed.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const fromFunctions = createRequire(new URL('../functions/package.json', import.meta.url))
const { FieldValue, Timestamp } = fromFunctions('firebase-admin/firestore')
const n = createRequire(import.meta.url)('../functions/notifications.js')
const { mockProvider } = createRequire(import.meta.url)('../functions/messaging.js')

const MIN = 60e3
const HOUR = 60 * MIN
const NOW = Date.UTC(2030, 0, 7, 3, 0)
const ts = (ms) => Timestamp.fromMillis(ms)

describe('planReminders (A4: skip reminders that would already be in the past)', () => {
  const types = (start) => n.planReminders(start, NOW).map((r) => r.type)

  it('a booking well ahead gets both reminders at start - 24 h and start - 2 h', () => {
    const start = NOW + 48 * HOUR
    assert.deepEqual(n.planReminders(start, NOW), [
      { type: 'reminder24h', dueAt: start - 24 * HOUR },
      { type: 'reminder2h', dueAt: start - 2 * HOUR },
    ])
  })
  it('exactly 24 h ahead still gets the 24 h reminder; 1 ms less skips it', () => {
    assert.deepEqual(types(NOW + 24 * HOUR), ['reminder24h', 'reminder2h'])
    assert.deepEqual(types(NOW + 24 * HOUR - 1), ['reminder2h'])
  })
  it('exactly 2 h ahead still gets the 2 h reminder; 1 ms less skips both', () => {
    assert.deepEqual(types(NOW + 2 * HOUR), ['reminder2h'])
    assert.deepEqual(types(NOW + 2 * HOUR - 1), [])
  })
})

/** Records what writeTasks / cancelTasks do, keyed by document path. */
function fakeTx() {
  const ops = {}
  return {
    ops,
    set: (ref, data) => { ops[ref.path] = { op: 'set', data } },
    update: (ref, data) => { ops[ref.path] = { op: 'update', data } },
  }
}
const db = { doc: (path) => ({ path }) }
const apt = (start) => ({ requestId: 'bk1', shopId: 's1', barberId: 'b1', start: ts(start) })
const path = (type) => `notifications/bk1_${type}`
const existingOf = (data) => Object.fromEntries(n.TYPES.map((t) => [t, { ref: { path: path(t) }, data: data[t] ?? null }]))
const task = (type, over = {}) => ({ type, status: 'pending', rev: 1, attempts: [], dueAt: ts(NOW), nextAttemptAt: ts(NOW), ...over })

describe('writeTasks on confirmation', () => {
  it('creates the confirmation (due now) and both reminders with deterministic IDs', () => {
    const start = NOW + 48 * HOUR
    const tx = fakeTx()
    n.writeTasks(tx, db, apt(start), null, NOW)
    assert.deepEqual(Object.keys(tx.ops).sort(), [path('confirmation'), path('reminder24h'), path('reminder2h')].sort())
    const c = tx.ops[path('confirmation')].data
    assert.equal(c.dueAt.toMillis(), NOW)
    assert.equal(c.nextAttemptAt.toMillis(), NOW)
    assert.equal(c.status, 'pending')
    assert.equal(c.rev, 1)
    assert.equal(c.plannedAt.toMillis(), NOW)
    assert.deepEqual(c.attempts, [])
    assert.deepEqual([c.bookingId, c.shopId, c.barberId, c.channel], ['bk1', 's1', 'b1', 'sms'])
    assert.equal(c.apptStart.toMillis(), start)
    assert.equal(tx.ops[path('reminder24h')].data.dueAt.toMillis(), start - 24 * HOUR)
    assert.equal(tx.ops[path('reminder2h')].data.nextAttemptAt.toMillis(), start - 2 * HOUR)
  })
  it('creates no task for a reminder that would already be past', () => {
    const tx = fakeTx()
    n.writeTasks(tx, db, apt(NOW + 5 * HOUR), null, NOW)
    assert.deepEqual(Object.keys(tx.ops).sort(), [path('confirmation'), path('reminder2h')].sort())
    const short = fakeTx()
    n.writeTasks(short, db, apt(NOW + 1 * HOUR), null, NOW)
    assert.deepEqual(Object.keys(short.ops), [path('confirmation')])
  })
  it('stores no phone number on a task', () => {
    const tx = fakeTx()
    n.writeTasks(tx, db, apt(NOW + 48 * HOUR), null, NOW)
    assert.doesNotMatch(JSON.stringify(Object.values(tx.ops)), /phone|\+65/i)
  })
})

describe('writeTasks on reschedule (recalculation)', () => {
  it('moves both reminders to the new start and bumps rev; attempts are not touched', () => {
    const oldStart = NOW + 48 * HOUR
    const newStart = NOW + 72 * HOUR
    const existing = existingOf({
      confirmation: task('confirmation', { status: 'sent', nextAttemptAt: null }),
      reminder24h: task('reminder24h', { dueAt: ts(oldStart - 24 * HOUR) }),
      reminder2h: task('reminder2h', { dueAt: ts(oldStart - 2 * HOUR), rev: 3 }),
    })
    const tx = fakeTx()
    n.writeTasks(tx, db, apt(newStart), existing, NOW)
    const r24 = tx.ops[path('reminder24h')].data
    assert.equal(tx.ops[path('reminder24h')].op, 'update')
    assert.equal(r24.dueAt.toMillis(), newStart - 24 * HOUR)
    assert.equal(r24.nextAttemptAt.toMillis(), newStart - 24 * HOUR)
    assert.equal(r24.rev, 2)
    assert.equal(r24.status, 'pending')
    assert.equal(tx.ops[path('reminder2h')].data.rev, 4)
    for (const { data } of Object.values(tx.ops)) assert.equal('attempts' in data, false)
    // The confirmation keeps its status; it only follows the new start and records when it was re-planned.
    assert.deepEqual(Object.keys(tx.ops[path('confirmation')].data).sort(), ['apptStart', 'plannedAt'])
    assert.equal(tx.ops[path('confirmation')].data.apptStart.toMillis(), newStart)
    assert.equal(tx.ops[path('confirmation')].data.plannedAt.toMillis(), NOW)
  })
  it('sends a reminder again for the new time even if it was already sent for the old one', () => {
    const existing = existingOf({
      confirmation: task('confirmation', { status: 'sent' }),
      reminder24h: task('reminder24h', { status: 'sent', attempts: [{ outcome: 'sent' }] }),
      reminder2h: task('reminder2h', { status: 'failed' }),
    })
    const tx = fakeTx()
    n.writeTasks(tx, db, apt(NOW + 72 * HOUR), existing, NOW)
    assert.equal(tx.ops[path('reminder24h')].data.status, 'pending')
    assert.equal(tx.ops[path('reminder2h')].data.status, 'pending')
  })
  it('cancels a reminder that would now be in the past, keeping the doc and its log', () => {
    const existing = existingOf({
      confirmation: task('confirmation', { status: 'sent' }),
      reminder24h: task('reminder24h', { attempts: [{ outcome: 'failed' }] }),
      reminder2h: task('reminder2h'),
    })
    const tx = fakeTx()
    n.writeTasks(tx, db, apt(NOW + 10 * HOUR), existing, NOW)
    const r24 = tx.ops[path('reminder24h')].data
    assert.equal(r24.status, 'cancelled')
    assert.equal(r24.cancelReason, 'past_due')
    assert.ok(r24.nextAttemptAt instanceof FieldValue)
    assert.equal(tx.ops[path('reminder24h')].op, 'update') // never deleted
    assert.equal(tx.ops[path('reminder2h')].data.status, 'pending')
  })
  it('creates a reminder that was skipped at booking time once the new start is far enough ahead', () => {
    const existing = existingOf({ confirmation: task('confirmation', { status: 'sent' }), reminder2h: task('reminder2h') })
    const tx = fakeTx()
    const start = NOW + 30 * HOUR
    n.writeTasks(tx, db, apt(start), existing, NOW)
    const r24 = tx.ops[path('reminder24h')]
    assert.equal(r24.op, 'set')
    assert.equal(r24.data.dueAt.toMillis(), start - 24 * HOUR)
    assert.equal(r24.data.rev, 1)
  })
  it('leaves an already cancelled reminder alone when it is still in the past', () => {
    const existing = existingOf({
      confirmation: task('confirmation', { status: 'sent' }),
      reminder2h: task('reminder2h', { status: 'cancelled' }),
    })
    const tx = fakeTx()
    n.writeTasks(tx, db, apt(NOW + 1 * HOUR), existing, NOW)
    assert.equal(path('reminder2h') in tx.ops, false)
  })
})

describe('cancelTasks', () => {
  it('cancels pending tasks only; sent, failed and cancelled ones keep their status', () => {
    const existing = existingOf({
      confirmation: task('confirmation', { status: 'sent' }),
      reminder24h: task('reminder24h', { status: 'failed' }),
      reminder2h: task('reminder2h'),
    })
    const tx = fakeTx()
    n.cancelTasks(tx, existing)
    assert.deepEqual(Object.keys(tx.ops), [path('reminder2h')])
    const t = tx.ops[path('reminder2h')].data
    assert.equal(t.status, 'cancelled')
    assert.equal(t.cancelReason, 'booking_cancelled')
    assert.ok(t.nextAttemptAt instanceof FieldValue)
  })
  it('does nothing when the booking has no tasks', () => {
    const tx = fakeTx()
    n.cancelTasks(tx, existingOf({}))
    assert.deepEqual(tx.ops, {})
  })
})

describe('messageBody and the mock provider', () => {
  it('says what the message is for and when, in Singapore time', () => {
    const start = Date.UTC(2030, 0, 7, 2, 0) // 10:00 Singapore
    assert.match(n.messageBody('confirmation', start), /confirmed/)
    assert.match(n.messageBody('reminder24h', start), /24 hours/)
    assert.match(n.messageBody('reminder2h', start), /2 hours/)
    assert.match(n.messageBody('confirmation', start), /10:00/)
  })
  it('succeeds and logs (masked number), except for numbers ending 0000, which always fail', async () => {
    const logs = []
    const p = mockProvider((msg, data) => logs.push([msg, data]))
    assert.deepEqual(await p.send({ to: '+6591234567', body: 'hi', key: 'k1' }), { ok: true, providerRef: 'mock-k1' })
    assert.deepEqual(await p.send({ to: '+6591230000', body: 'hi', key: 'k2' }), { ok: false, error: 'MOCK_DELIVERY_FAILED' })
    assert.equal(logs.length, 2)
    assert.equal(logs.some(([, d]) => JSON.stringify(d).includes('91234567')), false)
  })
})
