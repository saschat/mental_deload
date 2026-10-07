<script setup lang="ts">
import { useUiStore } from "@/stores/ui";
const ui = useUiStore();
</script>

<template>
  <Teleport to="body">
    <div v-if="ui.dialog" class="scrim" @click.self="ui.dialog.resolve(null)">
      <div class="dialog" role="alertdialog" :aria-label="ui.dialog.title">
        <h3>{{ ui.dialog.title }}</h3>
        <p class="muted">{{ ui.dialog.message }}</p>
        <div class="actions">
          <button
            v-for="b in ui.dialog.buttons"
            :key="b.value"
            class="btn"
            :class="{ primary: b.primary, danger: b.danger, text: !b.primary && !b.danger }"
            @click="ui.dialog.resolve(b.value)"
          >
            {{ b.label }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  background: rgba(15, 18, 40, 0.38);
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.dialog {
  background: var(--surface-1);
  border-radius: 24px;
  padding: 22px 22px 14px;
  max-width: 420px;
  width: 100%;
}
.dialog h3 {
  font-size: 20px;
  margin-bottom: 8px;
}
.dialog p {
  white-space: pre-line;
}
.actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 16px;
}
</style>
