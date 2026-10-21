<script>
// Decorative leaf with comb-stripe cut-outs (the logo shape, drawn large and faint). The stripes are a
// real mask, so whatever is behind shows through. Colour comes from `color` on the element.
</script>

<template>
  <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false" class="comb-motif">
    <mask id="comb-cut" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
      <rect width="100" height="100" fill="#fff" />
      <path d="M22 78 L76 24" stroke="#000" stroke-width="4" stroke-linecap="round" fill="none" />
      <path d="M36 64 L60 88 M46 54 L70 78 M56 44 L80 68 M66 34 L90 58" stroke="#000" stroke-width="4.5" fill="none" />
    </mask>
    <path d="M16 84 C16 42 44 16 86 14 C84 56 58 84 16 84 Z" fill="currentColor" mask="url(#comb-cut)" />
  </svg>
</template>
