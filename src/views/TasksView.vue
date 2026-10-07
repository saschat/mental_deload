<script setup lang="ts">
import { computed } from "vue";
import { formatDate, relativeDays } from "@/core/dates";
import { taskGroup, type TaskGroup } from "@/core/tasks";
import type { Task } from "@/core/types";
import { useDataStore } from "@/stores/data";
import { useUiStore } from "@/stores/ui";

const data = useDataStore();
const ui = useUiStore();

const GROUPS: { key: TaskGroup; label: string }[] = [
  { key: "overdue", label: "Overdue" },
  { key: "week", label: "This week" },
  { key: "later", label: "Later" },
  { key: "nodate", label: "No due date" },
];

const tasksById = computed(() => new Map(data.tasks.map((t) => [t.id, t])));

const groups = computed(() => {
  const sorted = [...data.openTasks].sort((a, b) => {
    const da = a.due ?? "9999";
    const db = b.due ?? "9999";
    return da < db ? -1 : da > db ? 1 : a.order - b.order;
  });
  return GROUPS.map((g) => ({ ...g, tasks: sorted.filter((t) => taskGroup(t, data.today) === g.key) })).filter((g) => g.tasks.length);
});

function parentTitle(t: Task) {
  return t.parentId ? tasksById.value.get(t.parentId)?.title : undefined;
}
</script>

<template>
  <div class="page">
    <div v-if="!groups.length" class="empty">
      <div class="big">✅</div>
      <p>No open tasks. Tasks are created when you set a status on an event.</p>
    </div>
    <section v-for="g in groups" :key="g.key">
      <h2 :class="{ 'danger-text': g.key === 'overdue' }">{{ g.label }} · {{ g.tasks.length }}</h2>
      <div class="card">
        <div v-for="t in g.tasks" :key="t.id" class="list-item">
          <input type="checkbox" :checked="t.done" :disabled="data.readOnly" :aria-label="`Done: ${t.title}`" @change="ui.run(() => data.toggleTask(t), 'Task done')" />
          <div style="flex: 1; min-width: 0">
            <div>
              <span v-if="parentTitle(t)" class="muted small">{{ parentTitle(t) }} › </span>{{ t.title }}
            </div>
            <RouterLink :to="`/event/${t.eventId}`" class="small">{{ data.eventsById.get(t.eventId)?.title }}</RouterLink>
          </div>
          <div v-if="t.due" class="small due" :class="{ 'danger-text': g.key === 'overdue' }">
            <div>{{ formatDate(t.due) }}</div>
            <div class="muted">{{ relativeDays(t.due, data.today) }}</div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.due {
  text-align: right;
  white-space: nowrap;
}
</style>
