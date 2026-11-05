// UI-C5 Deposit checkout (FR-13, decisions A6 addendum). Pure, so it is unit-tested without Firebase.
// The server decides everything (deadline, amount, outcome); these helpers only decide what to show.

export const money = (cents) => `S$${(cents / 100).toFixed(2)}`

/** The deposit for a snapshot price: 50%, rounded up to the nearest 10 cents. Display only; the server sets the real amount. */
export const depositAmountCents = (priceCents) => Math.ceil(priceCents / 20) * 10

/**
 * Time left until the payment deadline (epoch ms). `text` is "m:ss" for the visible timer; `spoken` says it in
 * words for assistive technology. Zero and below is expired (the deadline instant itself is expired, matching the server).
 */
export function countdown(deadline, now) {
  const remainingMs = Math.max(0, (deadline ?? 0) - now)
  const totalSeconds = Math.ceil(remainingMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
  return {
    remainingMs,
    expired: remainingMs === 0,
    text: `${minutes}:${String(seconds).padStart(2, '0')}`,
    spoken: minutes ? `${plural(minutes, 'minute')} ${plural(seconds, 'second')}` : plural(seconds, 'second'),
  }
}

/** Why a deposit is needed, in plain words. */
export function reasonText(noShowCount, shopName) {
  const where = shopName ? ` at ${shopName}` : ' at this shop'
  const n = Number.isInteger(noShowCount) && noShowCount > 0 ? noShowCount : 2
  return `You have missed ${n} appointments${where}, so a deposit is needed to keep this slot. ` +
    'It is refundable when you attend.'
}

/**
 * Which screen state the checkout is in, from the live appointment and deposit.
 * awaiting: pay now; timed-out: the deadline passed and the server is about to release the slot;
 * confirmed: paid, booking confirmed; released: slot released, nothing was taken;
 * paid-late: paid after the slot was released (marked refundable); unavailable: anything else.
 */
export function checkoutState({ bookingStatus, depositStatus, paidAfterExpiry, deadline }, now) {
  if (depositStatus === 'refundable' && paidAfterExpiry && bookingStatus === 'EXPIRED') return 'paid-late'
  if (bookingStatus === 'PENDING_PAYMENT') return deadline != null && deadline > now ? 'awaiting' : 'timed-out'
  if (bookingStatus === 'CONFIRMED' || bookingStatus === 'IN_SERVICE' || bookingStatus === 'COMPLETED') return 'confirmed'
  if (bookingStatus === 'EXPIRED') return 'released'
  return 'unavailable'
}

export const CHECKOUT_MESSAGES = {
  awaiting: 'Pay before the timer runs out to keep your slot.',
  'timed-out': 'The payment time has run out. Your slot is being released.',
  confirmed: 'Payment received. Your booking is confirmed.',
  released: 'Your slot was released and nothing was charged. You can choose a time again.',
  'paid-late': 'Your payment arrived after the slot was released. The slot is not held, and the deposit is marked refundable.',
  unavailable: 'This booking cannot be paid for.',
}

/** Buttons are only offered while the customer can still pay. */
export const canPay = (state) => state === 'awaiting'
