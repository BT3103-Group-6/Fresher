<script setup>
import { onMounted, onUnmounted, ref } from 'vue'
import { collection, doc, getDoc, onSnapshot, updateDoc } from 'firebase/firestore'
import { db } from '@/firebase'
import { session } from '@/stores/session'
import ServiceForm from './ServiceForm.vue'
import BarberForm from './BarberForm.vue'

const shopId = session.claims.shopId
const services = ref([])
const barbers = ref([])
const defaultHours = ref({})
const loadError = ref('')
const actionError = ref('')

// null = closed, {} = new, {id,...} = editing
const serviceForm = ref(null)
const barberForm = ref(null)

const money = (cents) => `S$${(cents / 100).toFixed(2)}`
const unsubs = []

onMounted(async () => {
  const onError = () => { loadError.value = 'Could not load shop data. Check your connection.' }
  unsubs.push(
    onSnapshot(collection(db, `shops/${shopId}/services`), (snap) => {
      services.value = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.name.localeCompare(b.name))
    }, onError),
    onSnapshot(collection(db, `shops/${shopId}/barbers`), (snap) => {
      barbers.value = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.displayName.localeCompare(b.displayName))
    }, onError),
  )
  try {
    defaultHours.value = (await getDoc(doc(db, `shops/${shopId}`))).data()?.openingHours ?? {}
  } catch {
    onError()
  }
})
onUnmounted(() => unsubs.forEach((u) => u()))

async function toggle(path, active) {
  actionError.value = ''
  try {
    await updateDoc(doc(db, path), { active })
  } catch {
    actionError.value = 'Could not update. Check your connection and try again.'
  }
}

function toggleBarber(b) {
  return toggle(`shops/${shopId}/barbers/${b.id}`, !b.active)
}
</script>

<template>
  <main>
    <h1>Shop configuration</h1>
    <p v-if="loadError" class="banner" role="alert">{{ loadError }}</p>
    <p v-if="actionError" class="banner" role="alert">{{ actionError }}</p>

    <section aria-labelledby="services-h">
      <h2 id="services-h">Services</h2>
      <ul class="list">
        <li v-for="s in services" :key="s.id">
          <div>
            <strong>{{ s.name }}</strong>
            <span class="hint"> · {{ s.durationMin }} min · {{ money(s.priceCents) }}</span>
            <span :class="['badge', { off: !s.active }]"> {{ s.active ? 'Available' : 'Unavailable' }}</span>
          </div>
          <div class="row-actions">
            <button class="btn secondary" type="button" @click="serviceForm = s">Edit</button>
            <button class="btn secondary" type="button" @click="toggle(`shops/${shopId}/services/${s.id}`, !s.active)">
              {{ s.active ? 'Make unavailable' : 'Make available' }}
            </button>
          </div>
        </li>
        <li v-if="services.length === 0">No services yet.</li>
      </ul>
      <ServiceForm v-if="serviceForm" :key="serviceForm.id ?? 'new'" :shop-id="shopId"
        :service="serviceForm.id ? serviceForm : null" @done="serviceForm = null" @cancel="serviceForm = null" />
      <button v-else class="btn" type="button" @click="serviceForm = {}">Add service</button>
    </section>

    <section aria-labelledby="barbers-h">
      <h2 id="barbers-h">Barbers</h2>
      <ul class="list">
        <li v-for="b in barbers" :key="b.id">
          <div>
            <strong>{{ b.displayName }}</strong>
            <span :class="['badge', { off: !b.active }]"> {{ b.active ? 'Active' : 'Deactivated' }}</span>
          </div>
          <div class="row-actions">
            <button class="btn secondary" type="button" @click="barberForm = b">Edit</button>
            <button class="btn secondary" type="button" @click="toggleBarber(b)">
              {{ b.active ? 'Deactivate' : 'Reactivate' }}
            </button>
          </div>
        </li>
        <li v-if="barbers.length === 0">No barbers yet.</li>
      </ul>
      <p class="hint">Deactivated barbers are hidden from new bookings; existing bookings stay.</p>
      <BarberForm v-if="barberForm" :key="barberForm.id ?? 'new'" :shop-id="shopId"
        :barber="barberForm.id ? barberForm : null" :services="services" :default-hours="defaultHours"
        @done="barberForm = null" @cancel="barberForm = null" />
      <button v-else class="btn" type="button" @click="barberForm = {}">Add barber</button>
    </section>
  </main>
</template>
