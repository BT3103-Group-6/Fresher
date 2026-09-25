<script setup>
import { ref } from 'vue'
import { doc, updateDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/firebase'

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const DAY_LABEL = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' }

const props = defineProps({
  shopId: { type: String, required: true },
  barber: { type: Object, default: null }, // { id, displayName, active, serviceIds, workingHours } when editing
  services: { type: Array, required: true },
  defaultHours: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['done', 'cancel'])

// One time range per day, matching how the seed stores hours.
const source = props.barber?.workingHours ?? props.defaultHours
const hours = ref(
  Object.fromEntries(
    DAYS.map((d) => {
      const first = source[d]?.[0]
      return [d, { open: !!first, start: first?.start ?? '09:00', end: first?.end ?? '18:00' }]
    }),
  ),
)
const displayName = ref(props.barber?.displayName ?? '')
const email = ref('')
const password = ref('')
const serviceIds = ref([...(props.barber?.serviceIds ?? [])])
const errors = ref({})
const formError = ref('')
const pending = ref(false)

function workingHours() {
  return Object.fromEntries(DAYS.map((d) => [d, hours.value[d].open ? [{ start: hours.value[d].start, end: hours.value[d].end }] : []]))
}

function validate() {
  const e = {}
  const n = displayName.value.trim()
  if (!n) e.displayName = 'Enter the barber’s name.'
  else if (n.length > 80) e.displayName = 'Name must be 80 characters or fewer.'
  if (!props.barber) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) e.email = 'Enter a valid email address.'
    if (password.value.length < 8) e.password = 'Temporary password must be at least 8 characters.'
  }
  if (serviceIds.value.length === 0) e.serviceIds = 'Choose at least one service.'
  for (const d of DAYS) {
    const h = hours.value[d]
    if (h.open && (!h.start || !h.end || h.start >= h.end)) e.workingHours = `Check the hours for ${DAY_LABEL[d]}: start must be before end.`
  }
  errors.value = e
  return Object.keys(e).length === 0
}

