<script setup></script>

<template>
  <Html class="scroll-pt-16 font-sans antialiased">
    <Body class="bg-gray-50 dark:bg-gray-950">
      <NuxtLoadingIndicator color="var(--color-gray-500)" />
      <NuxtRouteAnnouncer />
      <NuxtLayout>
        <NuxtPage />
      </NuxtLayout>
    </Body>
  </Html>
</template>
