<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import ActivityCard from "@/components/ActivityCard.vue";
import AddActivitySheet from "@/components/AddActivitySheet.vue";
import AppIcon from "@/components/AppIcon.vue";
import BottomSheet from "@/components/BottomSheet.vue";
import WeekendWeather from "@/components/WeekendWeather.vue";
import {
  activityCategory,
  CATEGORIES,
  feedKey,
  findIdeas,
  SOURCE_SHORT_NAMES,
  type Activity,
  type ActivityCategory,
  type ActivityDate,
  type ActivitySourceId,
  type Ideas,
  type SettingFilter,
} from "@/core/activities";
import { climateCell, typicalWeather } from "@/core/climate";
import { formatDate } from "@/core/dates";
import { ideaTargets, resolveTarget, type IdeaTarget } from "@/core/ideaTargets";
import { useActivitiesStore } from "@/stores/activities";
import { useDataStore } from "@/stores/data";
import { useUiStore } from "@/stores/ui";
import { useWeatherStore } from "@/stores/weather";

const route = useRoute();
const router = useRouter();
const data = useDataStore();
const ui = useUiStore();
const store = useActivitiesStore();
const weather = useWeatherStore();
store.ensure();
weather.ensure();

const PAGE = 25;

// Target: the weekend or holiday to plan for, kept in the URL (?for=weekend:2026-10-24).
const target = computed(() => resolveTarget(typeof route.query.for === "string" ? route.query.for : undefined, data.events, data.today));
const targets = computed(() => ideaTargets(data.events, data.today));
const picking = ref(false);
function pick(t: IdeaTarget) {
  picking.value = false;
  router.replace({ query: { for: t.key } });
}

const isWeekend = computed(() => target.value.kind === "weekend");

// Filters start cleared; nothing selected means no restriction.
const setting = ref<SettingFilter>("any");
function toggleSetting(s: SettingFilter) {
  setting.value = setting.value === s ? "any" : s;
}

const TRAVEL = [
  { label: "≤ 30 min", value: 30 },
  { label: "≤ 1 h", value: 60 },
  { label: "≤ 2 h", value: 120 },
] as const;
const maxMinutes = ref<number | null>(null);

const selectedCategories = ref<ActivityCategory[]>([]);
const excludedSources = ref<ActivitySourceId[]>([]);
function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}

/** The filter tab whose chips are showing; null when all are closed. */
const openFilter = ref<FilterGroup | null>(null);

/** Kids the target is for, matched by birth year. */
const birthYears = computed(() => {
  const event = target.value.eventId ? data.eventsById.get(target.value.eventId) : undefined;
  const kids = event ? data.relevantKids(event) : data.kids;
  return kids.map((k) => k.birthYear).filter((y): y is number => typeof y === "number");
});

const hiddenSources = computed(() => data.settings.hiddenIdeaSources);

/** Favourite and not-relevant marks, as activity id sets for findIdeas. */
const favoriteIds = computed(() => new Set(data.ideaMarks.filter((m) => m.mark === "favorite").map((m) => m.activityId)));
const hiddenIds = computed(() => new Set(data.ideaMarks.filter((m) => m.mark === "hidden").map((m) => m.activityId)));
const hiddenMarks = computed(() => data.ideaMarks.filter((m) => m.mark === "hidden").sort((a, b) => a.title.localeCompare(b.title)));
const showHidden = ref(false);

function markOf(a: Activity) {
  return data.ideaMarksByActivity.get(a.id)?.mark;
}

function setMark(a: { id: string; title: string }, mark: "favorite" | "hidden" | null) {
  ui.run(() => data.setIdeaMark(a, mark), mark === "hidden" ? `Hid ${a.title}` : undefined);
}

/** Matches from every source enabled in Settings, before the category and source chips. */
const allIdeas = computed(() =>
  findIdeas(store.activities, {
    start: target.value.start,
    end: target.value.end,
    setting: setting.value,
    maxMinutes: maxMinutes.value,
    birthYears: birthYears.value,
    hiddenSources: hiddenSources.value,
    favorites: favoriteIds.value,
    hidden: hiddenIds.value,
  }),
);

