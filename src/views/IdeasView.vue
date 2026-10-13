<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import ActivityCard from "@/components/ActivityCard.vue";
import AppIcon from "@/components/AppIcon.vue";
import WeekendWeather from "@/components/WeekendWeather.vue";
import {
  feedKey,
  findIdeas,
  SOURCE_SHORT_NAMES,
  suggestedSetting,
  weekendFrom,
  type ActivitySourceId,
  type Ideas,
  type SettingFilter,
} from "@/core/activities";
import { diffDays, formatRange, weekday } from "@/core/dates";
import { useActivitiesStore } from "@/stores/activities";
import { useDataStore } from "@/stores/data";
import { useWeatherStore } from "@/stores/weather";

const route = useRoute();
const router = useRouter();
const data = useDataStore();
const store = useActivitiesStore();
const weather = useWeatherStore();
store.ensure();
weather.ensure();

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const PAGE = 25;

/** A range handed over from an event page (`?start=…&end=…&title=…`). */
const fromEvent = computed(() => {
  const { start, end, title } = route.query;
  if (typeof start !== "string" || typeof end !== "string" || !ISO.test(start) || !ISO.test(end) || end < start) return null;
  return { start, end, title: typeof title === "string" && title ? title : formatRange(start, end) };
});

type RangeKey = "event" | "this" | "next";
const rangeKey = ref<RangeKey>(fromEvent.value ? "event" : "this");
watch(fromEvent, (e) => (rangeKey.value = e ? "event" : "this"));

const range = computed(() => {
  if (rangeKey.value === "event" && fromEvent.value) return fromEvent.value;
  return weekendFrom(data.today, rangeKey.value === "next" ? 1 : 0);
});
const isWeekend = computed(() => weekday(range.value.start) === 6 && diffDays(range.value.start, range.value.end) === 1);

const forecast = computed(() =>
  isWeekend.value ? weather.forEvent({ category: "weekend", start: range.value.start, end: range.value.end }, data.today) : null,
);
const suggested = computed(() => suggestedSetting(forecast.value?.rainProbability));
const chosenSetting = ref<SettingFilter | null>(null);
const setting = computed(() => chosenSetting.value ?? suggested.value);
watch(rangeKey, () => (chosenSetting.value = null));

const TRAVEL = [
  { label: "≤ 30 min", value: 30 },
  { label: "≤ 1 h", value: 60 },
  { label: "≤ 2 h", value: 120 },
  { label: "Any distance", value: null },
] as const;
const maxMinutes = ref<number | null>(60);

const kidsWithYear = computed(() => data.sortedKids.filter((k) => typeof k.birthYear === "number"));
const excludedKids = ref<string[]>([]);
const birthYears = computed(() => kidsWithYear.value.filter((k) => !excludedKids.value.includes(k.id)).map((k) => k.birthYear!));
function toggleKid(id: string) {
  excludedKids.value = excludedKids.value.includes(id) ? excludedKids.value.filter((x) => x !== id) : [...excludedKids.value, id];
}

const text = ref("");

const hiddenSources = computed(() => data.settings.hiddenIdeaSources);

/** Matches from every source enabled in Settings, before the source chips. */
const allIdeas = computed(() =>
  findIdeas(store.activities, {
    start: range.value.start,
    end: range.value.end,
    setting: setting.value,
    maxMinutes: maxMinutes.value,
    birthYears: birthYears.value,
    text: text.value,
    hiddenSources: hiddenSources.value,
  }),
);

/** Sources enabled in Settings (a source whose feeds are all off counts as off). */
const enabledSources = computed(() =>
  (store.index?.sources ?? []).filter((s) => {
    const hidden = hiddenSources.value;
    if (!s.count || hidden.includes(s.id)) return false;
    return !s.feeds?.length || s.feeds.some((f) => !hidden.includes(feedKey(s.id, f.id)));
  }),
);

