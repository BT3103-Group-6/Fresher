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
  <form class="card" novalidate @submit.prevent="onSubmit">
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
    <fieldset>
      <legend>Services offered</legend>
      <p v-if="services.length === 0" class="hint">Create a service first.</p>
      <label v-for="s in services" :key="s.id" class="check">
        <input v-model="serviceIds" type="checkbox" :value="s.id" /> {{ s.name }}
      </label>
      <span v-if="errors.serviceIds" class="error">{{ errors.serviceIds }}</span>
    </fieldset>
    <fieldset>
      <legend>Working hours</legend>
      <div v-for="d in DAYS" :key="d" class="hours-row">
        <label class="check"><input v-model="hours[d].open" type="checkbox" /> {{ DAY_LABEL[d] }}</label>
        <input v-model="hours[d].start" type="time" :disabled="!hours[d].open" :aria-label="`${DAY_LABEL[d]} start`" />
        <input v-model="hours[d].end" type="time" :disabled="!hours[d].open" :aria-label="`${DAY_LABEL[d]} end`" />
      </div>
      <span v-if="errors.workingHours" class="error">{{ errors.workingHours }}</span>
    </fieldset>
    <div class="row-actions">
      <button class="btn" type="submit" :disabled="pending">{{ pending ? 'Saving…' : barber ? 'Save barber' : 'Add barber' }}</button>
      <button class="btn secondary" type="button" @click="emit('cancel')">Cancel</button>
    </div>
  </form>
</template>