function filterIdeas(all: Ideas, keep: (a: Activity) => boolean): Ideas {
  return {
    dated: all.dated.filter((d) => keep(d.activity)),
    weekly: all.weekly.filter((d) => keep(d.activity)),
    places: all.places.filter(keep),
  };
}
const inCategory = (a: Activity) => !selectedCategories.value.length || selectedCategories.value.includes(activityCategory(a));
const inSource = (a: Activity) => !excludedSources.value.includes(a.source);

function countBy<K extends string>(ideas: Ideas, key: (a: Activity) => K): Partial<Record<K, number>> {
  const counts: Partial<Record<K, number>> = {};
  for (const a of [...ideas.dated.map((d) => d.activity), ...ideas.weekly.map((d) => d.activity), ...ideas.places]) {
    counts[key(a)] = (counts[key(a)] ?? 0) + 1;
  }
  return counts;
}
const categoryCounts = computed(() => countBy(filterIdeas(allIdeas.value, inSource), activityCategory));
const sourceCounts = computed(() => countBy(filterIdeas(allIdeas.value, inCategory), (a) => a.source));
const ideas = computed(() => filterIdeas(allIdeas.value, (a) => inCategory(a) && inSource(a)));

const categoryChips = computed(() =>
  CATEGORIES.filter((c) => (categoryCounts.value[c.id] ?? 0) > 0 || selectedCategories.value.includes(c.id)),
);
/** Sources enabled in Settings (a source whose feeds are all off counts as off). */
const sourceChips = computed(() =>
  (store.index?.sources ?? []).filter((s) => {
    const hidden = hiddenSources.value;
    if (!s.count || hidden.includes(s.id)) return false;
    return !s.feeds?.length || s.feeds.some((f) => !hidden.includes(feedKey(s.id, f.id)));
  }),
);

type FilterGroup = "general" | "type" | "source";

/** How many filters each tab has set, shown as a badge so a closed tab still tells. */
const activeCounts = computed<Record<FilterGroup, number>>(() => ({
  general: Number(setting.value !== "any") + Number(maxMinutes.value !== null),
  type: selectedCategories.value.length,
  source: sourceChips.value.filter((c) => excludedSources.value.includes(c.id)).length,
}));

/** Badge per tab: filters set, except Source, which counts the sources still shown. */
const badges = computed<Record<FilterGroup, number>>(() => ({
  ...activeCounts.value,
  source: sourceChips.value.length - activeCounts.value.source,
}));

const filterTabs = computed(() =>
  (
    [
      { id: "general", label: "General" },
      { id: "type", label: "Type" },
      { id: "source", label: "Source" },
    ] as const
  ).filter((t) => t.id !== "source" || sourceChips.value.length > 1),
);

function clearGroup(group: FilterGroup) {
  if (group === "general") {
    setting.value = "any";
    maxMinutes.value = null;
  } else if (group === "type") selectedCategories.value = [];
  else excludedSources.value = [];
}

const datedShown = ref(PAGE);
const placesShown = ref(PAGE);
watch(ideas, () => {
  datedShown.value = PAGE;
  placesShown.value = PAGE;
});


// Typical weather at outdoor places for the target's dates.
function typical(a: Activity): string | undefined {
  if (a.setting === "indoor" || a.dates || a.lat === undefined || a.lng === undefined) return undefined;
  const climate = store.index?.climate?.[climateCell(a.lat, a.lng)];
  const t = climate && typicalWeather(climate, target.value.start, target.value.end, a.altitudeM);
  if (!t) return undefined;
  const at = a.altitudeM !== undefined && a.altitudeM >= 800 ? ` at ${a.altitudeM} m` : "";
  return `Typically ${t.high}°${at} · ${t.rain}% rainy days`;
}

// Planning a place into the target.
const targetEvent = computed(() => (target.value.eventId ? data.eventsById.get(target.value.eventId) : undefined));
/** Days each activity is already planned on, by title (the coverage block name). */
const planned = computed(() => {
  const out = new Map<string, string>();
  for (const s of targetEvent.value?.segments ?? []) {
    const name = s.name?.trim();
    if (!name || !Object.values(s.statuses ?? {}).includes("activity")) continue;
    const opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" };
    const when = s.start === s.end ? formatDate(s.start, opts) : `${formatDate(s.start, opts)} – ${formatDate(s.end, opts)}`;
    out.set(name, out.has(name) ? `${out.get(name)}, ${when}` : when);
  }
  return out;
});
const addTo = computed(() => (data.readOnly ? undefined : target.value.title));
const adding = ref<{ activity: Activity; dates?: ActivityDate[] } | null>(null);
const addingTypical = computed(() => (adding.value ? typical(adding.value.activity) : undefined));

