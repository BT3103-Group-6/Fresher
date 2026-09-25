// UI-C4 booking lists and rebooking (FR-11, decisions A13). Pure, so it is unit-tested without Firebase.
// Appointments are plain objects with `start`/`end` in epoch ms.

const HISTORY_STATUSES = ['COMPLETED', 'CANCELLED', 'NO_SHOW']

/** CONFIRMED and not yet over (half-open: a booking ending exactly now is over). Oldest first. */
export function upcomingItems(appointments, now = Date.now()) {
  return appointments
    .filter((a) => a.status === 'CONFIRMED' && a.end > now)
    .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))
}

/** Finished, cancelled or missed bookings, plus CONFIRMED ones that ended without staff finalising them. Newest first. */
export function historyItems(appointments, now = Date.now()) {
  return appointments
    .filter((a) => HISTORY_STATUSES.includes(a.status) || (a.status === 'CONFIRMED' && a.end <= now))
    .sort((a, b) => b.start - a.start || a.id.localeCompare(b.id))
}

/** Label for a history item; a never-finalised CONFIRMED booking is neither attended nor missed. */
export function historyLabel(a) {
  switch (a.status) {
    case 'COMPLETED': return 'Completed'
    case 'CANCELLED': return 'Cancelled'
    case 'NO_SHOW': return 'No-show'
    default: return 'Past booking'
  }
}

/**
 * What a rebook may pre-fill. `service` and `barber` are the current docs (null when missing or unreadable),
 * `shopAvailable` is false when the shop cannot be read (not verified). The barber is kept only with the
 * service, because UI-C2 lists barbers per service.
 * Returns { canRebook, serviceId, barberId ('any' or an ID), notes[] }.
 */
export function resolveRebook({ serviceId, barberId, service, barber, shopAvailable = true }) {
  if (!shopAvailable) {
    return { canRebook: false, serviceId: '', barberId: 'any', notes: ['This shop is no longer available.'] }
  }
  const serviceOk = !!service && service.active === true
  if (!serviceOk) {
    const notes = [`${service?.name ?? 'This service'} is no longer offered, so please choose a service.`]
    if (barber) notes.push('Choose a barber after picking a service.')
    return { canRebook: true, serviceId: '', barberId: 'any', notes }
  }
  const notes = []
  let keep = barberId
  const barberName = barber?.displayName ?? 'That barber'
  if (!barber || barber.active !== true) {
    keep = 'any'
    notes.push(`${barberName} is no longer available, so any barber is selected.`)
  } else if (!Array.isArray(barber.serviceIds) || !barber.serviceIds.includes(serviceId)) {
    keep = 'any'
    notes.push(`${barberName} no longer offers ${service.name}, so any barber is selected.`)
  }
  return { canRebook: true, serviceId, barberId: keep, notes }
}
