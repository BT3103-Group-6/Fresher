// UI-C6 Waitlist (FR-15, decisions A6 addendum). Pure, so it is unit-tested without Firebase.
// The server decides every outcome (matching, the 15-minute hold, claiming); these helpers only decide
// what to show. Entries are plain objects with times in epoch ms.

export const OFFER_MINUTES = 15

/** Firestore waitlist doc (Timestamps) -> plain fields. */
export function toEntry(id, data) {
  const ms = (t) => (t ? t.toMillis() : null)
  return {
    id,
    shopId: data.shopId,
    serviceId: data.serviceId,
    barberId: data.barberId ?? null,
    date: data.date,
    status: data.status,
    joinedAt: ms(data.joinedAt),
    offerSlot: data.offerSlot
      ? { barberId: data.offerSlot.barberId, start: ms(data.offerSlot.start), end: ms(data.offerSlot.end) }
      : null,
    offerExpiresAt: ms(data.offerExpiresAt),
    claimedBookingId: data.claimedBookingId ?? null,
    expireReason: data.expireReason ?? null,
  }
}

/**
 * What to show for an entry. An offer whose 15 minutes are up is `offer-lapsed` at once, even though the sweep
 * (which marks the entry expired) may not have run yet: nothing can be claimed at or after the deadline.
 */
export function entryState(entry, now) {
  if (entry.status === 'offered') {
    return entry.offerExpiresAt != null && entry.offerExpiresAt > now ? 'offered' : 'offer-lapsed'
  }
  return entry.status // waiting | claimed | expired
}

/** The Claim button is offered only for a live offer. */
export const canClaim = (entry, now) => entryState(entry, now) === 'offered'

export const STATE_LABELS = {
  waiting: 'On the waitlist',
  offered: 'Slot offered',
  'offer-lapsed': 'Offer ended',
  claimed: 'Claimed',
  expired: 'Expired',
}

export const STATE_MESSAGES = {
  waiting: 'We will text you if a slot opens that fits.',
  offered: `A slot opened. It is held for you for ${OFFER_MINUTES} minutes.`,
  'offer-lapsed': 'The offer ended before it was claimed, so it went to the next person. You can join again.',
  claimed: 'You claimed the slot.',
  expired: 'This waitlist entry has ended.',
}

/** Why an entry ended, in words (only for expired entries). */
export function expiredText(entry) {
  if (entry.expireReason === 'offer_lapsed') return 'An offer was not claimed in time, so this entry ended. You can join again.'
  if (entry.expireReason === 'date_passed') return 'The date has passed, so this entry ended.'
  return STATE_MESSAGES.expired
}

/**
 * Entries in display order: live offers first (soonest deadline), then waiting by date, then finished ones
 * (newest date first). Ties by ID so the order is stable.
 */
export function sortEntries(entries, now) {
  const rank = (e) => {
    const s = entryState(e, now)
    return s === 'offered' ? 0 : s === 'waiting' ? 1 : 2
  }
  return [...entries].sort((a, b) => {
    const ra = rank(a)
    const rb = rank(b)
    if (ra !== rb) return ra - rb
    if (ra === 0) return a.offerExpiresAt - b.offerExpiresAt || a.id.localeCompare(b.id)
    if (ra === 1) return a.date.localeCompare(b.date) || a.joinedAt - b.joinedAt || a.id.localeCompare(b.id)
    return b.date.localeCompare(a.date) || a.id.localeCompare(b.id)
  })
}

/** Field-level checks for the join form. Returns { service?, name?, date? }; empty means valid. */
export function validateJoin({ serviceId, name, date }, dateKeys = []) {
  const errors = {}
  if (!serviceId) errors.service = 'Choose a service.'
  const trimmed = (name ?? '').trim()
  if (!trimmed) errors.name = 'Enter your name.'
  else if (trimmed.length > 80) errors.name = 'Name must be 80 characters or fewer.'
  if (!date) errors.date = 'Choose a date.'
  else if (dateKeys.length && !dateKeys.includes(date)) errors.date = 'Choose a date from the list.'
  return errors
}

/** Friendly text for a claimOffer failure, from the server's `details.reason`. */
export function claimErrorMessage(reason) {
  switch (reason) {
    case 'OFFER_EXPIRED': return 'This offer has ended, so the slot was passed on. You can join the waitlist again.'
    case 'OFFER_NOT_FOUND': return 'We could not find this offer on your number.'
    default: return 'That did not go through. Your offer is unchanged; check your connection and try again.'
  }
}
