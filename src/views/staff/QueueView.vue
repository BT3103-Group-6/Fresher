<script setup>
// UI-B2 Queue management (FR-10). Shows the service in progress, the walk-in queue and every upcoming booking's
// projected delay and warning status for one barber. Barbers see only their own queue; owners pick a barber.
// Walk-ins are not schedule intervals (decisions A5 addendum): bookings come first, so waiting walk-ins never
// delay a booking and get a separate estimated wait. The projection is recalculated here as time passes with
// src/lib/queue.js, a copy of the server's function; the server writes the warnings (one per booking, mock SMS).
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { Timestamp, collection, getDocs, onSnapshot, query, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/firebase'
import { isOwner, session } from '@/stores/session'
import { formatTime } from '@/lib/slots'
import { toAppointment } from '@/lib/schedule'
import { delayLabel, project, projectionInput, toDelayTask, toWalkIn, waitLabel, warningStatus } from '@/lib/queue'

const HOUR = 3600e3
const shopId = session.claims.shopId
const ownerMode = isOwner()
const call = {
  add: httpsCallable(functions, 'addWalkIn'),
  startWalkIn: httpsCallable(functions, 'startWalkIn'),
  finishWalkIn: httpsCallable(functions, 'finishWalkIn'),
  removeWalkIn: httpsCallable(functions, 'removeWalkIn'),
  startService: httpsCallable(functions, 'startService'),
  finishService: httpsCallable(functions, 'finishService'),
}

const barbers = ref([]) // owners only
const barberId = ref(ownerMode ? '' : session.claims.barberId)
const services = ref({}) // id -> {name, durationMin, active}
const barberDoc = ref(null) // the chosen barber's serviceIds, for the add form
const appointments = ref([])
const walkIns = ref([])
const delayTasks = ref([])
const loaded = reactive({ appointments: false, queue: false, barbers: !ownerMode })
const loadError = ref('')
const warningError = ref('')
const now = ref(Date.now())
const online = ref(navigator.onLine)

const barberName = computed(() => barbers.value.find((b) => b.id === barberId.value)?.displayName ?? '')
const serviceName = (id) => services.value[id]?.name ?? 'Service'
const range = (s, e) => `${formatTime(s)} to ${formatTime(e)}`

// ---- Live data: the same 12 h back, 24 h ahead window the server uses ----
const unsubs = []
let barbersUnsub = null
const stopAll = () => unsubs.splice(0).forEach((u) => u())
function subscribe() {
  stopAll()
  Object.assign(loaded, { appointments: false, queue: false })
  appointments.value = []
  walkIns.value = []
  delayTasks.value = []
  warningError.value = ''
  if (!barberId.value) return
  const t = Date.now()
  const from = Timestamp.fromMillis(t - 12 * HOUR)
  const to = Timestamp.fromMillis(t + 24 * HOUR)
  const onError = () => { loadError.value = 'Could not load the queue. Check your connection.' }
  // The equality clauses on shopId and barberId are what the Security Rules check.
  unsubs.push(
    onSnapshot(
      query(collection(db, 'appointments'), where('shopId', '==', shopId), where('barberId', '==', barberId.value), where('start', '>=', from), where('start', '<', to)),
      (snap) => { appointments.value = snap.docs.map((d) => toAppointment(d.id, d.data())); loaded.appointments = true; loadError.value = '' },
      onError,
    ),
    onSnapshot(
      query(collection(db, `shops/${shopId}/queue`), where('barberId', '==', barberId.value), where('status', 'in', ['waiting', 'in_service'])),
      (snap) => { walkIns.value = snap.docs.map((d) => toWalkIn(d.id, d.data())); loaded.queue = true },
      onError,
    ),
    // Warning status is secondary: if it cannot load, the rest of the screen still works.
    onSnapshot(
      query(collection(db, 'notifications'), where('shopId', '==', shopId), where('barberId', '==', barberId.value), where('apptStart', '>=', from), where('apptStart', '<', to)),
      (snap) => {
        delayTasks.value = snap.docs.filter((d) => d.data().type === 'delay').map((d) => toDelayTask(d.id, d.data()))
        warningError.value = ''
      },
      () => { warningError.value = 'Warning status could not be loaded.' },
    ),
  )
}
watch(barberId, () => {
  barberDoc.value = barbers.value.find((b) => b.id === barberId.value) ?? null
  subscribe()
})

let ticker
const setOnline = () => { online.value = navigator.onLine }
onMounted(async () => {
  window.addEventListener('online', setOnline)
  window.addEventListener('offline', setOnline)
  ticker = setInterval(() => { now.value = Date.now() }, 15000)
  try {
    const svc = await getDocs(collection(db, `shops/${shopId}/services`))
    services.value = Object.fromEntries(svc.docs.map((d) => [d.id, { name: d.data().name, durationMin: d.data().durationMin, active: d.data().active }]))
  } catch { /* names are a nicety; rows fall back to a generic label */ }
  barbersUnsub = onSnapshot(collection(db, `shops/${shopId}/barbers`), (snap) => {
    const all = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.displayName.localeCompare(b.displayName))
    if (ownerMode) {
      barbers.value = all
      loaded.barbers = true
      if (!barberId.value) barberId.value = (all.find((b) => b.active) ?? all[0])?.id ?? ''
    }
    barberDoc.value = all.find((b) => b.id === barberId.value) ?? null
  }, () => { loadError.value = 'Could not load barbers. Check your connection.' })
  subscribe()
})
onUnmounted(() => {
  clearInterval(ticker)
  window.removeEventListener('online', setOnline)
  window.removeEventListener('offline', setOnline)
  stopAll()
  barbersUnsub?.()
})

