<script setup lang="ts">
import { STATUSES, statusColor } from "@/core/defaults";
import type { StatusKey } from "@/core/types";
import { useDataStore } from "@/stores/data";

defineProps<{ modelValue: StatusKey | null | undefined; disabled?: boolean }>();
const emit = defineEmits<{ "update:modelValue": [StatusKey] }>();
const data = useDataStore();
</script>

<template>
  <div class="chips wrap">
    <button
      v-for="s in STATUSES"
      :key="s.key"
      type="button"
      class="chip"
      :class="{ selected: modelValue === s.key }"
      :disabled="disabled"
      @click="emit('update:modelValue', s.key)"
    >
      <span class="dot" :style="{ background: statusColor(data.settings, s.key) }" />
      {{ s.label }}
    </button>
  </div>
</template>
