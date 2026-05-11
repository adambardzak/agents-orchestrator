<script setup lang="ts">
/**
 * Subtle full-viewport celebration effect for task completion.
 *
 * Mounted once globally in the default layout. Listens for window-level
 * 'task-complete-celebrate' CustomEvents and renders a brief radial glow
 * burst from screen center. CSS-only; no confetti library, no JS animation
 * loop, no permanent DOM weight when idle.
 *
 * Fire from anywhere with:
 *   window.dispatchEvent(new CustomEvent('task-complete-celebrate'))
 */
const visible = ref(false);
let timer: number | undefined;

function trigger(): void {
  if (timer) window.clearTimeout(timer);
  visible.value = false;
  // Force re-render on the next tick so the animation restarts cleanly even
  // when two completions fire back-to-back.
  requestAnimationFrame(() => {
    visible.value = true;
    timer = window.setTimeout(() => { visible.value = false; }, 1400);
  });
}

onMounted(() => {
  window.addEventListener('task-complete-celebrate', trigger);
});

onBeforeUnmount(() => {
  window.removeEventListener('task-complete-celebrate', trigger);
  if (timer) window.clearTimeout(timer);
});
</script>

<template>
  <Teleport to="body">
    <Transition name="celebrate">
      <div
        v-if="visible"
        class="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center"
        aria-hidden="true"
      >
        <!-- Radial glow burst — completed accent (matches text-completed token) -->
        <div class="celebrate-glow" />
        <!-- Inner pulsing ring -->
        <div class="celebrate-ring" />
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* Color literals match the --color-completed token (#4cc38a) so the burst
 * matches every other completed-state cue across the UI. Hard-coded instead
 * of var() because color-mix / rgb(var()) syntax doesn't work with the hex
 * tokens this project ships. */
.celebrate-glow {
  position: absolute;
  width: 200px;
  height: 200px;
  border-radius: 9999px;
  background: radial-gradient(
    circle,
    rgba(76, 195, 138, 0.35) 0%,
    rgba(76, 195, 138, 0.15) 35%,
    transparent 70%
  );
  animation: celebrate-glow 1.3s ease-out forwards;
}

.celebrate-ring {
  position: absolute;
  width: 80px;
  height: 80px;
  border-radius: 9999px;
  border: 2px solid rgba(76, 195, 138, 0.6);
  animation: celebrate-ring 1.3s ease-out forwards;
}

@keyframes celebrate-glow {
  0%   { transform: scale(0.4); opacity: 0; }
  25%  { opacity: 1; }
  100% { transform: scale(2.2); opacity: 0; }
}

@keyframes celebrate-ring {
  0%   { transform: scale(0.4); opacity: 0; }
  20%  { opacity: 0.9; }
  100% { transform: scale(5); opacity: 0; }
}

.celebrate-enter-active,
.celebrate-leave-active {
  transition: opacity 0.2s ease;
}
.celebrate-enter-from,
.celebrate-leave-to {
  opacity: 0;
}
</style>
