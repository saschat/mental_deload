<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import AppIcon from "@/components/AppIcon.vue";
import CoverageEditor from "@/components/CoverageEditor.vue";
import TaskTree from "@/components/TaskTree.vue";
import { diffDays, formatDate, formatRange, relativeDays } from "@/core/dates";
import { isUndecided, segmentHeading } from "@/core/coverage";
import { CATEGORY_LABELS } from "@/core/defaults";
import { acceptUpstream, ignoreUpstream } from "@/core/importDiff";
import { reminderSchedule } from "@/core/reminders";
import { taskProgress, withDescendants } from "@/core/tasks";
import type { Task } from "@/core/types";
import { timeLabel } from "@/lib/eventMeta";
import { useDataStore } from "@/stores/data";
import { useUiStore } from "@/stores/ui";

const route = useRoute();
const router = useRouter();
const data = useDataStore();
const ui = useUiStore();

const ev = computed(() => data.eventsById.get(route.params.id as string));
const source = computed(() => (ev.value?.sourceId ? data.sources.find((s) => s.id === ev.value!.sourceId) : undefined));
const tasks = computed(() => (ev.value ? (data.tasksByEvent.get(ev.value.id) ?? []) : []));
const taskGroups = computed(() => {
  const event = ev.value;
  if (!event) return [];
  const all = tasks.value;
  const segs = [...(event.segments ?? [])].sort((a, b) => (a.start < b.start ? -1 : 1));
  const claimed = new Set<string>();
  const groups: { key: string; heading: string; segmentId?: string; tasks: Task[] }[] = [];
  for (const seg of segs) {
    const group = withDescendants(
      all.filter((t) => t.segmentId === seg.id),
      all,
    );
    if (!group.length) continue;
    for (const t of group) claimed.add(t.id);
    groups.push({ key: seg.id, heading: segmentHeading(event, seg), segmentId: seg.id, tasks: group });
  }
  const loose = all.filter((t) => !claimed.has(t.id));
  if (loose.length || !groups.length) groups.push({ key: "loose", heading: "", tasks: loose });
  return groups;
});
const progress = computed(() => taskProgress(tasks.value));
const undecided = computed(() => (ev.value ? isUndecided(ev.value, data.kids) : false));
const schedule = computed(() => {
  if (!ev.value || !undecided.value) return [];
  const cfg = data.settings.reminderTiers[ev.value.category];
  return reminderSchedule(ev.value.start, cfg, data.today);
});
const countdown = computed(() => {
  if (!ev.value) return "";
  if (ev.value.start <= data.today && ev.value.end >= data.today) return "happening now";
  if (ev.value.end < data.today) return "past";
  return relativeDays(ev.value.start, data.today);
});
const dueSoonTasks = computed(
  () => tasks.value.filter((t) => !t.done && t.due && diffDays(data.today, t.due) <= data.settings.taskDueSoonDays).length,
);

async function accept() {
  if (!ev.value) return;
  await ui.run(() => data.saveEvent(acceptUpstream(ev.value!, new Date().toISOString())), "Updated from calendar");
}

async function ignore() {
  if (!ev.value) return;
  const msg = ev.value.upstreamFlag === "removed" ? "Event kept as a manual event" : "Kept your version";
  await ui.run(() => data.saveEvent(ignoreUpstream(ev.value!, new Date().toISOString())), msg);
}

async function remove() {
  if (!ev.value) return;
  const n = tasks.value.length;
  const ok = await ui.confirm("Delete event?", `"${ev.value.title}"${n ? ` and its ${n} task${n === 1 ? "" : "s"}` : ""} will be deleted.`, "Delete", true);
  if (!ok) return;
  const id = ev.value.id;
  router.replace("/upcoming");
  await ui.run(() => data.deleteEvent(id), "Event deleted");
}
</script>

