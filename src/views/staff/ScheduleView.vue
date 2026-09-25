<script setup>
// UI-B1 Barber schedule (FR-08). A day view of one barber's appointments and personal time blocks.
// Barbers see their own day; owners pick any barber in their shop. A HELD appointment whose hold has
// passed is shown as expired, never as a live booking (limitation L2). Blocks are written by the
// createBlock/removeBlock callables; they may overlap existing bookings, which are listed, never cancelled.
// Each booking also shows its reminder status (FR-09), read from the notifications the scheduled job maintains.
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { Timestamp, collection, getDocs, onSnapshot, query, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/firebase'
import { isOwner, session } from '@/stores/session'
import { DAY_MS, formatDate, formatTime, sgDateKey, sgTimeToMs } from '@/lib/slots'
import {
  STATUS_LABELS, availableActions, blockTimeToMs, dayBounds, displayStatus, isBooking, overlappingBlocks, partitionDay,
  reminderSummary, tasksByBooking, timeOptions, toAppointment, toBlock, toReminderTask, validateBlockForm,
} from '@/lib/schedule'

const shopId = session.claims.shopId
const ownerMode = isOwner()
const createBlock = httpsCallable(functions, 'createBlock')
const removeBlock = httpsCallable(functions, 'removeBlock')
const serviceCallables = {
  start: httpsCallable(functions, 'startService'),
  finish: httpsCallable(functions, 'finishService'),
  noShow: httpsCallable(functions, 'markNoShow'),
  reverse: httpsCallable(functions, 'reverseNoShow'),
}

const barbers = ref([]) // owners only
const barberId = ref(ownerMode ? '' : session.claims.barberId)
const services = ref({})
const dateKey = ref(sgDateKey(Date.now()))
const appointments = ref([])
const blocks = ref([])
const reminderTasks = ref([])
const reminderError = ref('')
const loaded = reactive({ appointments: false, blocks: false, barbers: !ownerMode })
const loadError = ref('')
const showHidden = ref(false)
const now = ref(Date.now())
const online = ref(navigator.onLine)

const barberName = computed(() => barbers.value.find((b) => b.id === barberId.value)?.displayName ?? '')
const dayLabel = computed(() => formatDate(sgTimeToMs(dateKey.value, '12:00')))
const asInput = (k) => `${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6, 8)}`
const fromInput = (v) => v.replaceAll('-', '')
const shift = (days) => { dateKey.value = sgDateKey(sgTimeToMs(dateKey.value, '12:00') + days * DAY_MS) }
const money = (cents) => `S$${(cents / 100).toFixed(2)}`

// ---- Live data: one appointments query and one blocks query for the chosen barber and day ----
const unsubs = [] // the day's two listeners; replaced whenever the barber or date changes
let barbersUnsub = null
const stopAll = () => unsubs.splice(0).forEach((u) => u())
function subscribe() {
  stopAll()
  loaded.appointments = false
  loaded.blocks = false
  appointments.value = []
  blocks.value = []
  reminderTasks.value = []
  reminderError.value = ''
  if (!barberId.value) return
  const { start, end } = dayBounds(dateKey.value)
  const range = [where('start', '>=', Timestamp.fromMillis(start)), where('start', '<', Timestamp.fromMillis(end))]
  const onError = () => { loadError.value = 'Could not load the schedule. Check your connection.' }
  // The equality clauses on shopId and barberId are what the Security Rules check.
  unsubs.push(
    onSnapshot(
      query(collection(db, 'appointments'), where('shopId', '==', shopId), where('barberId', '==', barberId.value), ...range),
      (snap) => { appointments.value = snap.docs.map((d) => toAppointment(d.id, d.data())); loaded.appointments = true; loadError.value = '' },
      onError,
    ),
    onSnapshot(
      query(collection(db, `shops/${shopId}/blocks`), where('barberId', '==', barberId.value), ...range),
      (snap) => { blocks.value = snap.docs.map((d) => toBlock(d.id, d.data())).sort((a, b) => a.start - b.start); loaded.blocks = true },
      onError,
    ),
    // Reminder status is secondary: if it cannot load, the day still shows and rows say so.
    onSnapshot(
      query(collection(db, 'notifications'), where('shopId', '==', shopId), where('barberId', '==', barberId.value), where('apptStart', '>=', Timestamp.fromMillis(start)), where('apptStart', '<', Timestamp.fromMillis(end))),
      (snap) => { reminderTasks.value = snap.docs.map((d) => toReminderTask(d.id, d.data())); reminderError.value = '' },
      () => { reminderError.value = 'Reminder status could not be loaded.' },
    ),
  )
}
watch([barberId, dateKey], subscribe)

let ticker
const setOnline = () => { online.value = navigator.onLine }
onMounted(async () => {
  window.addEventListener('online', setOnline)
  window.addEventListener('offline', setOnline)
  ticker = setInterval(() => { now.value = Date.now() }, 30000) // lets an expiring hold flip without a refresh
  try {
    const svc = await getDocs(collection(db, `shops/${shopId}/services`))
    services.value = Object.fromEntries(svc.docs.map((d) => [d.id, d.data().name]))
  } catch { /* names are a nicety; rows fall back to a generic label */ }
  if (ownerMode) {
    barbersUnsub = onSnapshot(collection(db, `shops/${shopId}/barbers`), (snap) => {
      barbers.value = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.displayName.localeCompare(b.displayName))
      loaded.barbers = true
      if (!barberId.value) barberId.value = (barbers.value.find((b) => b.active) ?? barbers.value[0])?.id ?? ''
    }, () => { loadError.value = 'Could not load barbers. Check your connection.' })
  }
  subscribe()
})
onUnmounted(() => {
  clearInterval(ticker)
  window.removeEventListener('online', setOnline)
  window.removeEventListener('offline', setOnline)
  stopAll()
  barbersUnsub?.()
})

