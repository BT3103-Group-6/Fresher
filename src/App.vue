<script setup>
import { computed, watchEffect } from 'vue'
import { useRoute } from 'vue-router'
import CustomerHeader from '@/components/CustomerHeader.vue'
import StaffHeader from '@/components/StaffHeader.vue'
import { isStaff } from '@/stores/session'

const route = useRoute()
// Staff navigation belongs to /staff/* only; customer pages get the customer header instead, even for a
// signed-in staff member (who then sees just a "Staff area" link). The staff sign-in page has neither.
const inStaffArea = computed(() => route.path.startsWith('/staff/'))
const showStaffHeader = computed(() => inStaffArea.value && isStaff())
const showCustomerHeader = computed(() => !inStaffArea.value && route.name !== 'login')

// The landing page uses a wider column than the other screens.
watchEffect(() => document.getElementById('app')?.classList.toggle('wide', !!route.meta.wide))
</script>

<template>
  <StaffHeader v-if="showStaffHeader" />
  <CustomerHeader v-else-if="showCustomerHeader" />
  <RouterView />
</template>