</script>

<template>
  <div class="page">
    <div class="card filters">
      <button class="target" aria-haspopup="dialog" @click="picking = true">
        <span class="target-text">
          <strong>{{ target.title }}</strong>
          <span class="small muted">{{ target.sub }}</span>
        </span>
        <AppIcon name="chevron" class="down" />
      </button>
      <WeekendWeather v-if="isWeekend" :event="{ category: 'weekend', start: target.start, end: target.end }" />

      <div class="filter-tabs" role="tablist">
        <button
          v-for="t in filterTabs"
          :key="t.id"
          class="filter-tab"
          role="tab"
          :aria-selected="openFilter === t.id"
          :class="{ open: openFilter === t.id, active: activeCounts[t.id] > 0 }"
          @click="openFilter = openFilter === t.id ? null : t.id"
        >
          <span>{{ t.label }}</span>
          <span v-if="t.id === 'source' || badges[t.id]" class="badge">{{ badges[t.id] }}</span>
          <AppIcon name="chevron" :size="16" class="chev" />
        </button>
      </div>
      <div v-if="openFilter" class="filter-body" role="tabpanel">
        <template v-if="openFilter === 'general'">
          <div class="chips wrap">
            <button class="chip" :class="{ selected: setting === 'outdoor' }" @click="toggleSetting('outdoor')">Outdoor</button>
            <button class="chip" :class="{ selected: setting === 'indoor' }" @click="toggleSetting('indoor')">Indoor</button>
          </div>
          <div class="chips wrap">
            <button
              v-for="t in TRAVEL"
              :key="t.label"
              class="chip"
              :class="{ selected: maxMinutes === t.value }"
              @click="maxMinutes = maxMinutes === t.value ? null : t.value"
            >
              {{ t.label }}
            </button>
          </div>
        </template>
        <div v-else-if="openFilter === 'type'" class="chips wrap">
          <button
            v-for="c in categoryChips"
            :key="c.id"
            class="chip"
            :class="{ selected: selectedCategories.includes(c.id) }"
            @click="selectedCategories = toggle(selectedCategories, c.id)"
          >
            {{ c.label }} <span class="count">{{ categoryCounts[c.id] ?? 0 }}</span>
          </button>
        </div>
        <div v-else class="chips wrap">
          <button
            v-for="s in sourceChips"
            :key="s.id"
            class="chip"
            :class="{ selected: !excludedSources.includes(s.id) }"
            @click="excludedSources = toggle(excludedSources, s.id)"
          >
            {{ SOURCE_SHORT_NAMES[s.id] }} <span class="count">{{ sourceCounts[s.id] ?? 0 }}</span>
          </button>
        </div>
        <button v-if="activeCounts[openFilter]" class="btn text clear" @click="clearGroup(openFilter)">Clear</button>
      </div>
    </div>

    <div v-if="!store.index && store.loading" class="empty">Loading ideas…</div>
    <div v-else-if="!store.index" class="empty">
      <div class="big">🧭</div>
      <p>{{ store.error ?? "No activity index yet." }}</p>
      <button class="btn tonal" @click="store.ensure(true)"><AppIcon name="refresh" /> Try again</button>
    </div>

    <template v-else>
      <section v-if="ideas.dated.length">
        <h2>On these dates · {{ ideas.dated.length }}</h2>
        <ActivityCard
          v-for="d in ideas.dated.slice(0, datedShown)"
          :key="d.activity.id"
          :activity="d.activity"
          :dates="d.dates"
          :add-to="addTo"
          :planned="planned.get(d.activity.title)"
          :mark="markOf(d.activity)"
          :markable="!data.readOnly"
          @add="adding = { activity: d.activity, dates: d.dates }"
          @mark="(m) => setMark(d.activity, m)"
        />
        <button v-if="ideas.dated.length > datedShown" class="btn text more" @click="datedShown += PAGE">
          Show more ({{ ideas.dated.length - datedShown }})
        </button>
      </section>

      <section v-if="ideas.places.length">
        <h2>Places · {{ ideas.places.length }}</h2>
        <ActivityCard
          v-for="a in ideas.places.slice(0, placesShown)"
          :key="a.id"
          :activity="a"
          :typical="typical(a)"
          :add-to="addTo"
          :planned="planned.get(a.title)"
          :mark="markOf(a)"
          :markable="!data.readOnly"
          @add="adding = { activity: a }"
          @mark="(m) => setMark(a, m)"
        />
        <button v-if="ideas.places.length > placesShown" class="btn text more" @click="placesShown += PAGE">
          Show more ({{ ideas.places.length - placesShown }})
        </button>
      </section>

      <div v-if="!ideas.dated.length && !ideas.places.length" class="empty">
        <div class="big">🔍</div>
        <p>Nothing matches. Try fewer filters.</p>
      </div>

      <section v-if="hiddenMarks.length" class="hidden-ideas">
        <button class="btn text more" :aria-expanded="showHidden" @click="showHidden = !showHidden">
          Not relevant · {{ hiddenMarks.length }}
          <AppIcon name="chevron" :size="18" class="chev" :class="{ up: showHidden }" />
        </button>
        <div v-if="showHidden" class="card">
          <div v-for="m in hiddenMarks" :key="m.id" class="row hidden-row">
            <span class="spacer">{{ m.title }}</span>
            <button class="btn text" :disabled="data.readOnly" @click="setMark({ id: m.activityId, title: m.title }, null)">Show again</button>
          </div>
        </div>
      </section>

    </template>

    <BottomSheet :open="picking" title="Plan ideas for" @close="picking = false">
      <template v-if="targets.vacations.length">
        <h3 class="group">Holidays</h3>
        <button
          v-for="t in targets.vacations"
          :key="t.key"
          class="target-row"
          :class="{ selected: t.key === target.key }"
          @click="pick(t)"
        >
          <span>{{ t.title }}</span>
          <span class="small muted">{{ t.sub }}</span>
        </button>
      </template>
      <h3 class="group">Weekends</h3>
      <button
        v-for="t in targets.weekends"
        :key="t.key"
        class="target-row"
        :class="{ selected: t.key === target.key }"
        @click="pick(t)"
      >
        <span>{{ t.title }}</span>
        <span class="small muted">{{ t.sub }}</span>
      </button>
    </BottomSheet>

    <AddActivitySheet
      :activity="adding?.activity ?? null"
      :dates="adding?.dates"
      :target="target"
      :typical="addingTypical"
      @close="adding = null"
    />
  </div>
