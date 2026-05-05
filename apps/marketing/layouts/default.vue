<template>
  <div class="min-h-screen flex flex-col bg-bg text-text-primary antialiased">
    <SiteHeader />
    <main class="flex-1">
      <slot />
    </main>
    <SiteFooter />
  </div>
</template>