<template>
  <div v-if="!ev" class="page empty">
    <p>This event doesn't exist (anymore).</p>
    <RouterLink to="/">Back to inbox</RouterLink>
  </div>
  <div v-else class="page">
    <div class="card header">
      <div class="row">
        <h3 class="title">{{ ev.title }}</h3>
        <span class="spacer" />
        <RouterLink v-if="!data.readOnly" :to="`/event/${ev.id}/edit`" class="icon-btn" title="Edit"><AppIcon name="edit" /></RouterLink>
        <button v-if="!ev.sourceId" class="icon-btn" title="Delete" :disabled="data.readOnly" @click="remove"><AppIcon name="delete" /></button>
      </div>
      <div>{{ formatRange(ev.start, ev.end) }}<template v-if="timeLabel(ev)"> · {{ timeLabel(ev) }}</template></div>
      <div class="row wrap" style="margin-top: 8px; gap: 6px">
        <span class="tag" :class="{ danger: undecided }">{{ countdown }}</span>
        <span class="tag">{{ CATEGORY_LABELS[ev.category] }}</span>
        <span class="tag">{{ source ? source.name : "Manual" }}</span>
        <span v-if="!undecided" class="tag" style="background: #e3f4e5; color: var(--ok)">Decided</span>
      </div>
      <p v-if="ev.location" class="small muted" style="margin-bottom: 0">📍 {{ ev.location }}</p>
      <p v-if="ev.description" class="small muted desc">{{ ev.description }}</p>
    </div>

    <div v-if="ev.upstreamFlag === 'changed' && ev.upstreamPending" class="banner warn upstream">
      <AppIcon name="warning" />
      <div class="spacer">
        <strong>Changed in the calendar</strong>
        <div class="small">
          <template v-if="ev.upstreamPending.title !== ev.title">Title: “{{ ev.upstreamPending.title }}”<br /></template>
          <template v-if="ev.upstreamPending.start !== ev.start || ev.upstreamPending.end !== ev.end">
            Dates: {{ formatRange(ev.upstreamPending.start, ev.upstreamPending.end) }} (was {{ formatRange(ev.start, ev.end) }})
          </template>
        </div>
        <div class="row" style="margin-top: 6px">
          <button class="btn primary" :disabled="data.readOnly" @click="accept">Apply change</button>
          <button class="btn text" :disabled="data.readOnly" @click="ignore">Keep mine</button>
        </div>
      </div>
    </div>
    <div v-if="ev.upstreamFlag === 'removed'" class="banner warn upstream">
      <AppIcon name="warning" />
      <div class="spacer">
        <strong>Removed from the calendar</strong>
        <div class="small">The source no longer contains this event, but you already planned for it.</div>
        <div class="row" style="margin-top: 6px">
          <button class="btn danger" :disabled="data.readOnly" @click="remove">Delete event</button>
          <button class="btn text" :disabled="data.readOnly" @click="ignore">Keep as manual event</button>
        </div>
      </div>
    </div>

    <h2>Coverage</h2>
    <div class="card">
      <p v-if="!data.kids.length" class="muted small">Add kids in <RouterLink to="/settings">Settings</RouterLink> to plan coverage.</p>
      <CoverageEditor v-else :event="ev" />
    </div>

    <h2>Tasks <template v-if="progress.total">· {{ progress.done }}/{{ progress.total }}</template></h2>
    <div class="card">
      <template v-for="g in taskGroups" :key="g.key">
        <h3 v-if="g.heading" class="coverage-head">{{ g.heading }}</h3>
        <TaskTree :tasks="g.tasks" :event-id="ev.id" :segment-id="g.segmentId" />
      </template>
    </div>

    <h2>Reminders</h2>
    <div class="card small">
      <template v-if="undecided && ev.start >= data.today">
        <div v-if="schedule.length">
          Next reminder <strong>{{ formatDate(schedule[0], { weekday: "short", day: "numeric", month: "short" }) }}</strong>
          <span class="muted"> · then {{ schedule.length - 1 }} more until the event</span>
        </div>
        <div v-else class="muted">No more reminder tiers before the event.</div>
        <div class="muted" style="margin-top: 4px">
          {{ CATEGORY_LABELS[ev.category] }} tiers: {{ data.settings.reminderTiers[ev.category].tiers.join(", ") }} days before<template
            v-if="data.settings.reminderTiers[ev.category].repeatEveryDays"
            >, then every {{ data.settings.reminderTiers[ev.category].repeatEveryDays }} days</template
          >.
        </div>
      </template>
      <div v-else class="muted">Decided — no decision reminders.</div>
      <div v-if="dueSoonTasks" style="margin-top: 4px">{{ dueSoonTasks }} task{{ dueSoonTasks === 1 ? "" : "s" }} overdue or due soon.</div>
      <RouterLink to="/settings#reminders" class="small">Reminder settings</RouterLink>
    </div>
  </div>
</template>

<style scoped>
.header .title {
  font-size: 22px;
}
.desc {
  white-space: pre-line;
  max-height: 8em;
  overflow: auto;
}
.upstream {
  align-items: flex-start;
}
.coverage-head {
  font-size: 15px;
  margin: 14px 0 0;
}
.coverage-head:first-child {
  margin-top: 0;
}
</style>
