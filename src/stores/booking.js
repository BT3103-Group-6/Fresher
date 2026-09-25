import { reactive } from 'vue'

// The customer's in-progress booking, shared by UI-C2 (choose) and UI-C3 (verify and confirm).
// It lives outside the views so entered data survives a recoverable failure (NFR-05): SLOT_TAKEN,
// a wrong OTP, or a lost connection all leave the draft intact. It is not persisted across reloads.
export const draft = reactive(blank())

function blank() {
  return {
    shopId: '',
    serviceId: '',
    barberId: 'any', // a barber ID or "any"
    dateKey: '',
    start: null, // chosen slot, epoch ms
    requestId: '', // one per attempt; reused on retry so holdSlot is idempotent
    hold: null, // holdSlot result, present once the slot is held
    name: '',
    phone: '',
    notice: '', // message shown when the user is sent back to UI-C2
  }
}

export function resetDraft(keep = {}) {
  Object.assign(draft, blank(), keep)
}

/** A new attempt gets a new requestId; a retry of the same attempt keeps it. */
export function ensureRequestId() {
  if (!draft.requestId) draft.requestId = crypto.randomUUID()
  return draft.requestId
}

export function newAttempt() {
  draft.requestId = ''
  draft.hold = null
}
