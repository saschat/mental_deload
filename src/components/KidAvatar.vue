<script setup lang="ts">
import { computed } from "vue";
import type { Kid, StatusKey } from "@/core/types";
import { STATUS_LABELS, statusColor } from "@/core/defaults";
import { useDataStore } from "@/stores/data";

const props = withDefaults(
  defineProps<{
    kid: Kid;
    /** undefined = don't show status; null = undecided */
    status?: StatusKey | null;
    size?: number;
    partial?: boolean;
  }>(),
  { size: 32, status: undefined, partial: false },
);

const data = useDataStore();
const showStatus = computed(() => props.status !== undefined);
const isImage = computed(() => !!props.kid.avatar && /^(data:|https?:)/.test(props.kid.avatar));
const label = computed(() => {
  if (!showStatus.value) return props.kid.name;
  return `${props.kid.name}: ${props.status ? STATUS_LABELS[props.status] : "undecided"}`;
});
const ring = computed(() => (props.status ? statusColor(data.settings, props.status) : "transparent"));
</script>

<template>
  <span
    class="avatar"
    :class="{ undecided: showStatus && !status, partial }"
    :style="{ width: `${size}px`, height: `${size}px`, '--ring': ring, '--kid': kid.color }"
    :title="label"
    :aria-label="label"
  >
    <span class="inner" :style="{ fontSize: `${Math.round(size * 0.45)}px` }">
      <img v-if="isImage" :src="kid.avatar" alt="" />
      <template v-else>{{ kid.avatar || kid.name.slice(0, 1).toUpperCase() }}</template>
    </span>
    <span v-if="showStatus && !status" class="q">?</span>
  </span>
</template>

<style scoped>
.avatar {
  position: relative;
  display: inline-flex;
  border-radius: 50%;
  padding: 2px;
  background: var(--ring);
  flex-shrink: 0;
}
.avatar.undecided {
  background: transparent;
  border: 2px dashed var(--outline);
  padding: 0;
}
.avatar.partial {
  background: conic-gradient(var(--ring) 0 60%, var(--surface-3) 60% 100%);
}
.inner {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: var(--kid);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  overflow: hidden;
  border: 2px solid white;
}
.undecided .inner {
  opacity: 0.55;
  border: none;
}
.inner img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.q {
  position: absolute;
  right: -4px;
  bottom: -4px;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: white;
  border: 1px solid var(--outline);
  font-size: 10px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-2);
}
</style>
