<script setup>
import { ref } from 'vue'
import { collection, doc, setDoc } from 'firebase/firestore'
import { db } from '@/firebase'
import { SERVICE_TYPES } from '@/lib/serviceTypes'

const props = defineProps({
  shopId: { type: String, required: true },
  service: { type: Object, default: null }, // { id, name, category, durationMin, priceCents, active } when editing
})
const emit = defineEmits(['done', 'cancel'])

const name = ref(props.service?.name ?? '')
const category = ref(props.service?.category ?? '')
const durationMin = ref(props.service?.durationMin ?? 30)
const price = ref(props.service ? (props.service.priceCents / 100).toFixed(2) : '')
const active = ref(props.service?.active ?? true)
const errors = ref({})
const formError = ref('')
const pending = ref(false)

function validate() {
  const e = {}
  const n = name.value.trim()
  if (!n) e.name = 'Enter a service name.'
  else if (n.length > 80) e.name = 'Name must be 80 characters or fewer.'
  if (!SERVICE_TYPES.some((t) => t.value === category.value)) e.category = 'Choose a service type.'
  const d = Number(durationMin.value)
  if (!Number.isInteger(d) || d <= 0) e.durationMin = 'Enter a duration in minutes.'
  else if (d % 5 !== 0) e.durationMin = 'Duration must be in 5-minute steps.'
  const p = Number(price.value)
  if (price.value === '' || Number.isNaN(p)) e.price = 'Enter a price in SGD.'
  else if (p < 0) e.price = 'Price cannot be negative.'
  errors.value = e
  return Object.keys(e).length === 0
}

async function onSubmit() {
  formError.value = ''
  if (!validate()) return
  pending.value = true
  try {
    const ref_ = props.service
      ? doc(db, `shops/${props.shopId}/services/${props.service.id}`)
      : doc(collection(db, `shops/${props.shopId}/services`))
    await setDoc(ref_, {
      name: name.value.trim(),
      category: category.value,
      durationMin: Number(durationMin.value),
      priceCents: Math.round(Number(price.value) * 100),
      active: active.value,
    })
    emit('done')
  } catch {
    formError.value = 'Could not save the service. Check your connection and try again; your entries are kept.'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <form class="card" novalidate @submit.prevent="onSubmit">
    <h3>{{ service ? 'Edit service' : 'New service' }}</h3>
    <p v-if="formError" class="banner" role="alert">{{ formError }}</p>
    <div class="field">
      <label for="svc-name">Name</label>
      <input id="svc-name" v-model="name" type="text" maxlength="80"
        :aria-invalid="!!errors.name" :aria-describedby="errors.name ? 'svc-name-err' : undefined" />
      <span v-if="errors.name" id="svc-name-err" class="error">{{ errors.name }}</span>
    </div>
    <div class="field">
      <label for="svc-cat">Service type</label>
      <select id="svc-cat" v-model="category" :aria-invalid="!!errors.category"
        :aria-describedby="errors.category ? 'svc-cat-err' : 'svc-cat-hint'">
        <option value="" disabled>Select a type</option>
        <option v-for="t in SERVICE_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
      </select>
      <span id="svc-cat-hint" class="hint">Customers filter shops by this.</span>
      <span v-if="errors.category" id="svc-cat-err" class="error">{{ errors.category }}</span>
    </div>
    <div class="field">
      <label for="svc-dur">Duration (minutes)</label>
      <input id="svc-dur" v-model="durationMin" type="number" min="5" step="5" inputmode="numeric"
        :aria-invalid="!!errors.durationMin" aria-describedby="svc-dur-hint svc-dur-err" />
      <span id="svc-dur-hint" class="hint">In 5-minute steps.</span>
      <span v-if="errors.durationMin" id="svc-dur-err" class="error">{{ errors.durationMin }}</span>
    </div>
    <div class="field">
      <label for="svc-price">Price (SGD)</label>
      <input id="svc-price" v-model="price" type="number" min="0" step="0.01" inputmode="decimal"
        :aria-invalid="!!errors.price" :aria-describedby="errors.price ? 'svc-price-err' : undefined" />
      <span v-if="errors.price" id="svc-price-err" class="error">{{ errors.price }}</span>
    </div>
    <label class="check"><input v-model="active" type="checkbox" /> Available for booking</label>
    <div class="row-actions">
      <button class="btn" type="submit" :disabled="pending">{{ pending ? 'Saving…' : 'Save service' }}</button>
      <button class="btn secondary" type="button" @click="emit('cancel')">Cancel</button>
    </div>
  </form>
</template>
