<!--
  Centered, minimal layout for auth flows (login, signup, accept-invitation).
  No sidebar / topbar — just brand mark + the auth card on a soft surface.
-->
<template>
  <div class="min-h-screen w-screen flex flex-col bg-bg text-text-primary">
    <header class="flex items-center gap-2 px-6 h-14">
      <div class="w-7 h-7 rounded-md bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center">
        <UIcon name="i-ph-graph-light" class="w-4.5 h-4.5 text-white" />
      </div>
      <span class="font-heading font-semibold text-[15px] tracking-tight">Orchestrator</span>
    </header>

    <main class="flex-1 flex items-center justify-center px-4 py-8">
      <slot />
    </main>

    <footer class="px-6 h-12 flex items-center justify-between text-xs text-text-faint">
      <span>© Coding Agent Orchestrator</span>
      <a href="https://github.com/adambardzak/agents-orchestrator" target="_blank" rel="noopener" class="hover:text-text-secondary">
        GitHub
      </a>
    </footer>
  </div>
</template>
