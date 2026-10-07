<script setup lang="ts">
import AppIcon from "./AppIcon.vue";
import { newId } from "@/core/defaults";
import type { TemplateNode } from "@/core/types";

defineOptions({ name: "TemplateNodes" });
const props = defineProps<{ nodes: TemplateNode[]; depth?: number }>();

function add(list: TemplateNode[]) {
  list.push({ id: newId(), title: "", offsetDays: -7, children: [] });
}

function remove(i: number) {
  props.nodes.splice(i, 1);
}

function setOffset(n: TemplateNode, v: string) {
  n.offsetDays = v === "" ? null : Number(v);
}
</script>

<template>
  <div class="nodes" :style="{ marginLeft: depth ? '22px' : '0' }">
    <div v-for="(n, i) in nodes" :key="n.id">
      <div class="node row">
        <input v-model="n.title" class="input" placeholder="Task title" />
        <input
          class="input offset"
          type="number"
          :value="n.offsetDays ?? ''"
          title="Due, in days relative to the start (negative = before)"
          placeholder="—"
          @input="setOffset(n, ($event.target as HTMLInputElement).value)"
        />
        <span class="small muted">d</span>
        <button type="button" class="icon-btn" title="Add subtask" @click="add(n.children)"><AppIcon name="subtask" :size="18" /></button>
        <button type="button" class="icon-btn" title="Delete" @click="remove(i)"><AppIcon name="delete" :size="18" /></button>
      </div>
      <TemplateNodes v-if="n.children.length" :nodes="n.children" :depth="(depth ?? 0) + 1" />
    </div>
    <button v-if="!depth" type="button" class="btn text" @click="add(nodes)"><AppIcon name="add" :size="18" /> Add task</button>
  </div>
</template>

<style scoped>
.node {
  margin-bottom: 6px;
  gap: 4px;
}
.node .input {
  padding: 7px 10px;
}
.offset {
  width: 72px !important;
  flex-shrink: 0;
}
</style>
