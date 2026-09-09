<script setup></script>

<template>
  <Html class="scroll-pt-16 font-sans antialiased">
    <Body class="bg-zinc-50 dark:bg-zinc-950">
      <NuxtLoadingIndicator color="var(--color-zinc-500)" />
      <NuxtRouteAnnouncer />
      <NuxtLayout>
        <NuxtPage />
      </NuxtLayout>
    </Body>
  </Html>
</template>
