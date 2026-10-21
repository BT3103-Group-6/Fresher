<script setup>
import { computed } from 'vue'

const props = defineProps({
  // Height of the leaf mark in px; the wordmark scales with it.
  size: { type: Number, default: 32 },
  // "default": teal leaf. "reversed": white leaf, for placing on the teal accent.
  variant: { type: String, default: 'default', validator: (v) => ['default', 'reversed'].includes(v) },
  // Colour of whatever the logo sits on. The comb stripes and vein use it so they read as cut-outs.
  background: { type: String, default: null },
  wordmark: { type: Boolean, default: true },
})

const reversed = computed(() => props.variant === 'reversed')
const leaf = computed(() => (reversed.value ? '#ffffff' : '#1D5E5A'))
const cut = computed(() => props.background ?? (reversed.value ? '#1D5E5A' : '#F6F8F7'))
const wordColour = computed(() => (reversed.value ? '#ffffff' : '#1E2B2A'))
const fontSize = computed(() => props.size * 0.8)
// -3px at large sizes, scaled down below 48px type so small logos stay legible.
const spacing = computed(() => -3 * Math.min(1, fontSize.value / 48))
</script>

<template>
  <span class="logo" role="img" aria-label="Fresher" :style="{ gap: `${size * 0.25}px` }">
    <svg :width="size" :height="size" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <path d="M16 84 C16 42 44 16 86 14 C84 56 58 84 16 84 Z" :fill="leaf" />
      <path d="M22 78 L76 24" :stroke="cut" stroke-width="4" stroke-linecap="round" fill="none" />
      <path d="M36 64 L60 88 M46 54 L70 78 M56 44 L80 68 M66 34 L90 58" :stroke="cut" stroke-width="4.5" fill="none" />
    </svg>
    <span
      v-if="wordmark"
      class="word"
      aria-hidden="true"
      :style="{ fontSize: `${fontSize}px`, letterSpacing: `${spacing}px`, color: wordColour }"
    >fresher</span>
  </span>
</template>

<style scoped>
.logo { display: inline-flex; align-items: center; line-height: 1; }
.logo svg { flex: none; }
.word { font-family: var(--font-sans); font-weight: 800; line-height: 1; }
</style>