// ---- The projection (same function as the server) ----
const projection = computed(() => project(projectionInput(now.value, appointments.value, walkIns.value)))
const taskOf = computed(() => Object.fromEntries(delayTasks.value.map((t) => [t.bookingId, t])))
const byId = (list) => Object.fromEntries(list.map((x) => [x.id, x]))
const upcoming = computed(() => {
  const apts = byId(appointments.value)
  return projection.value.bookings.map((p) => {
    const a = apts[p.id]
    return {
      ...p, apt: a,
      status: warningStatus({ delayMs: p.delayMs, start: p.start, now: now.value, task: taskOf.value[p.id] ?? null }),
    }
  })
})
const nowServing = computed(() => [
  ...appointments.value.filter((a) => a.status === 'IN_SERVICE' && a.actualStart != null).map((a) => ({
    kind: 'booking', id: a.id, name: a.customerName ?? 'Customer', service: serviceName(a.serviceId), started: a.actualStart, durationMin: a.durationMin,
  })),
  ...walkIns.value.filter((w) => w.status === 'in_service' && w.actualStart != null).map((w) => ({
    kind: 'walkin', id: w.id, name: w.walkInName, service: serviceName(w.serviceId), started: w.actualStart, durationMin: w.durationMin,
  })),
])
const expectedEnd = (s) => s.started + s.durationMin * 60e3
const overrunMin = (s) => (now.value > expectedEnd(s) ? Math.ceil((now.value - expectedEnd(s)) / 60e3) : 0)
const waiting = computed(() => {
  const waits = byId(projection.value.walkIns)
  return walkIns.value.filter((w) => w.status === 'waiting')
    .sort((a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : 1))
    .map((w) => ({ ...w, wait: waits[w.id] }))
})
const ready = computed(() => loaded.barbers && loaded.appointments && loaded.queue)
const busy = computed(() => nowServing.value.length > 0)
const offered = computed(() => (barberDoc.value?.serviceIds ?? [])
  .filter((id) => services.value[id]?.active)
  .map((id) => ({ id, ...services.value[id] })))

// ---- Add a walk-in ----
const form = reactive({ name: '', serviceId: '' })
const errors = ref({})
const formError = ref('')
const adding = ref(false)
let requestId = null // reused when the same walk-in is retried, so a retry cannot queue two
watch(() => [form.name, form.serviceId, barberId.value], () => { requestId = null })
watch(offered, (list) => { if (form.serviceId && !list.some((s) => s.id === form.serviceId)) form.serviceId = '' })

