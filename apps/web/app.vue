<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>

  <!--
    Boot splash. Mounted once at first page load and torn down after a
    short reveal. Uses ClientOnly so the overlay never appears in SSR'd
    HTML (we don't want the user to see a flash on hard nav between
    pages or with ?prerender). After draw-complete + a tiny hold, we
    fade out and unmount the whole thing.
  -->
  <ClientOnly>
    <Transition name="splash-fade">
      <div
        v-if="showSplash"
        class="fixed inset-0 z-[9999] flex items-center justify-center bg-bg pointer-events-none"
        aria-hidden="true"
      >
        <AnimatedBrandLogo
          mode="draw"
          :draw-duration="1.4"
          class="w-24 h-24 text-text-primary"
          @draw-complete="onDrawComplete"
        />
      </div>
    </Transition>
  </ClientOnly>
</template>

<script setup lang="ts">
import { ref } from 'vue';

useHead({
  htmlAttrs: { lang: 'en' },
  bodyAttrs: { class: 'bg-bg text-text-primary' },
});

const showSplash = ref(true);

function onDrawComplete() {
  // Hold the finished mark for ~300ms before fading the overlay so the
  // user actually registers it instead of seeing a flicker.
  setTimeout(() => {
    showSplash.value = false;
  }, 300);
}
</script>

<style>
.splash-fade-leave-active {
  transition: opacity 0.4s ease;
}
.splash-fade-leave-to {
  opacity: 0;
}
</style>
