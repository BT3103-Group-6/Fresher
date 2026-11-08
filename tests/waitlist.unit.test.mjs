// FR-15 pure rules from functions/waitlist.js (decisions A6 addendum): entry IDs, the bookable dates, the
// 15-minute lead time, what a schedule write freed, and the strict fit. No emulator needed.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const req = createRequire(import.meta.url)
const w = req('../functions/waitlist.js')
const n = req('../functions/notifications.js')

const MIN = 60e3
const HOUR = 60 * MIN
const SG = 8 * HOUR
const at = (hh, mm = 0, day = 7) => Date.UTC(2030, 0, day, hh, mm) - SG // Singapore time on 2030-01-0x
const r = (s, e) => ({ start: s, end: e })

describe('entryId: one active entry per customer, shop, service, date and barber', () => {
  it('is deterministic and names each part, with "any" for no barber', () => {
    assert.equal(w.entryId('u1', 'shopA', 'cut', '20300107', null), 'u1_shopA_cut_20300107_any')
    assert.equal(w.entryId('u1', 'shopA', 'cut', '20300107', 'b2'), 'u1_shopA_cut_20300107_b2')
    assert.equal(w.entryId('u1', 'shopA', 'cut', '20300107', ''), 'u1_shopA_cut_20300107_any')
  })
  it('differs when any part differs', () => {
    const base = ['u1', 'shopA', 'cut', '20300107', 'b1']
    const id = w.entryId(...base)
    for (let i = 0; i < base.length; i++) {
      const other = [...base]
      other[i] = `${base[i]}x`
      assert.notEqual(w.entryId(...other), id)
    }
  })
})

describe('entries expire at the end of the requested date (Singapore)', () => {
  it('dateEndMs is midnight at the end of that Singapore day', () => {
    assert.equal(w.dateEndMs('20300107'), at(0, 0, 8))
    assert.equal(w.dateEndMs('20301231'), Date.UTC(2031, 0, 1) - SG)
  })
  it('one millisecond before is still that day', () => {
    assert.equal(w.dateEndMs('20300107') - 1, at(23, 59, 7) + 59_999)
  })
})

describe('isBookableDate: today to +13 days, Singapore time', () => {
  const now = at(23, 30) // late on 7 Jan in Singapore, still 15:30 UTC that day
  it('accepts today and the last bookable day, refuses yesterday and the day after', () => {
    assert.equal(w.isBookableDate('20300107', now), true)
    assert.equal(w.isBookableDate('20300120', now), true)
    assert.equal(w.isBookableDate('20300106', now), false)
    assert.equal(w.isBookableDate('20300121', now), false)
  })
  it('rejects anything that is not eight digits, or not a real day', () => {
    for (const bad of [undefined, null, 20300107, '2030-01-07', '2030010', '203001071', '', '20300230', 'abcdefgh']) {
      assert.equal(w.isBookableDate(bad, now), false, String(bad))
    }
  })
  it('follows the Singapore date, not UTC', () => {
    // 00:30 on 8 Jan Singapore is still 7 Jan in UTC.
    assert.equal(w.isBookableDate('20300108', at(0, 30, 8)), true)
    assert.equal(w.isBookableDate('20300107', at(0, 30, 8)), false)
  })
})

describe('offerLeadOk: an offer needs the slot to start at least 15 minutes later', () => {
  const start = at(15, 0)
  it('exactly 15 minutes ahead is allowed', () => assert.equal(w.offerLeadOk(start, start - 15 * MIN), true))
  it('one millisecond less than 15 minutes is not', () => assert.equal(w.offerLeadOk(start, start - 15 * MIN + 1), false))
  it('one millisecond more than 15 minutes is allowed', () => assert.equal(w.offerLeadOk(start, start - 15 * MIN - 1), true))
  it('a slot already started, or starting now, is not', () => {
    assert.equal(w.offerLeadOk(start, start), false)
    assert.equal(w.offerLeadOk(start, start + MIN), false)
  })
  it('the claim window closes before the appointment starts: a 15-minute offer made at the earliest allowed moment ends exactly at the start', () => {
    const now = start - w.LEAD_MS
    assert.equal(now + w.OFFER_MS, start)
    assert.equal(w.LEAD_MS >= w.OFFER_MS, true)
  })
})

