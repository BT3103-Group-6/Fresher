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
  <main class="config">
    <header class="page-head">
      <h1>Shop configuration</h1>
      <p class="lede">Manage the services you sell and the barbers who offer them.</p>
    </header>
    <p v-if="loadError" class="banner" role="alert">{{ loadError }}</p>
    <p v-if="actionError" class="banner" role="alert">{{ actionError }}</p>

    <section aria-labelledby="services-h">
      <div class="comb-rule" aria-hidden="true"></div>
      <h2 id="services-h">Services</h2>
      <ul class="items">
        <li v-for="s in services" :key="s.id" class="card item">
          <div class="item-main">
            <div class="item-head">
              <strong class="item-name">{{ s.name }}</strong>
              <span :class="['badge', { off: !s.active }]">{{ s.active ? 'Available' : 'Unavailable' }}</span>
            </div>
            <span class="hint">{{ s.durationMin }} min · {{ money(s.priceCents) }}</span>
          </div>
          <div class="row-actions">
            <button class="btn secondary" type="button" @click="serviceForm = s">Edit</button>
            <button class="btn secondary" type="button" @click="toggle(`shops/${shopId}/services/${s.id}`, !s.active)">
              {{ s.active ? 'Make unavailable' : 'Make available' }}
            </button>
          </div>
        </li>
        <li v-if="services.length === 0" class="empty">No services yet.</li>
      </ul>
      <ServiceForm v-if="serviceForm" :key="serviceForm.id ?? 'new'" :shop-id="shopId"
        :service="serviceForm.id ? serviceForm : null" @done="serviceForm = null" @cancel="serviceForm = null" />
      <button v-else class="btn" type="button" @click="serviceForm = {}">Add service</button>
    </section>

    <section aria-labelledby="barbers-h">
      <div class="comb-rule" aria-hidden="true"></div>
      <h2 id="barbers-h">Barbers</h2>
      <ul class="items">
        <li v-for="b in barbers" :key="b.id" class="card item">
          <div class="item-main">
            <div class="item-head">
              <strong class="item-name">{{ b.displayName }}</strong>
              <span :class="['badge', { off: !b.active }]">{{ b.active ? 'Active' : 'Deactivated' }}</span>
            </div>
          </div>
          <div class="row-actions">
            <button class="btn secondary" type="button" @click="barberForm = b">Edit</button>
            <button class="btn secondary" type="button" @click="toggleBarber(b)">
              {{ b.active ? 'Deactivate' : 'Reactivate' }}
            </button>
          </div>
        </li>
        <li v-if="barbers.length === 0" class="empty">No barbers yet.</li>
      </ul>
      <p class="hint">Deactivated barbers are hidden from new bookings; existing bookings stay.</p>
      <BarberForm v-if="barberForm" :key="barberForm.id ?? 'new'" :shop-id="shopId"
        :barber="barberForm.id ? barberForm : null" :services="services" :default-hours="defaultHours"
        @done="barberForm = null" @cancel="barberForm = null" />
      <button v-else class="btn" type="button" @click="barberForm = {}">Add barber</button>
    </section>
  </main>
</template>

<style scoped>
.config { padding-bottom: var(--space-6); }
.page-head { margin-bottom: clamp(1.5rem, 5vw, 2.5rem); }
.page-head h1 { font-size: clamp(1.9rem, 5vw, 2.75rem); line-height: 1.1; letter-spacing: -0.03em; margin-bottom: var(--space-2); }
.lede { font-size: 1.1rem; color: var(--color-muted); max-width: 34rem; }
.config .banner { margin-bottom: var(--space-4); }
.config section { margin-bottom: clamp(2.5rem, 7vw, 4rem); }
.config h2 { font-size: clamp(1.3rem, 3vw, 1.6rem); margin-bottom: var(--space-4); }
.comb-rule {
  width: 3.5rem; height: 0.9rem; margin-bottom: var(--space-3);
  background: repeating-linear-gradient(115deg, var(--color-accent) 0 3px, transparent 3px 11px);
  opacity: 0.55;
}
.items { list-style: none; padding: 0; display: grid; gap: var(--space-3); margin-bottom: var(--space-4); }
.item {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3) var(--space-5);
  margin: 0; padding: var(--space-4) var(--space-5); box-shadow: none;
}
.item-main { display: grid; gap: var(--space-1); min-width: 0; }
.item-head { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); }
.item-name { font-size: var(--text-lg); }
.item .badge { margin: 0; }
.item .row-actions { gap: var(--space-2); }
.empty { color: var(--color-muted); padding: var(--space-3) 0; }
.config section > .hint { margin-bottom: var(--space-4); }
.config section > .btn { min-width: 10rem; }
@media (max-width: 480px) {
  .item .row-actions { width: 100%; }
  .item .row-actions .btn { flex: 1 1 8rem; }
}
</style>
