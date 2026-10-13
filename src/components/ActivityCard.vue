<script setup lang="ts">
import { computed } from "vue";
import AppIcon from "@/components/AppIcon.vue";
import { ageLabel, hikeLine, SOURCE_NAMES, seasonLabel, travelMinutes, type Activity, type ActivityDate } from "@/core/activities";
import { formatDate } from "@/core/dates";

const props = defineProps<{
  activity: Activity;
  /** Dates within the chosen range, for courses and events. */
  dates?: ActivityDate[];
}>();

const MAX_DATES = 3;

function duration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m}` : `${h} h`;
}

const travel = computed(() => {
  const a = props.activity;
  const t = travelMinutes(a);
  if (!t) return "";
  const how = a.transitMin !== undefined ? "🚆 " : a.carMin !== undefined ? "🚗 " : "~";
  return `${how}${duration(t.minutes)}`;
});

const meta = computed(() => [props.activity.kind, props.activity.place, travel.value].filter(Boolean).join(" · "));

const facts = computed(() => {
  const a = props.activity;
  const out: string[] = [];
  const age = ageLabel(a);
  if (age) out.push(age);
  const season = seasonLabel(a.months);
  if (season) out.push(season);
  if (a.costChf === 0) out.push("free");
  else if (a.costChf !== undefined) out.push(`CHF ${a.costChf}`);
  if (a.stroller === true) out.push("stroller ok");
  if (a.stroller === false) out.push("no stroller");
  if (a.booking === "drop-in") out.push("drop in");
  if (a.booking === "required") out.push("sign-up");
  return out;
});

function dateText(d: ActivityDate): string {
  const opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" };
  const day = d.end && d.end !== d.start ? `${formatDate(d.start, opts)} – ${formatDate(d.end, opts)}` : formatDate(d.start, opts);
  return d.time ? `${day}, ${d.time}` : day;
}

const weekly = computed(() => {
  const days = props.activity.weekdays;
  if (!days?.length) return "";
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `weekly on ${days.map((d) => names[d]).join(", ")}`;
});
</script>

<template>
  <div class="card activity">
    <div class="row head">
      <a :href="activity.url" target="_blank" rel="noopener noreferrer" class="title">{{ activity.title }}</a>
      <span v-if="activity.booking === 'closed'" class="tag warn">Full</span>
      <span class="spacer" />
      <a :href="activity.url" target="_blank" rel="noopener noreferrer" class="icon-btn" :title="`Open on ${SOURCE_NAMES[activity.source]}`">
        <AppIcon name="open" :size="18" />
      </a>
    </div>
    <div class="small muted">{{ meta }}</div>
    <div v-if="hikeLine(activity)" class="small">{{ hikeLine(activity) }}</div>
    <ul v-if="dates?.length" class="dates small">
      <li v-for="d in dates.slice(0, MAX_DATES)" :key="d.start + (d.time ?? '')">{{ dateText(d) }}<template v-if="weekly"> · {{ weekly }}</template></li>
      <li v-if="dates.length > MAX_DATES" class="muted">+{{ dates.length - MAX_DATES }} more dates</li>
    </ul>
    <div v-if="facts.length" class="facts">
      <span v-for="f in facts" :key="f" class="tag">{{ f }}</span>
    </div>
    <div class="source small muted">{{ SOURCE_NAMES[activity.source] }}</div>
  </div>
</template>

<style scoped>
.activity {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.head {
  align-items: flex-start;
  gap: 6px;
}
.title {
  font-weight: 500;
  color: var(--text);
  text-decoration: none;
  overflow-wrap: anywhere;
}
.title:hover {
  text-decoration: underline;
}
.head .icon-btn {
  margin: -6px -6px -6px 0;
  color: var(--text-2);
}
.dates {
  margin: 2px 0 0;
  padding-left: 18px;
}
.facts {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}
.source {
  font-size: 11px;
  margin-top: 2px;
}
</style>