describe('mergeRanges', () => {
  it('sorts, and merges overlapping and touching ranges', () => {
    assert.deepEqual(w.mergeRanges([r(30, 40), r(0, 10), r(10, 20), r(15, 18)]), [r(0, 20), r(30, 40)])
  })
  it('drops empty ranges and does not change its input', () => {
    const input = [r(5, 5), r(1, 2)]
    assert.deepEqual(w.mergeRanges(input), [r(1, 2)])
    assert.deepEqual(input, [r(5, 5), r(1, 2)])
  })
})

describe('freedRanges: what a schedule write freed', () => {
  it('a cancelled booking frees its whole interval', () => {
    assert.deepEqual(w.freedRanges([r(at(10), at(10, 30))], []), [r(at(10), at(10, 30))])
  })
  it('turning a hold into a booking frees nothing', () => {
    assert.deepEqual(w.freedRanges([r(at(10), at(10, 30))], [r(at(10), at(10, 30))]), [])
  })
  it('adding an interval frees nothing', () => {
    assert.deepEqual(w.freedRanges([r(at(10), at(10, 30))], [r(at(10), at(10, 30)), r(at(12), at(12, 30))]), [])
  })
  it('a removed block frees the block\'s time', () => {
    assert.deepEqual(w.freedRanges([r(at(13), at(15)), r(at(10), at(10, 30))], [r(at(10), at(10, 30))]), [r(at(13), at(15))])
  })
  it('a moved booking frees the old time, not the new', () => {
    assert.deepEqual(w.freedRanges([r(at(10), at(10, 30))], [r(at(14), at(14, 30))]), [r(at(10), at(10, 30))])
  })
  it('partly covered time frees only the uncovered part, on both sides', () => {
    // A 10:00-12:00 block shrinks to 10:30-11:30.
    assert.deepEqual(w.freedRanges([r(at(10), at(12))], [r(at(10, 30), at(11, 30))]), [r(at(10), at(10, 30)), r(at(11, 30), at(12))])
  })
  it('two adjacent cancellations arrive as one merged range', () => {
    assert.deepEqual(w.freedRanges([r(at(10), at(10, 30)), r(at(10, 30), at(11))], []), [r(at(10), at(11))])
  })
  it('two separate cancellations arrive as two ranges, in order', () => {
    assert.deepEqual(w.freedRanges([r(at(15), at(15, 30)), r(at(10), at(10, 30))], []), [r(at(10), at(10, 30)), r(at(15), at(15, 30))])
  })
  it('time still covered by another interval is not freed', () => {
    assert.deepEqual(w.freedRanges([r(at(10), at(10, 30)), r(at(10, 15), at(10, 45))], [r(at(10, 15), at(10, 45))]), [r(at(10), at(10, 15))])
  })
  it('nothing before and nothing after frees nothing', () => assert.deepEqual(w.freedRanges([], []), []))
})

describe('fitsDuration (strict fit, limitation L27)', () => {
  it('the freed interval by itself must last at least the service duration', () => {
    assert.equal(w.fitsDuration(r(at(10), at(10, 30)), 30), true)
    assert.equal(w.fitsDuration(r(at(10), at(10, 30)) , 45), false)
    assert.equal(w.fitsDuration(r(at(10), at(10, 45)), 30), true)
  })
  it('is exact at the boundary', () => {
    assert.equal(w.fitsDuration(r(0, 30 * MIN), 30), true)
    assert.equal(w.fitsDuration(r(0, 30 * MIN - 1), 30), false)
  })
})

describe('the offer notification', () => {
  it('builds a pending waitlistOffer task keyed to the offer, without a phone number', () => {
    const { Timestamp } = createRequire(new URL('../functions/package.json', import.meta.url))('firebase-admin/firestore')
    const apt = { requestId: 'offer-appointment-id-0001', shopId: 's1', barberId: 'b1', start: Timestamp.fromMillis(at(10)) }
    const task = n.offerTask(apt, 'entry1', at(9))
    assert.deepEqual([task.type, task.bookingId, task.entryId, task.status, task.rev, task.channel], ['waitlistOffer', apt.requestId, 'entry1', 'pending', 1, 'sms'])
    assert.equal(task.nextAttemptAt.toMillis(), at(9))
    assert.equal(task.apptStart.toMillis(), at(10))
    assert.doesNotMatch(JSON.stringify(task), /phone|\+65/i)
  })
  it('is not one of the booking task types, so reminders and cancellation never touch it', () => {
    assert.equal(n.TYPES.includes('waitlistOffer'), false)
  })
  it('the message names the slot and the 15-minute window', () => {
    const text = n.messageBody('waitlistOffer', at(10))
    assert.match(text, /waitlist/)
    assert.match(text, /10:00/)
    assert.match(text, /15 minutes/)
  })
})