const excludedSources = ref<ActivitySourceId[]>([]);
function toggleSource(id: ActivitySourceId) {
  excludedSources.value = excludedSources.value.includes(id)
    ? excludedSources.value.filter((x) => x !== id)
    : [...excludedSources.value, id];
}

const matchCounts = computed(() => {
  const counts: Partial<Record<ActivitySourceId, number>> = {};
  const all = allIdeas.value;
  for (const a of [...all.dated.map((d) => d.activity), ...all.weekly.map((d) => d.activity), ...all.places]) {
    counts[a.source] = (counts[a.source] ?? 0) + 1;
  }
  return counts;
});

const ideas = computed<Ideas>(() => {
  const all = allIdeas.value;
  const off = excludedSources.value;
  if (!off.length) return all;
  return {
    dated: all.dated.filter((d) => !off.includes(d.activity.source)),
    weekly: all.weekly.filter((d) => !off.includes(d.activity.source)),
    places: all.places.filter((a) => !off.includes(a.source)),
  };
});

const datedShown = ref(PAGE);
const placesShown = ref(PAGE);
const weeklyShown = ref(0);
watch(ideas, () => {
  datedShown.value = PAGE;
  placesShown.value = PAGE;
  weeklyShown.value = 0;
});

const settingReason = computed(() => {
  const f = forecast.value;
  if (!f || chosenSetting.value) return "";
  const rain = `${Math.round(f.rainProbability)}% rain`;
  if (suggested.value === "indoor") return `${rain} — showing indoor ideas`;
  if (suggested.value === "outdoor") return `${rain} — showing outdoor ideas`;
  return "";
});

