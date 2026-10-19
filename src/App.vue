<script setup>
import { computed, watchEffect } from 'vue'
import { useRoute } from 'vue-router'
import CustomerHeader from '@/components/CustomerHeader.vue'
import StaffHeader from '@/components/StaffHeader.vue'
import { isStaff } from '@/stores/session'

const route = useRoute()
// Staff navigation belongs to /staff/* only; customer pages get the customer header instead, even for a
// signed-in staff member (who then sees just a "Staff area" link). The staff sign-in page shows the customer header too.
const inStaffArea = computed(() => route.path.startsWith('/staff/'))
const showStaffHeader = computed(() => inStaffArea.value && isStaff())
const showCustomerHeader = computed(() => !inStaffArea.value)

// Every page shares one container (--container-max). Form-style customer pages cap their main column but keep
// the same left edge.
const NARROW = ['book', 'book-verify', 'deposit']
watchEffect(() => document.getElementById('app')?.classList.toggle('narrow', NARROW.includes(route.name)))
</script>

<template>
  <StaffHeader v-if="showStaffHeader" />
  <CustomerHeader v-else-if="showCustomerHeader" />
  <RouterView />
</template>