const addMessages = {
  SERVICE_UNAVAILABLE: 'That barber does not offer that service. Choose another.',
  BARBER_UNAVAILABLE: 'That barber is not available.',
  BARBER_NOT_FOUND: 'That barber was not found.',
  BUSY: 'We are busy right now. Please try again in a moment.',
}
async function onAdd() {
  formError.value = ''
  errors.value = {}
  const name = form.name.trim()
  if (!name) errors.value.name = 'Enter the walk-in’s name.'
  else if (name.length > 60) errors.value.name = 'Use 60 characters or fewer.'
  if (!form.serviceId) errors.value.service = 'Choose a service.'
  if (!barberId.value) formError.value = 'Choose a barber first.'
  if (Object.keys(errors.value).length || formError.value) return
  adding.value = true
  requestId ??= crypto.randomUUID()
  try {
    await call.add({ requestId, barberId: barberId.value, walkInName: name, serviceId: form.serviceId })
    requestId = null
    Object.assign(form, { name: '', serviceId: '' })
  } catch (err) {
    // Everything entered stays put; only the message changes.
    const d = err.details ?? {}
    if (err.code === 'functions/invalid-argument' && d.field === 'walkInName') errors.value = { name: err.message }
    else if (err.code === 'functions/permission-denied') formError.value = 'You can only add to your own queue.'
    else formError.value = addMessages[d.reason] ?? 'Could not add the walk-in. Your entries are kept. Check your connection and try again.'
  } finally {
    adding.value = false
  }
}

// ---- Start, finish, remove ----
const actionMessages = {
  BARBER_BUSY: 'This barber already has someone in service. Finish that first.',
  TOO_EARLY: 'It is too early to start this booking.',
  INVALID_STATE: 'This has changed. The list has been updated.',
  WALKIN_NOT_FOUND: 'You cannot change this walk-in.',
  BOOKING_NOT_FOUND: 'You cannot change this booking.',
  BUSY: 'We are busy right now. Please try again in a moment.',
}
const acting = ref('') // `${id}:${action}` while a call is in flight
const armed = ref('') // remove needs a second click
const rowErrors = ref({}) // id -> message
async function run(id, action) {
  if (action === 'removeWalkIn' && armed.value !== id) { armed.value = id; return }
  rowErrors.value = { ...rowErrors.value, [id]: '' }
  acting.value = `${id}:${action}`
  try {
    await call[action]({ requestId: id })
    armed.value = ''
  } catch (err) {
    rowErrors.value = {
      ...rowErrors.value,
      [id]: err.code === 'functions/permission-denied'
        ? 'You cannot change this.'
        : actionMessages[err.details?.reason] ?? 'Could not save. Check your connection and try again.',
    }
    armed.value = ''
  } finally {
    acting.value = ''
  }
}
const canStartBooking = (b) => now.value >= b.start - HOUR // matches the server guard (FR-12)
</script>

