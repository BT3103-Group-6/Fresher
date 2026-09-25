<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import StaffHeader from '@/components/StaffHeader.vue'
import { isStaff, landingRoute } from '@/stores/session'

const route = useRoute()
// Staff navigation belongs to /staff/* only; customer pages never show it, even for a signed-in staff member.
const inStaffArea = computed(() => route.path.startsWith('/staff/'))
const showStaffHeader = computed(() => inStaffArea.value && isStaff())
const showStaffLink = computed(() => !inStaffArea.value && route.name !== 'login' && isStaff())
</script>

<template>
  <StaffHeader v-if="showStaffHeader" />
  <p v-else-if="showStaffLink" class="staff-link">
    <RouterLink :to="landingRoute()">Staff area</RouterLink>
  </p>
  <RouterView />
</template>
