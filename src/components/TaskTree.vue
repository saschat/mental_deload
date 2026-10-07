<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import AppIcon from "./AppIcon.vue";
import { formatDate, relativeDays } from "@/core/dates";
import { buildTaskTree, flattenTree } from "@/core/tasks";
import type { Task } from "@/core/types";
import { useDataStore } from "@/stores/data";
import { useUiStore } from "@/stores/ui";

const props = defineProps<{ tasks: Task[]; eventId: string }>();
const data = useDataStore();
const ui = useUiStore();

const rows = computed(() => flattenTree(buildTaskTree(props.tasks)));
const editing = ref<string | null>(null);
const editTitle = ref("");
const addingTo = ref<string | null | undefined>(undefined);
const newTitle = ref("");
const newDue = ref("");

function startEdit(t: Task) {
  if (data.readOnly) return;
  editing.value = t.id;
  editTitle.value = t.title;
  nextTick(() => (document.getElementById(`task-edit-${t.id}`) as HTMLInputElement | null)?.focus());
}

async function saveEdit(t: Task) {
  const title = editTitle.value.trim();
  editing.value = null;
  if (title && title !== t.title) await ui.run(() => data.saveTask({ ...t, title }));
}

async function setDue(t: Task, due: string) {
  await ui.run(() => data.saveTask({ ...t, due: due || null }));
}

async function remove(t: Task) {
  const children = props.tasks.filter((x) => x.parentId === t.id).length;
  if (children && !(await ui.confirm("Delete task?", `"${t.title}" and its subtasks will be deleted.`, "Delete", true))) return;
  await ui.run(() => data.deleteTask(t));
}

function startAdd(parentId: string | null) {
  addingTo.value = parentId;
  newTitle.value = "";
  newDue.value = "";
  nextTick(() => (document.getElementById("task-new") as HTMLInputElement | null)?.focus());
}

async function add() {
  const title = newTitle.value.trim();
  if (!title) {
    addingTo.value = undefined;
    return;
  }
  await ui.run(() => data.addTask(props.eventId, title, addingTo.value ?? null, newDue.value || null));
  newTitle.value = "";
  newDue.value = "";
}
</script>

<template>
  <div class="tree">
    <template v-for="n in rows" :key="n.task.id">
      <div class="task-row" :style="{ paddingLeft: `${n.depth * 26}px` }">
        <input
          type="checkbox"
          :checked="n.task.done"
          :disabled="data.readOnly"
          :aria-label="`Done: ${n.task.title}`"
          @change="ui.run(() => data.toggleTask(n.task))"
        />
        <div class="main">
          <input
            v-if="editing === n.task.id"
            :id="`task-edit-${n.task.id}`"
            v-model="editTitle"
            class="input"
            @keydown.enter="saveEdit(n.task)"
            @keydown.esc="editing = null"
            @blur="saveEdit(n.task)"
          />
          <span v-else class="title" :class="{ done: n.task.done }" @click="startEdit(n.task)">{{ n.task.title }}</span>
          <label class="due small" :class="{ overdue: !n.task.done && n.task.due && n.task.due < data.today }">
            <template v-if="n.task.due">
              {{ formatDate(n.task.due) }} · {{ relativeDays(n.task.due, data.today) }}
            </template>
            <template v-else>No due date</template>
            <input
              type="date"
              class="date-overlay"
              :value="n.task.due ?? ''"
              :disabled="data.readOnly"
              aria-label="Due date"
              @click="($event.target as HTMLInputElement).showPicker?.()"
              @change="setDue(n.task, ($event.target as HTMLInputElement).value)"
            />
          </label>
        </div>
        <button class="icon-btn" :disabled="data.readOnly" title="Add subtask" @click="startAdd(n.task.id)">
          <AppIcon name="subtask" :size="18" />
        </button>
        <button class="icon-btn" :disabled="data.readOnly" title="Delete" @click="remove(n.task)">
          <AppIcon name="delete" :size="18" />
        </button>
      </div>
      <div v-if="addingTo === n.task.id" class="task-row add" :style="{ paddingLeft: `${(n.depth + 1) * 26}px` }">
        <input id="task-new" v-model="newTitle" class="input" placeholder="Subtask" @keydown.enter="add" @keydown.esc="addingTo = undefined" />
        <input v-model="newDue" type="date" class="date-input" />
        <button class="btn tonal" @click="add">Add</button>
      </div>
    </template>
    <div v-if="addingTo === null" class="task-row add">
      <input id="task-new" v-model="newTitle" class="input" placeholder="New task" @keydown.enter="add" @keydown.esc="addingTo = undefined" />
      <input v-model="newDue" type="date" class="date-input" />
      <button class="btn tonal" @click="add">Add</button>
    </div>
    <button v-else class="btn text" :disabled="data.readOnly" @click="startAdd(null)">
      <AppIcon name="add" :size="18" /> Add task
    </button>
  </div>
</template>

<style scoped>
.task-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid var(--surface-2);
}
.task-row.add {
  border-bottom: none;
}
.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.title {
  cursor: text;
}
.title.done {
  text-decoration: line-through;
  color: var(--text-2);
}
.due {
  color: var(--text-2);
  position: relative;
  width: fit-content;
  cursor: pointer;
}
.due.overdue {
  color: var(--danger);
  font-weight: 500;
}
.date-overlay {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
  width: 100%;
}
</style>