<template>
  <main class="queue">
    <header class="page-head">
      <h1>Queue management</h1>
      <p class="lede">Who is in the chair, who is next, and who is waiting.</p>
    </header>

    <p v-if="!online" class="banner" role="alert">You appear to be offline. Changes need a connection; your entries are kept.</p>
    <p v-if="loadError" class="banner" role="alert">{{ loadError }}</p>

    <fieldset v-if="ownerMode" class="barber-pick">
      <legend>Barber</legend>
      <div class="picks" role="radiogroup" aria-label="Barber">
        <label v-for="b in barbers" :key="b.id" class="pick">
          <input v-model="barberId" type="radio" name="barber" :value="b.id" />
          <span>{{ b.displayName }}{{ b.active ? '' : ' (deactivated)' }}</span>
        </label>
      </div>
    </fieldset>
    <p v-if="ownerMode && loaded.barbers && !barbers.length" class="hint">This shop has no barbers yet. Add one in Shop configuration.</p>

    <template v-else>
      <p class="hint summary-line" role="status">
        <template v-if="!ready">Loading…</template>
        <template v-else>
          {{ ownerMode && barberName ? `${barberName}: ` : '' }}{{ nowServing.length ? 'someone is in service' : 'nobody in service' }} ·
          {{ waiting.length }} {{ waiting.length === 1 ? 'walk-in' : 'walk-ins' }} waiting ·
          {{ upcoming.length }} upcoming {{ upcoming.length === 1 ? 'booking' : 'bookings' }}. All times are Singapore time.
        </template>
      </p>
      <p class="hint mock-note">
        Delay warnings are sent by a <strong>mock</strong> provider in this prototype: they are logged, and no real SMS is sent.
        A booking's time is never changed automatically.
      </p>

      <section aria-labelledby="serving-h">
        <div class="comb-rule" aria-hidden="true"></div>
        <h2 id="serving-h">In service now</h2>
        <ul class="timeline">
          <li v-for="s in nowServing" :key="s.id" class="confirmed">
            <p class="when">{{ s.name }} <span class="badge">{{ s.kind === 'walkin' ? 'Walk-in' : 'Booking' }}</span></p>
            <p class="meta hint">{{ s.service }} · started {{ formatTime(s.started) }} · expected to finish {{ formatTime(expectedEnd(s)) }}</p>
            <p v-if="overrunMin(s)" class="meta"><span class="badge warn">Overrunning</span> by {{ overrunMin(s) }} min</p>
            <div class="row-actions">
              <button class="btn" type="button" :disabled="!!acting || !online"
                @click="run(s.id, s.kind === 'walkin' ? 'finishWalkIn' : 'finishService')">
                {{ acting.startsWith(s.id) ? 'Saving…' : 'Finish service' }}
              </button>
            </div>
            <p v-if="rowErrors[s.id]" class="meta" role="alert"><span class="badge warn">Not saved</span> {{ rowErrors[s.id] }}</p>
          </li>
          <li v-if="ready && !nowServing.length" class="empty">Nobody is in service.</li>
        </ul>
      </section>

      <section aria-labelledby="upcoming-h">
        <div class="comb-rule" aria-hidden="true"></div>
        <h2 id="upcoming-h">Upcoming bookings</h2>
        <p class="hint">
          Projected delay comes from the service in progress and the bookings before it, using each booking's actual start and finish.
          Walk-ins waiting do not delay a booking.
        </p>
        <p v-if="warningError" class="banner" role="alert">{{ warningError }}</p>
        <ul class="timeline">
          <li v-for="u in upcoming" :key="u.id" :class="u.delayMin > 0 ? 'held' : 'confirmed'">
            <p class="when">
              {{ formatTime(u.start) }}
              <span class="badge" :class="u.delayMin > 10 ? 'warn' : u.delayMin > 0 ? '' : 'off'">{{ delayLabel(u.delayMin) }}</span>
            </p>
            <p class="meta">{{ u.apt?.customerName ?? 'Customer' }} · {{ u.apt ? serviceName(u.apt.serviceId) : '' }}</p>
            <p v-if="u.delayMin > 0" class="meta hint">Projected start {{ formatTime(u.projectedStart) }} instead of {{ formatTime(u.start) }}.</p>
            <p v-if="!warningError" class="meta"><span class="badge" :class="u.status.key === 'sent' ? '' : 'off'">Warning</span> {{ u.status.label }}</p>
            <div v-if="u.apt?.status === 'CONFIRMED'" class="row-actions">
              <button class="btn secondary" type="button" :disabled="!canStartBooking(u) || !!acting || !online"
                :aria-describedby="canStartBooking(u) ? undefined : `hint-${u.id}`" @click="run(u.id, 'startService')">
                {{ acting === `${u.id}:startService` ? 'Saving…' : 'Start service' }}
              </button>
              <span v-if="!canStartBooking(u)" :id="`hint-${u.id}`" class="hint">Available from {{ formatTime(u.start - HOUR) }}</span>
            </div>
            <p v-if="rowErrors[u.id]" class="meta" role="alert"><span class="badge warn">Not saved</span> {{ rowErrors[u.id] }}</p>
          </li>
          <li v-if="ready && !upcoming.length" class="empty">No upcoming bookings for this barber.</li>
        </ul>
      </section>

      <section aria-labelledby="queue-h">
        <div class="comb-rule" aria-hidden="true"></div>
        <h2 id="queue-h">Walk-in queue</h2>
        <p class="hint">Bookings come first. The wait shown for each walk-in is an estimate around the bookings above.</p>
        <ol class="timeline">
          <li v-for="w in waiting" :key="w.id" class="confirmed">
            <p class="when">{{ w.walkInName }} <span class="badge off">{{ waitLabel(w.wait?.waitMin ?? 0) }}</span></p>
            <p class="meta hint">
              {{ serviceName(w.serviceId) }} · {{ w.durationMin }} min · joined {{ formatTime(w.joinedAt) }}
              <template v-if="w.wait"> · estimated start {{ formatTime(w.wait.estimatedStart) }}</template>
            </p>
            <div class="row-actions">
              <button class="btn secondary" type="button" :disabled="busy || !!acting || !online"
                :aria-describedby="busy ? `busy-${w.id}` : undefined" @click="run(w.id, 'startWalkIn')">
                {{ acting === `${w.id}:startWalkIn` ? 'Saving…' : 'Start' }}
              </button>
              <span v-if="busy" :id="`busy-${w.id}`" class="hint">Finish the current service first</span>
              <template v-if="armed === w.id">
                <button class="btn" type="button" :disabled="!!acting || !online" @click="run(w.id, 'removeWalkIn')">
                  {{ acting === `${w.id}:removeWalkIn` ? 'Removing…' : 'Confirm removal' }}
                </button>
                <button class="btn secondary" type="button" @click="armed = ''">Keep in queue</button>
              </template>
              <button v-else class="btn secondary" type="button" :disabled="!!acting || !online" @click="run(w.id, 'removeWalkIn')">Remove</button>
            </div>
            <p v-if="rowErrors[w.id]" class="meta" role="alert"><span class="badge warn">Not saved</span> {{ rowErrors[w.id] }}</p>
          </li>
          <li v-if="ready && !waiting.length" class="empty">No walk-ins waiting.</li>
        </ol>

        <form class="card add-form" novalidate aria-labelledby="add-h" @submit.prevent="onAdd">
          <h3 id="add-h">Add a walk-in</h3>
          <p v-if="formError" class="banner" role="alert">{{ formError }}</p>
          <div class="field">
            <label for="w-name"><span class="step-no" aria-hidden="true">1</span> Name</label>
            <input id="w-name" v-model="form.name" type="text" maxlength="60" autocomplete="off" :aria-invalid="!!errors.name"
              :aria-describedby="errors.name ? 'w-name-err' : undefined" />
            <span v-if="errors.name" id="w-name-err" class="error">{{ errors.name }}</span>
          </div>
          <fieldset class="step" :aria-describedby="errors.service ? 'w-service-err' : undefined">
            <legend><span class="step-no" aria-hidden="true">2</span> Service</legend>
            <p v-if="!offered.length" class="hint">This barber has no services to offer yet.</p>
            <div class="options" role="radiogroup" aria-label="Service">
              <label v-for="s in offered" :key="s.id" class="option">
                <input v-model="form.serviceId" type="radio" name="w-service" :value="s.id" />
                <span class="option-body">
                  <span class="option-name">{{ s.name }}</span>
                  <span class="option-meta">{{ s.durationMin }} min</span>
                </span>
              </label>
            </div>
            <span v-if="errors.service" id="w-service-err" class="error">{{ errors.service }}</span>
          </fieldset>
          <button class="btn" type="submit" :disabled="adding || !online">{{ adding ? 'Adding…' : 'Add to queue' }}</button>
        </form>
      </section>
    </template>
  </main>
