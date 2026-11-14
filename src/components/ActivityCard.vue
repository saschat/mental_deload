<script setup lang="ts">
import { computed } from "vue";
import AppIcon from "@/components/AppIcon.vue";
import { ageLabel, hikeLine, SOURCE_NAMES, SOURCE_SHORT_NAMES, seasonLabel, travelLabel, type Activity, type ActivityDate } from "@/core/activities";
import { formatDate } from "@/core/dates";

const props = defineProps<{
  activity: Activity;
  /** Dates within the chosen range, for courses and events. */
  dates?: ActivityDate[];
  /** Name of the weekend or holiday to plan it into; no add button when missing. */
  addTo?: string;
  /** Days it is already planned on, e.g. "Sat 24 Oct". */
  planned?: string;
  /** Typical weather there for the chosen dates, e.g. "Typically 9° at 2125 m · 35% rainy days". */
  typical?: string;
  /** The user's mark; the star and hide buttons only show when `markable`. */
  mark?: "favorite" | "hidden";
  markable?: boolean;
  /** Last day it is kept out of the picks, when snoozed for the chosen dates. */
  snoozedUntil?: string;
}>();
const emit = defineEmits<{ add: []; mark: ["favorite" | "hidden" | null]; snooze: [] }>();

const MAX_DATES = 3;

const meta = computed(() => [props.activity.kind, props.activity.place, travelLabel(props.activity)].filter(Boolean).join(" · "));

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
      <button
        v-if="markable && mark !== 'hidden'"
        class="icon-btn star"
        :class="{ on: mark === 'favorite' }"
        :title="mark === 'favorite' ? 'Remove from favourites' : 'Add to favourites'"
        :aria-label="mark === 'favorite' ? 'Remove from favourites' : 'Add to favourites'"
        :aria-pressed="mark === 'favorite'"
        @click="emit('mark', mark === 'favorite' ? null : 'favorite')"
      >
        <AppIcon :name="mark === 'favorite' ? 'star' : 'starOutline'" :size="20" />
      </button>
      <button
        v-if="addTo"
        class="icon-btn add"
        :class="{ done: planned }"
        :title="planned ? `Planned for ${planned}` : `Add to ${addTo}`"
        :aria-label="planned ? `Planned for ${planned}; add again` : `Add to ${addTo}`"
        @click="emit('add')"
      >
        <AppIcon :name="planned ? 'check' : 'add'" :size="20" />
      </button>
      <a :href="activity.url" target="_blank" rel="noopener noreferrer" class="icon-btn" :title="`Open on ${SOURCE_NAMES[activity.source]}`">
        <AppIcon name="open" :size="18" />
      </a>
    </div>
    <div class="small muted">{{ meta }}</div>
    <div v-if="hikeLine(activity)" class="small">{{ hikeLine(activity) }}</div>
    <div v-if="typical" class="small muted" title="Average daytime high and share of days with rain, from ten years of weather history">
      {{ typical }}
    </div>
    <ul v-if="dates?.length" class="dates small">
      <li v-for="d in dates.slice(0, MAX_DATES)" :key="d.start + (d.time ?? '')">{{ dateText(d) }}<template v-if="weekly"> · {{ weekly }}</template></li>
      <li v-if="dates.length > MAX_DATES" class="muted">+{{ dates.length - MAX_DATES }} more dates</li>
    </ul>
    <div v-if="facts.length || planned" class="facts">
      <span v-if="planned" class="tag ok">Planned · {{ planned }}</span>
      <span v-for="f in facts" :key="f" class="tag">{{ f }}</span>
    </div>
    <div class="row foot">
      <span class="source small muted">
        {{ SOURCE_NAMES[activity.source] }}
        <template v-if="activity.also?.length">
          · also on
          <template v-for="(l, i) in activity.also" :key="l.id"
            ><template v-if="i">, </template
            ><a :href="l.url" target="_blank" rel="noopener noreferrer" :title="l.title">{{ SOURCE_SHORT_NAMES[l.source] }}</a></template
          >
        </template>
      </span>
      <span v-if="markable" class="actions">
        <button v-if="mark !== 'hidden'" class="hide small" :class="{ on: snoozedUntil }" aria-haspopup="dialog" @click="emit('snooze')">
          {{ snoozedUntil ? `Snoozed till ${formatDate(snoozedUntil, { day: "numeric", month: "short" })}` : "Snooze" }}
        </button>
        <button class="hide small" @click="emit('mark', mark === 'hidden' ? null : 'hidden')">
          {{ mark === "hidden" ? "Show again" : "Not relevant" }}
        </button>
      </span>
    </div>
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
.head .add {
  color: var(--primary);
}
.head .add.done {
  color: var(--ok);
}
.tag.ok {
  background: #e3f4e5;
  color: var(--ok);
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
.head .star.on {
  color: var(--yellow);
}
.foot {
  flex-wrap: wrap;
  align-items: center;
  margin-top: 2px;
}
.actions {
  display: flex;
  gap: 16px;
  margin-left: auto;
  white-space: nowrap;
}
.source {
  font-size: 11px;
}
.source a {
  color: inherit;
}
.hide {
  border: 0;
  background: none;
  padding: 2px 0;
  font: inherit;
  font-size: 12px;
  color: var(--text-2);
  cursor: pointer;
}
.hide.on {
  color: var(--primary);
}
.hide:hover {
  color: var(--text);
  text-decoration: underline;
}
</style>
