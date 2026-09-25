<script setup>
import { DEMO_MODE, SAMPLE_POSTAL_CODES } from '@/lib/demo'
</script>

<template>
  <aside v-if="DEMO_MODE" class="demo-banner" role="region" aria-label="Demo mode">
    <strong>Demo mode.</strong>
    Sample shops and mock data. No real text messages are sent and no real payments are taken.
    Postal search only knows the sample codes: {{ SAMPLE_POSTAL_CODES.join(', ') }}.
  </aside>
</template>

<style scoped>
.demo-banner {
  background: var(--color-warning-bg);
  color: var(--color-warning-fg);
  border-bottom: 1px solid var(--color-warning-fg);
  padding: var(--space-2) var(--gutter);
  font-size: 0.875rem;
  text-align: center;
}
</style>