// ---- Day view ----
const parts = computed(() => partitionDay(appointments.value, now.value))
const timeline = computed(() => [
  ...parts.value.active.map((a) => ({ type: 'apt', key: a.id, start: a.start, apt: a })),
  ...blocks.value.map((b) => ({ type: 'block', key: `b-${b.id}`, start: b.start, block: b })),
].sort((x, y) => x.start - y.start))
const counts = computed(() => ({
  bookings: appointments.value.filter((a) => isBooking(a, now.value)).length,
  holds: parts.value.active.filter((a) => displayStatus(a, now.value) === 'HELD').length,
  blocks: blocks.value.length,
}))
const ready = computed(() => loaded.barbers && loaded.appointments && loaded.blocks)
const range = (s, e) => `${formatTime(s)} to ${formatTime(e)}`
const serviceName = (a) => services.value[a.serviceId] ?? 'Service'
const flagged = (a) => overlappingBlocks(a, blocks.value)
const remindersOf = computed(() => tasksByBooking(reminderTasks.value))
const reminders = (a) => reminderSummary(remindersOf.value[a.id] ?? [], now.value, a.start)
const showsReminders = (a) => ['CONFIRMED', 'IN_SERVICE', 'COMPLETED', 'NO_SHOW'].includes(displayStatus(a, now.value))
const badgeOf = { sent: '', scheduled: 'off', retrying: 'warn', failed: 'warn', cancelled: 'off', 'not-scheduled': 'off', missing: 'off' }
const stateLabel = { sent: 'Sent', scheduled: 'Scheduled', retrying: 'Retrying', failed: 'Failed', cancelled: 'Cancelled', 'not-scheduled': 'Not scheduled', missing: 'Not recorded' }

// ---- Create block ----
const times = timeOptions()
const endTimes = timeOptions({ endOfDay: true })
const form = reactive({ barberId: '', dateKey: dateKey.value, start: '', end: '', reason: '' })
const errors = ref({})
const formError = ref('')
const saved = ref(null) // { block, conflicts } from the last createBlock
const pending = ref(false)
let blockId = null // reused when the same block is retried, so a retry cannot create two

watch(dateKey, (k) => { form.dateKey = k })
watch(barberId, (b) => { if (!form.barberId || ownerMode) form.barberId = b }, { immediate: true })
watch(() => [form.barberId, form.dateKey, form.start, form.end, form.reason], () => { blockId = null })

