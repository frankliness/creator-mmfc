<template>
  <div class="inline-flex items-center gap-3 text-left">
    <div
      class="relative shrink-0 overflow-hidden rounded-2xl border border-white/50 shadow-[0_18px_40px_rgba(14,165,233,0.16)]"
      :style="iconStyle"
    >
      <div class="absolute inset-0 bg-[linear-gradient(135deg,#0f172a_0%,#164e63_38%,#0f766e_72%,#f59e0b_100%)]"></div>
      <div class="absolute inset-[1px] rounded-[calc(1rem-1px)] bg-[radial-gradient(circle_at_top,#ffffff30_0%,transparent_48%),linear-gradient(135deg,#0b1120_0%,#164e63_45%,#115e59_100%)]"></div>
      <svg
        viewBox="0 0 100 100"
        class="relative z-10 h-full w-full p-[18%]"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          d="M14 76V24L34 56L50 34L66 56L86 24V76"
          stroke="#F8FAFC"
          stroke-width="10"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <circle cx="50" cy="54" r="14" fill="#FFFFFF22" stroke="#F8FAFC" stroke-width="6" />
        <path
          d="M50 40L58 54L50 68L42 54L50 40Z"
          fill="#FCD34D"
          stroke="#FDE68A"
          stroke-width="2"
          stroke-linejoin="round"
        />
      </svg>
      <div class="absolute -right-2 top-1 h-8 w-8 rounded-full bg-white/20 blur-xl"></div>
      <div class="absolute -bottom-3 left-2 h-8 w-8 rounded-full bg-amber-300/20 blur-xl"></div>
    </div>

    <div v-if="showText" class="min-w-0 leading-tight">
      <p :class="titleClass">MMFC Studio</p>
      <p v-if="subtitle" :class="subtitleClass">{{ subtitle }}</p>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  iconSize: {
    type: Number,
    default: 40
  },
  showText: {
    type: Boolean,
    default: true
  },
  subtitle: {
    type: String,
    default: 'Google Gemini 官方 API 驱动'
  },
  titleClass: {
    type: String,
    default: 'text-base font-semibold tracking-[0.14em] text-[var(--text-primary)]'
  },
  subtitleClass: {
    type: String,
    default: 'text-xs text-[var(--text-secondary)]'
  }
})

const iconStyle = computed(() => ({
  width: `${props.iconSize}px`,
  height: `${props.iconSize}px`
}))
</script>