</template>

<style scoped>
.queue { padding-bottom: var(--space-6); }
.page-head { margin-bottom: clamp(1.5rem, 5vw, 2.5rem); }
.page-head h1 { font-size: clamp(1.9rem, 5vw, 2.75rem); line-height: 1.1; letter-spacing: -0.03em; margin-bottom: var(--space-2); }
.lede { font-size: 1.1rem; color: var(--color-muted); max-width: 36rem; }
.queue .banner { margin-bottom: var(--space-4); }
.queue section { margin-bottom: clamp(2.5rem, 7vw, 4rem); }
.queue h2 { font-size: clamp(1.3rem, 3vw, 1.7rem); margin-bottom: var(--space-2); }
.queue section > .hint { max-width: 40rem; margin-bottom: var(--space-4); }
.summary-line { margin-bottom: var(--space-2); }
.mock-note { margin-bottom: clamp(2rem, 6vw, 3rem); max-width: 40rem; }

.barber-pick { border: 0; padding: 0; margin: 0 0 var(--space-5); min-width: 0; }
.barber-pick legend { padding: 0; margin-bottom: var(--space-2); }
/* Selectable chips: selected = teal border + tint + check mark + bold, so colour is never the only cue */
.picks { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.pick { position: relative; display: block; }
.pick input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
.pick span {
  display: flex; align-items: center; justify-content: center; gap: var(--space-1); min-height: 44px; padding: 0 var(--space-4);
  border: 2px solid var(--color-line); border-radius: var(--radius-pill); background: var(--color-surface); font-weight: 600;
}
.pick input:hover + span { border-color: var(--color-field-border); background: var(--color-tint); }
.pick input:checked + span { border-color: var(--color-accent); background: var(--color-tint); color: var(--color-accent-dark); font-weight: 800; }
.pick input:checked + span::before { content: '\2713'; }
.pick input:focus-visible + span { outline: 3px solid var(--color-focus); outline-offset: 2px; }

/* Cards: solid rail = on time or in service, dashed = delayed; each also has a text badge */
.timeline { display: grid; gap: var(--space-3); margin-bottom: var(--space-5); }
.timeline > li {
  margin: 0; padding: var(--space-4) var(--space-5); background: var(--color-surface); border: 1px solid var(--color-line);
  border-left-width: 6px; border-radius: var(--radius-lg); box-shadow: var(--shadow-card);
}
.timeline > li.empty { color: var(--color-muted); background: transparent; border: 0; box-shadow: none; padding: var(--space-3) 0; }
.timeline .when { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); font-size: var(--text-lg); margin: 0 0 var(--space-1); }
.timeline .when .badge { font-size: var(--text-xs); }
.timeline .meta { margin: 0 0 var(--space-1); }
.timeline .row-actions { gap: var(--space-2) var(--space-3); margin-top: var(--space-3); align-items: center; }
.timeline .row-actions .btn { min-width: 8rem; }
.timeline > li > p[role='alert'] { margin-top: var(--space-3); }
ol.timeline { list-style: none; padding: 0; }