const fieldErrors = { start: 'start', end: 'end', reason: 'reason', barberId: 'barber' }
async function onCreate() {
  formError.value = ''
  saved.value = null
  errors.value = validateBlockForm({ dateKey: form.dateKey, start: form.start, end: form.end }, Date.now())
  if (ownerMode && !form.barberId) errors.value.barber = 'Choose a barber.'
  if (Object.keys(errors.value).length) return
  pending.value = true
  blockId ??= crypto.randomUUID()
  try {
    const { data } = await createBlock({
      blockId,
      ...(ownerMode ? { barberId: form.barberId } : {}),
      start: blockTimeToMs(form.dateKey, form.start),
      end: blockTimeToMs(form.dateKey, form.end),
      reason: form.reason.trim(),
    })
    saved.value = data
    blockId = null
    Object.assign(form, { start: '', end: '', reason: '' })
    if (data.barberId === barberId.value && form.dateKey !== dateKey.value) dateKey.value = form.dateKey
  } catch (err) {
    // Everything entered stays put; only the message changes.
    const d = err.details ?? {}
    if (d.reason === 'BLOCK_OVERLAP') {
      errors.value = { start: `This overlaps another block (${formatTime(d.start)} to ${formatTime(d.end)}). Remove it or choose a free time.` }
    } else if (d.reason === 'BUSY') formError.value = 'We are busy right now. Please try again in a moment.'
    else if (err.code === 'functions/invalid-argument' && d.field) errors.value = { [fieldErrors[d.field] ?? 'start']: err.message }
    else if (err.code === 'functions/permission-denied') formError.value = 'You can only block your own time.'
    else formError.value = 'Could not save the block. Your entries are kept. Check your connection and try again.'
  } finally {
    pending.value = false
  }
}

// ---- Remove block (two steps, so a slip does not free a slot) ----
const confirming = ref('')
const removing = ref('')
const removeError = ref('')
async function onRemove(id) {
  removeError.value = ''
  removing.value = id
  try {
    await removeBlock({ blockId: id })
    confirming.value = ''
  } catch (err) {
    removeError.value = err.code === 'functions/permission-denied'
      ? 'You can only remove your own blocks.'
      : 'Could not remove the block. Check your connection and try again.'
  } finally {
    removing.value = ''
  }
}

// ---- Start, finish and no-show (FR-12) ----
const CONFIRM_FIRST = ['noShow', 'reverse'] // customer-affecting, so a second click confirms
const actionMessages = {
  TOO_EARLY: 'It is too early for that.',
  REVERSAL_WINDOW_CLOSED: 'A no-show can only be reversed within 24 hours of marking it.',
  INVALID_STATE: 'This appointment has changed. The list has been updated.',
  BOOKING_NOT_FOUND: 'You cannot change this appointment.',
}
const acting = ref('') // `${id}:${action}` while a call is in flight
const armed = ref('') // `${id}:${action}` awaiting confirmation
const actionErrors = ref({}) // appointment id -> message
const key = (a, action) => `${a.id}:${action}`
async function onAction(a, action) {
  if (CONFIRM_FIRST.includes(action) && armed.value !== key(a, action)) { armed.value = key(a, action); return }
  actionErrors.value = { ...actionErrors.value, [a.id]: '' }
  acting.value = key(a, action)
  try {
    await serviceCallables[action]({ requestId: a.id })
    armed.value = ''
  } catch (err) {
    const reason = err.details?.reason
    const msg = err.code === 'functions/permission-denied'
      ? 'You cannot change this appointment.'
      : actionMessages[reason] ?? 'Could not save. Check your connection and try again.'
    actionErrors.value = { ...actionErrors.value, [a.id]: msg }
    armed.value = ''
  } finally {
    acting.value = ''
  }
}
</script>

