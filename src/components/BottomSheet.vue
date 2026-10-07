<script setup lang="ts">
defineProps<{ open: boolean; title?: string }>();
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <Teleport to="body">
    <Transition name="sheet">
      <div v-if="open" class="scrim" @click.self="emit('close')">
        <div class="sheet" role="dialog" :aria-label="title">
          <div class="handle" />
          <h3 v-if="title" class="title">{{ title }}</h3>
          <slot />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  background: rgba(15, 18, 40, 0.38);
  z-index: 50;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.sheet {
  background: var(--surface-1);
  width: 100%;
  max-width: 640px;
  max-height: 88vh;
  overflow-y: auto;
  border-radius: 24px 24px 0 0;
  padding: 8px 18px calc(20px + env(safe-area-inset-bottom));
}
.handle {
  width: 36px;
  height: 4px;
  border-radius: 2px;
  background: var(--outline);
  margin: 4px auto 12px;
}
.title {
  font-size: 18px;
  margin-bottom: 12px;
}
.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 0.18s;
}
.sheet-enter-active .sheet,
.sheet-leave-active .sheet {
  transition: transform 0.18s;
}
.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}
.sheet-enter-from .sheet,
.sheet-leave-to .sheet {
  transform: translateY(40px);
}
</style>