async function onSubmit() {
  formError.value = ''
  if (!validate()) return
  pending.value = true
  try {
    if (props.barber) {
      await updateDoc(doc(db, `shops/${props.shopId}/barbers/${props.barber.id}`), {
        displayName: displayName.value.trim(),
        active: props.barber.active,
        serviceIds: serviceIds.value,
        workingHours: workingHours(),
      })
    } else {
      await httpsCallable(functions, 'addBarber')({
        displayName: displayName.value.trim(),
        email: email.value.trim(),
        password: password.value,
        serviceIds: serviceIds.value,
        workingHours: workingHours(),
      })
    }
    emit('done')
  } catch (err) {
    const field = err.details?.field
    if (field && field in { displayName: 1, email: 1, password: 1, serviceIds: 1, workingHours: 1 }) {
      errors.value = { [field]: err.message }
    } else if (err.code === 'functions/permission-denied' || err.code === 'permission-denied') {
      formError.value = 'You do not have permission to do that.'
    } else {
      formError.value = 'Could not save the barber. Check your connection and try again; your entries are kept.'
    }
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <form class="card editor" novalidate @submit.prevent="onSubmit">
    <h3>{{ barber ? 'Edit barber' : 'Add barber' }}</h3>
    <p v-if="formError" class="banner" role="alert">{{ formError }}</p>
    <div class="field">
      <label for="b-name">Name</label>
      <input id="b-name" v-model="displayName" type="text" maxlength="80"
        :aria-invalid="!!errors.displayName" :aria-describedby="errors.displayName ? 'b-name-err' : undefined" />
      <span v-if="errors.displayName" id="b-name-err" class="error">{{ errors.displayName }}</span>
    </div>
    <template v-if="!barber">
      <div class="field">
        <label for="b-email">Login email</label>
        <input id="b-email" v-model="email" type="email" autocomplete="off"
          :aria-invalid="!!errors.email" :aria-describedby="errors.email ? 'b-email-err' : undefined" />
        <span v-if="errors.email" id="b-email-err" class="error">{{ errors.email }}</span>
      </div>
      <div class="field">
        <label for="b-pass">Temporary password</label>
        <input id="b-pass" v-model="password" type="password" autocomplete="new-password"
          :aria-invalid="!!errors.password" aria-describedby="b-pass-hint b-pass-err" />
        <span id="b-pass-hint" class="hint">At least 8 characters. Share it with the barber yourself; no email is sent.</span>
        <span v-if="errors.password" id="b-pass-err" class="error">{{ errors.password }}</span>
      </div>
    </template>
    <fieldset class="group">
      <legend>Services offered</legend>
      <p v-if="services.length === 0" class="hint">Create a service first.</p>
      <div class="options">
        <label v-for="s in services" :key="s.id" class="option">
          <input v-model="serviceIds" type="checkbox" :value="s.id" />
          <span class="option-body"><span class="option-box" aria-hidden="true"></span>{{ s.name }}</span>
        </label>
      </div>
      <span v-if="errors.serviceIds" class="error">{{ errors.serviceIds }}</span>
    </fieldset>
    <fieldset class="group">
      <legend>Working hours</legend>
      <p class="hint">Tick the days this barber works, then set the hours.</p>
      <div v-for="d in DAYS" :key="d" class="hours">
        <label class="option day">
          <input v-model="hours[d].open" type="checkbox" />
          <span class="option-body"><span class="option-box" aria-hidden="true"></span>{{ DAY_LABEL[d] }}</span>
        </label>
        <template v-if="hours[d].open">
          <input v-model="hours[d].start" type="time" :aria-label="`${DAY_LABEL[d]} start`" />
          <span class="to" aria-hidden="true">to</span>
          <input v-model="hours[d].end" type="time" :aria-label="`${DAY_LABEL[d]} end`" />
        </template>
        <span v-else class="hint off-note">Day off</span>
      </div>
      <span v-if="errors.workingHours" class="error">{{ errors.workingHours }}</span>
    </fieldset>
    <div class="row-actions form-actions">
      <button class="btn" type="submit" :disabled="pending">{{ pending ? 'Saving…' : barber ? 'Save barber' : 'Add barber' }}</button>
      <button class="btn secondary" type="button" @click="emit('cancel')">Cancel</button>
    </div>
  </form>
</template>

<style scoped>
.editor { padding: var(--space-5); margin-bottom: var(--space-4); max-width: 40rem; border-color: var(--color-accent); box-shadow: 0 8px 28px rgba(30, 43, 42, 0.1); }
.editor h3 { font-size: var(--text-lg); margin-bottom: var(--space-4); }
.field { margin-bottom: var(--space-4); }
.editor .banner { margin-bottom: var(--space-4); }
.group { margin: 0 0 var(--space-5); min-width: 0; }
.group legend { padding: 0; margin-bottom: var(--space-2); }
.group .hint { margin-bottom: var(--space-3); }
.group .error { display: block; margin-top: var(--space-2); }

/* Checkbox options: selected = teal border + tint + check mark + bold, so colour is never the only cue */
.options { display: grid; grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr)); gap: var(--space-2); }
.option { position: relative; display: block; }
.option input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
.option-body {
  display: flex; align-items: center; gap: var(--space-3); min-height: 48px; padding: var(--space-2) var(--space-4);
  border: 2px solid var(--color-line); border-radius: var(--radius-md); background: var(--color-surface); font-weight: 600;
}
.option-box {
  display: inline-flex; align-items: center; justify-content: center; flex: none; width: 1.4rem; height: 1.4rem;
  border: 2px solid var(--color-field-border); border-radius: var(--radius-sm); background: var(--color-surface); color: var(--color-surface); font-size: 0.85rem; font-weight: 800;
}
.option input:hover + .option-body { border-color: var(--color-field-border); background: var(--color-tint); }
.option input:checked + .option-body { border-color: var(--color-accent); background: var(--color-tint); font-weight: 800; color: var(--color-accent-dark); }
.option input:checked + .option-body .option-box { background: var(--color-accent); border-color: var(--color-accent); }
.option input:checked + .option-body .option-box::before { content: '\2713'; }
.option input:focus-visible + .option-body { outline: 3px solid var(--color-focus); outline-offset: 2px; }

/* One row per day: the day toggle, then its hours (or an explicit "Day off") */
.hours { display: grid; grid-template-columns: 6.5rem 1fr auto 1fr; gap: var(--space-2); align-items: center; margin-bottom: var(--space-2); }
.hours .day { min-width: 0; }
.hours input[type='time'] { min-width: 0; }
.to { color: var(--color-muted); font-size: var(--text-sm); }
.off-note { grid-column: 2 / -1; margin: 0; }
@media (max-width: 480px) {
  .hours { grid-template-columns: 6rem 1fr auto 1fr; gap: var(--space-1) var(--space-2); }
  .option-body { padding: var(--space-2) var(--space-3); }
}
.form-actions { gap: var(--space-2) var(--space-3); }
.form-actions .btn { flex: 1 1 9rem; }
</style>