<template>
  <main>
    <h1>Barber schedule</h1>

    <p v-if="!online" class="banner" role="alert">You appear to be offline. Changes need a connection; your entries are kept.</p>
    <p v-if="loadError" class="banner" role="alert">{{ loadError }}</p>

    <div class="day-nav">
      <div v-if="ownerMode" class="field">
        <label for="barber">Barber</label>
        <select id="barber" v-model="barberId">
          <option v-for="b in barbers" :key="b.id" :value="b.id">{{ b.displayName }}{{ b.active ? '' : ' (deactivated)' }}</option>
        </select>
      </div>
      <button class="btn secondary" type="button" @click="shift(-1)">Previous day</button>
      <div class="field">
        <label for="day">Date</label>
        <input id="day" type="date" :value="asInput(dateKey)" @change="(e) => e.target.value && (dateKey = fromInput(e.target.value))" />
      </div>
      <button class="btn secondary" type="button" @click="shift(1)">Next day</button>
      <button class="btn secondary" type="button" @click="dateKey = sgDateKey(Date.now())">Today</button>
    </div>

    <p v-if="ownerMode && loaded.barbers && !barbers.length" class="hint">This shop has no barbers yet. Add one in Shop configuration.</p>

    <section v-else aria-labelledby="day-h">
      <h2 id="day-h">{{ ownerMode && barberName ? `${barberName}, ` : '' }}{{ dayLabel }}</h2>
      <p class="hint" role="status">
        <template v-if="!ready">Loading…</template>
        <template v-else>
          {{ counts.bookings }} {{ counts.bookings === 1 ? 'booking' : 'bookings' }} ·
          {{ counts.holds }} {{ counts.holds === 1 ? 'hold' : 'holds' }} in progress ·
          {{ counts.blocks }} {{ counts.blocks === 1 ? 'block' : 'blocks' }}. All times are Singapore time.
        </template>
      </p>
      <p v-if="removeError" class="banner" role="alert">{{ removeError }}</p>
      <p class="hint">
        Customer messages are sent by a <strong>mock</strong> provider in this prototype: reminders are logged, and no real SMS is sent.
      </p>
      <p v-if="reminderError" class="banner" role="alert">{{ reminderError }}</p>

      <ul class="timeline">
        <li v-for="item in timeline" :key="item.key"
          :class="item.type === 'block' ? 'block' : displayStatus(item.apt, now) === 'HELD' ? 'held' : 'confirmed'">
          <template v-if="item.type === 'block'">
            <p class="when">{{ range(item.block.start, item.block.end) }} <span class="badge off">Blocked</span></p>
            <p class="meta">{{ item.block.reason || 'Personal time' }}</p>
            <div class="row-actions">
              <button v-if="confirming !== item.block.id" class="btn secondary" type="button" @click="confirming = item.block.id">Remove block</button>
              <template v-else>
                <button class="btn" type="button" :disabled="removing === item.block.id" @click="onRemove(item.block.id)">
                  {{ removing === item.block.id ? 'Removing…' : 'Confirm removal' }}
                </button>
                <button class="btn secondary" type="button" @click="confirming = ''">Keep block</button>
              </template>
            </div>
          </template>
          <template v-else>
            <p class="when">
              {{ range(item.apt.start, item.apt.end) }}
              <span class="badge">{{ STATUS_LABELS[displayStatus(item.apt, now)] }}</span>
            </p>
            <p class="meta">
              <template v-if="displayStatus(item.apt, now) === 'HELD'">
                A customer is verifying their number. Not a booking yet; held until {{ formatTime(item.apt.holdExpiresAt) }}.
              </template>
              <template v-else>{{ item.apt.customerName ?? 'Customer' }} · {{ item.apt.customerPhoneMasked }}</template>
            </p>
            <p class="meta hint">{{ serviceName(item.apt) }} · {{ item.apt.durationMin }} min · {{ money(item.apt.priceCents) }}</p>
            <ul v-if="showsReminders(item.apt) && !reminderError" class="reminders" :aria-label="`Reminders for the ${formatTime(item.apt.start)} booking`">
              <li v-for="r in reminders(item.apt)" :key="r.type">
                <span class="r-label">{{ r.label }}</span>
                <span class="badge" :class="badgeOf[r.state]">{{ stateLabel[r.state] }}</span>
                <span class="hint">{{ r.text }}</span>
              </li>
            </ul>
            <div v-if="availableActions(item.apt, now).length" class="row-actions">
              <template v-for="act in availableActions(item.apt, now)" :key="act.action">
                <template v-if="armed === key(item.apt, act.action)">
                  <button class="btn" type="button" :disabled="acting === key(item.apt, act.action) || !online" @click="onAction(item.apt, act.action)">
                    {{ acting === key(item.apt, act.action) ? 'Saving…' : act.action === 'noShow' ? 'Confirm no-show' : 'Confirm reversal' }}
                  </button>
                  <button class="btn secondary" type="button" @click="armed = ''">Cancel</button>
                </template>
                <button v-else class="btn secondary" type="button" :disabled="!act.enabled || !!acting || !online"
                  :aria-describedby="act.enabled ? undefined : `hint-${item.apt.id}-${act.action}`" @click="onAction(item.apt, act.action)">
                  {{ acting === key(item.apt, act.action) ? 'Saving…' : act.label }}
                </button>
                <span v-if="!act.enabled" :id="`hint-${item.apt.id}-${act.action}`" class="hint">Available from {{ formatTime(act.availableAt) }}</span>
              </template>
            </div>
            <p v-if="actionErrors[item.apt.id]" class="meta" role="alert"><span class="badge warn">Not saved</span> {{ actionErrors[item.apt.id] }}</p>
            <p v-for="b in flagged(item.apt)" :key="b.id" class="meta"><span class="badge warn">Overlaps a personal block</span> {{ b.reason || 'Personal time' }}, {{ range(b.start, b.end) }}</p>
          </template>
        </li>
        <li v-if="ready && !timeline.length">Nothing scheduled for this day.</li>
      </ul>

      <label class="check">
        <input v-model="showHidden" type="checkbox" /> Show expired and cancelled ({{ parts.inactive.length }})
      </label>
      <ul v-if="showHidden && parts.inactive.length" class="timeline">
        <li v-for="a in parts.inactive" :key="a.id" class="gone">
          <p class="when">{{ range(a.start, a.end) }} <span class="badge off">{{ displayStatus(a, now) === 'EXPIRED' && a.status === 'HELD' ? 'Hold expired' : STATUS_LABELS[displayStatus(a, now)] }}</span></p>
          <p class="meta hint">{{ a.customerName ? `${a.customerName} · ` : '' }}{{ serviceName(a) }}. Not counted.</p>
        </li>
      </ul>
    </section>

    <section aria-labelledby="block-h">
      <h2 id="block-h">Block personal time</h2>
      <p class="hint">
        Customers cannot book blocked time. Bookings already made are not cancelled; any that overlap are listed for you.
        A block covers one day.
      </p>

      <div v-if="saved" class="banner info" role="alert">
        <template v-if="saved.conflicts.length">
          <strong>Block saved, but it overlaps {{ saved.conflicts.length }}
          {{ saved.conflicts.length === 1 ? 'booking' : 'bookings' }}.</strong>
          Nothing was cancelled. Contact these customers or handle them separately:
          <ul class="alert-list">
            <li v-for="c in saved.conflicts" :key="`${c.kind}-${c.start}-${c.bookingId}`">
              {{ range(c.start, c.end) }} ·
              <template v-if="c.kind === 'booking'">
                {{ c.customerName ?? 'Customer' }} {{ c.customerPhoneMasked }}, {{ STATUS_LABELS[c.status] ?? 'Booking' }}
              </template>
              <template v-else>a customer is verifying this time (held until {{ formatTime(c.holdExpiresAt) }}); it may still be confirmed</template>
            </li>
          </ul>
        </template>
        <template v-else>Block saved. No bookings overlap it.</template>
      </div>
      <p v-if="formError" class="banner" role="alert">{{ formError }}</p>

      <form novalidate @submit.prevent="onCreate">
        <div v-if="ownerMode" class="field">
          <label for="f-barber">Barber</label>
          <select id="f-barber" v-model="form.barberId" :aria-invalid="!!errors.barber" :aria-describedby="errors.barber ? 'f-barber-err' : undefined">
            <option value="" disabled>Select a barber</option>
            <option v-for="b in barbers" :key="b.id" :value="b.id">{{ b.displayName }}</option>
          </select>
          <span v-if="errors.barber" id="f-barber-err" class="error">{{ errors.barber }}</span>
        </div>
        <div class="form-grid">
          <div class="field">
            <label for="f-date">Date</label>
            <input id="f-date" type="date" :value="asInput(form.dateKey)" :aria-invalid="!!errors.date"
              :aria-describedby="errors.date ? 'f-date-err' : undefined"
              @change="(e) => e.target.value && (form.dateKey = fromInput(e.target.value))" />
            <span v-if="errors.date" id="f-date-err" class="error">{{ errors.date }}</span>
          </div>
          <div class="field">
            <label for="f-start">From</label>
            <select id="f-start" v-model="form.start" :aria-invalid="!!errors.start" :aria-describedby="errors.start ? 'f-start-err' : undefined">
              <option value="" disabled>Start time</option>
              <option v-for="t in times" :key="t" :value="t">{{ t }}</option>
            </select>
            <span v-if="errors.start" id="f-start-err" class="error">{{ errors.start }}</span>
          </div>
          <div class="field">
            <label for="f-end">To</label>
            <select id="f-end" v-model="form.end" :aria-invalid="!!errors.end" :aria-describedby="errors.end ? 'f-end-err' : undefined">
              <option value="" disabled>End time</option>
              <option v-for="t in endTimes" :key="t" :value="t">{{ t === '24:00' ? '24:00 (midnight)' : t }}</option>
            </select>
            <span v-if="errors.end" id="f-end-err" class="error">{{ errors.end }}</span>
          </div>
        </div>
        <div class="field">
          <label for="f-reason">Reason (optional)</label>
          <input id="f-reason" v-model="form.reason" type="text" maxlength="200" :aria-invalid="!!errors.reason"
            :aria-describedby="errors.reason ? 'f-reason-err' : 'f-reason-hint'" />
          <span id="f-reason-hint" class="hint">Only you and the shop owner see this.</span>
          <span v-if="errors.reason" id="f-reason-err" class="error">{{ errors.reason }}</span>
        </div>
        <button class="btn" type="submit" :disabled="pending || !online">{{ pending ? 'Saving…' : 'Block this time' }}</button>
      </form>
    </section>
  </main>
</template>