const updated = computed(() =>
  store.index ? new Date(store.index.generatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "",
);

function clearEvent() {
  router.replace({ query: {} });
}
</script>

<template>
  <div class="page">
    <div class="chips">
      <button v-if="fromEvent" class="chip" :class="{ selected: rangeKey === 'event' }" @click="rangeKey = 'event'">
        {{ fromEvent.title }}
      </button>
      <button class="chip" :class="{ selected: rangeKey === 'this' }" @click="rangeKey = 'this'">This weekend</button>
      <button class="chip" :class="{ selected: rangeKey === 'next' }" @click="rangeKey = 'next'">Next weekend</button>
      <button v-if="fromEvent" class="chip" title="Forget the event range" @click="clearEvent"><AppIcon name="close" :size="16" /></button>
    </div>

    <div class="card filters">
      <div class="row range">
        <strong>{{ formatRange(range.start, range.end) }}</strong>
        <WeekendWeather v-if="isWeekend" :event="{ category: 'weekend', start: range.start, end: range.end }" />
      </div>
      <div v-if="settingReason" class="small muted">{{ settingReason }}</div>

      <div class="chips wrap">
        <button class="chip" :class="{ selected: setting === 'any' }" @click="chosenSetting = 'any'">Indoor & outdoor</button>
        <button class="chip" :class="{ selected: setting === 'outdoor' }" @click="chosenSetting = 'outdoor'">Outdoor</button>
        <button class="chip" :class="{ selected: setting === 'indoor' }" @click="chosenSetting = 'indoor'">Indoor</button>
      </div>
      <div class="chips wrap">
        <button v-for="t in TRAVEL" :key="t.label" class="chip" :class="{ selected: maxMinutes === t.value }" @click="maxMinutes = t.value">
          {{ t.label }}
        </button>
      </div>
      <div v-if="kidsWithYear.length" class="chips wrap">
        <button v-for="k in kidsWithYear" :key="k.id" class="chip" :class="{ selected: !excludedKids.includes(k.id) }" @click="toggleKid(k.id)">
          <span class="dot" :style="{ background: k.color }" /> {{ k.name }}
        </button>
      </div>
      <p v-else-if="data.kids.length" class="small muted hint">
        Add birth years in <RouterLink to="/settings">Settings</RouterLink> to match ideas to your kids' ages.
      </p>
      <div v-if="enabledSources.length > 1" class="chips wrap">
        <button
          v-for="s in enabledSources"
          :key="s.id"
          class="chip"
          :class="{ selected: !excludedSources.includes(s.id) }"
          @click="toggleSource(s.id)"
        >
          {{ SOURCE_SHORT_NAMES[s.id] }} <span class="count">{{ matchCounts[s.id] ?? 0 }}</span>
        </button>
      </div>
      <RouterLink to="/settings#idea-sources" class="small sources-link">Choose sources and GZ centres in Settings</RouterLink>
      <input v-model="text" class="input search" type="search" placeholder="Search: zoo, sledding, Witikon…" aria-label="Search ideas" />
    </div>

    <div v-if="!store.index && store.loading" class="empty">Loading ideas…</div>
    <div v-else-if="!store.index" class="empty">
      <div class="big">🧭</div>
      <p>{{ store.error ?? "No activity index yet." }}</p>
      <button class="btn tonal" @click="store.ensure(true)"><AppIcon name="refresh" /> Try again</button>
    </div>

    <template v-else>
      <section v-if="ideas.dated.length">
        <h2>Camps & events · {{ ideas.dated.length }}</h2>
        <ActivityCard v-for="d in ideas.dated.slice(0, datedShown)" :key="d.activity.id" :activity="d.activity" :dates="d.dates" />
        <button v-if="ideas.dated.length > datedShown" class="btn text more" @click="datedShown += PAGE">
          Show more ({{ ideas.dated.length - datedShown }})
        </button>
      </section>

      <section v-if="ideas.places.length">
        <h2>Places · {{ ideas.places.length }}</h2>
        <ActivityCard v-for="a in ideas.places.slice(0, placesShown)" :key="a.id" :activity="a" />
        <button v-if="ideas.places.length > placesShown" class="btn text more" @click="placesShown += PAGE">
          Show more ({{ ideas.places.length - placesShown }})
        </button>
      </section>

      <section v-if="ideas.weekly.length">
        <h2>Weekly courses · {{ ideas.weekly.length }}</h2>
        <p class="small muted weekly-note">Run every week for a semester and need a sign-up for all of it.</p>
        <ActivityCard v-for="d in ideas.weekly.slice(0, weeklyShown)" :key="d.activity.id" :activity="d.activity" :dates="d.dates" />
        <button v-if="ideas.weekly.length > weeklyShown" class="btn text more" @click="weeklyShown += PAGE">
          {{ weeklyShown ? `Show more (${ideas.weekly.length - weeklyShown})` : "Show weekly courses" }}
        </button>
      </section>

      <div v-if="!ideas.dated.length && !ideas.places.length && !ideas.weekly.length" class="empty">
        <div class="big">🔍</div>
        <p>Nothing matches. Try a longer trip or the other setting.</p>
      </div>

      <p class="small muted footer">
        Index from {{ updated }}:
        <template v-for="(s, i) in store.index.sources" :key="s.id">
          <a :href="s.url" target="_blank" rel="noopener noreferrer">{{ s.name }}</a> ({{ s.count }}<span v-if="s.error" title="Last update failed; showing older entries">, stale</span>)<template v-if="i < store.index.sources.length - 1">, </template>
        </template>.
        Details, prices and dates can change: check the source before you go.
      </p>
    </template>
  </div>
</template>

<style scoped>
.filters {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.filters .chips {
  padding-bottom: 0;
}
.range {
  flex-wrap: wrap;
  gap: 4px 10px;
}
.range :deep(.weekend-weather) {
  margin-top: 0;
  font-size: 13px;
}
.count {
  font-weight: 400;
  opacity: 0.7;
}
.sources-link {
  margin: 4px 2px 0;
}
.hint {
  margin: 6px 0 0;
}
.search {
  margin-top: 10px;
  width: 100%;
}
.weekly-note {
  margin: -4px 4px 8px;
}
.more {
  display: flex;
  margin: 0 auto 10px;
}
.footer {
  margin-top: 24px;
  text-align: center;
}
</style>