/* Add a walk-in */
.add-form { max-width: 40rem; padding: var(--space-5); box-shadow: var(--shadow-raised); }
.add-form h3 { font-size: var(--text-lg); margin-bottom: var(--space-4); }
.add-form .field { margin-bottom: var(--space-5); }
.add-form input[type='text'] { font-size: 1.1rem; min-height: 52px; }
.add-form > .btn { width: 100%; }
.step { border: 0; padding: 0; margin: 0 0 var(--space-5); min-width: 0; }
.step legend, .add-form label:first-child { display: flex; align-items: center; gap: var(--space-2); }
.step legend { padding: 0; margin-bottom: var(--space-3); }
.step-no {
  display: inline-flex; align-items: center; justify-content: center; width: 1.6rem; height: 1.6rem; border-radius: var(--radius-pill);
  background: var(--color-tint); color: var(--color-accent-dark); font-size: var(--text-sm); font-weight: 800;
}
.step .error { display: block; margin-top: var(--space-2); }
.options { display: grid; grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr)); gap: var(--space-2); }
.option { position: relative; display: block; }
.option input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
.option-body {
  position: relative; display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); min-height: 56px;
  padding: var(--space-2) var(--space-4) var(--space-2) 2.6rem; border: 2px solid var(--color-line); border-radius: var(--radius-md); background: var(--color-surface);
}
.option-body::before {
  content: ''; position: absolute; left: var(--space-3); top: 50%; width: 1.15rem; height: 1.15rem; margin-top: -0.575rem;
  border: 2px solid var(--color-field-border); border-radius: var(--radius-pill); background: var(--color-surface);
}
.option-name { font-weight: 700; }
.option-meta { font-size: var(--text-sm); color: var(--color-muted); white-space: nowrap; }
.option input:hover + .option-body { border-color: var(--color-field-border); background: var(--color-tint); }
.option input:checked + .option-body { border-color: var(--color-accent); background: var(--color-tint); }
.option input:checked + .option-body::before { content: '\2713'; display: flex; align-items: center; justify-content: center; border-color: var(--color-accent); background: var(--color-accent); color: var(--color-surface); font-size: 0.8rem; font-weight: 800; }
.option input:checked + .option-body .option-name { font-weight: 800; color: var(--color-accent-dark); }
.option input:focus-visible + .option-body { outline: 3px solid var(--color-focus); outline-offset: 2px; }

@media (max-width: 480px) {
  .timeline > li { padding: var(--space-4); }
  .timeline .row-actions .btn { flex: 1 1 8rem; }
  .add-form { padding: var(--space-4); }
}
@media (min-width: 900px) {
  .timeline { max-width: 52rem; }
}
</style>