</template>

<style scoped>
.filters {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.filters :deep(.weekend-weather) {
  margin-top: 0;
  font-size: 13px;
}
.target,
.filter-tab,
.target-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  border: 0;
  background: none;
  padding: 0;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.target-text {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}
.target-text strong {
  font-size: 18px;
}
.down {
  transform: rotate(90deg);
  color: var(--text-2);
}
.filter-tabs {
  display: flex;
  margin-top: 10px;
  border-top: 1px solid var(--outline);
}
.filter-tab {
  flex: 1;
  justify-content: center;
  gap: 4px;
  padding: 10px 0 6px;
  border-bottom: 2px solid transparent;
  font-weight: 500;
  color: var(--text-2);
}
.filter-tab.active {
  color: var(--text);
}
.filter-tab.open {
  color: var(--primary);
  border-bottom-color: var(--primary);
}
.badge {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--primary-container);
  color: var(--on-primary-container);
  font-size: 11px;
  line-height: 18px;
  text-align: center;
}
.chev {
  transform: rotate(90deg);
  transition: transform 0.15s;
}
.filter-tab.open .chev {
  transform: rotate(-90deg);
}
.filter-body {
  margin-top: 8px;
}
.filter-body .chips {
  padding-bottom: 4px;
}
.count {
  font-weight: 400;
  opacity: 0.7;
}
.clear {
  margin: 4px 0 0 auto;
  display: flex;
}
.group {
  margin: 12px 0 4px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-2);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.target-row {
  justify-content: space-between;
  padding: 10px 8px;
  border-radius: 8px;
}
.target-row.selected {
  background: var(--primary-container);
  color: var(--on-primary-container);
}
.hidden-ideas .chev.up {
  transform: rotate(-90deg);
}
.hidden-row {
  align-items: center;
  gap: 8px;
}
.hidden-row + .hidden-row {
  border-top: 1px solid var(--outline);
}
.more {
  display: flex;
  margin: 0 auto 10px;
}
</style>
