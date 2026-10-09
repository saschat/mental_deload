<script setup lang="ts">
import { CATEGORIES } from "@/core/defaults";
import type { Category } from "@/core/types";

defineProps<{
  modelValue: Category | "";
  disabled?: boolean;
  /** Extra chip that clears the value, used when the form may detect a category. */
  emptyLabel?: string;
}>();
const emit = defineEmits<{ "update:modelValue": [Category | ""] }>();
</script>

<template>
  <div class="chips wrap" role="group" aria-label="Category">
    <button
      v-if="emptyLabel"
      type="button"
      class="chip"
      :class="{ selected: modelValue === '' }"
      :aria-pressed="modelValue === ''"
      :disabled="disabled"
      @click="emit('update:modelValue', '')"
    >
      {{ emptyLabel }}
    </button>
    <button
      v-for="c in CATEGORIES"
      :key="c.key"
      type="button"
      class="chip"
      :class="{ selected: modelValue === c.key }"
      :aria-pressed="modelValue === c.key"
      :disabled="disabled"
      @click="emit('update:modelValue', c.key)"
    >
      {{ c.label }}
    </button>
  </div>
</template>
