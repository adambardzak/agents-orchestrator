<!--
  Compatibility alias: redirect /login → /auth/login.
  Some libraries (Better Auth client defaults, third-party redirects) hit
  /login by default; this keeps them working without a 404.
-->
<script setup lang="ts">
definePageMeta({ auth: { public: true } });
await navigateTo('/auth/login', { replace: true });
</script>

<template><div /></template>
