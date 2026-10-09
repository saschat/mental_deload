<script setup lang="ts">
import { computed, ref } from "vue";
import KidAvatar from "@/components/KidAvatar.vue";
import { formatRange, parseLocal } from "@/core/dates";
import { kidSegmentSummary } from "@/core/coverage";
import { CATEGORY_LABELS, statusColor, statusLabel } from "@/core/defaults";
import { taskProgress } from "@/core/tasks";
import { matchesUpcomingFilter } from "@/core/upcoming";
import type { FamilyEvent, StatusKey } from "@/core/types";
import { timeLabel } from "@/lib/eventMeta";
import { useDataStore } from "@/stores/data";

const data = useDataStore();
const filter = ref<"upcoming" | "all" | "undecided" | string>("upcoming");

const filtered = computed(() => data.upcomingEvents.filter((e) => matchesUpcomingFilter(e, data.kids, filter.value)));

const narrowed = computed(() => filter.value !== "upcoming");

const months = computed(() => {
  const groups: { key: string; label: string; events: FamilyEvent[] }[] = [];
  for (const ev of filtered.value) {
    const key = ev.start < data.today ? data.today.slice(0, 7) : ev.start.slice(0, 7);
    let g = groups.find((x) => x.key === key);
    if (!g) {
      const label = parseLocal(`${key}-01`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
      g = { key, label, events: [] };
      groups.push(g);
    }
    g.events.push(ev);
  }
  return groups;
});

function kidsFor(ev: FamilyEvent) {
  const kids = data.relevantKids(ev);
  const broad = filter.value === "upcoming" || filter.value === "all" || filter.value === "undecided";
  return broad ? kids : kids.filter((k) => k.id === filter.value);
}

function pillText(ev: FamilyEvent, kidId: string): { text: string; status: StatusKey | null } {
  const parts = kidSegmentSummary(ev, kidId);
  const shown = (p: (typeof parts)[number]) => p.name || (p.status ? statusLabel(p.status) : "");
  if (parts.length === 1) {
    const p = parts[0];
    const base = shown(p);
    return { text: base ? base + (p.label ? ` (${p.label})` : "") : "Undecided", status: p.status };
  }
  return {
    text: parts.map((p) => `${p.label} ${shown(p) || "?"}`).join(" / "),
    status: parts.find((p) => p.status)?.status ?? null,
  };
}

function progress(ev: FamilyEvent) {
  return taskProgress(data.tasksByEvent.get(ev.id) ?? []);
}

function day(ev: FamilyEvent) {
  const d = parseLocal(ev.start);
  return { num: d.getDate(), wd: d.toLocaleDateString("en-GB", { weekday: "short" }) };
}
</script>

<template>
  <div class="page">
    <div class="chips">
      <button class="chip" :class="{ selected: filter === 'upcoming' }" @click="filter = 'upcoming'">Upcoming</button>
      <button class="chip" :class="{ selected: filter === 'all' }" @click="filter = 'all'">All</button>
      <button v-for="k in data.sortedKids" :key="k.id" class="chip" :class="{ selected: filter === k.id }" @click="filter = k.id">
        <span class="dot" :style="{ background: k.color }" /> {{ k.name }}
      </button>
      <button class="chip" :class="{ selected: filter === 'undecided' }" @click="filter = 'undecided'">Undecided only</button>
    </div>

    <div v-if="!months.length" class="empty">
      <div class="big">🗓️</div>
      <p>No upcoming events{{ narrowed ? " for this filter" : "" }}.</p>
    </div>

    <section v-for="m in months" :key="m.key">
      <h2>{{ m.label }}</h2>
      <RouterLink v-for="ev in m.events" :key="ev.id" :to="`/event/${ev.id}`" class="card agenda">
        <div class="date-block" :class="{ ongoing: ev.start < data.today }">
          <span class="num">{{ day(ev).num }}</span>
          <span class="wd">{{ day(ev).wd }}</span>
        </div>
        <div class="info">
          <div class="row">
            <strong class="title">{{ ev.title }}</strong>
            <span v-if="ev.upstreamFlag" class="tag warn">{{ ev.upstreamFlag === "changed" ? "Changed" : "Removed" }} upstream</span>
          </div>
          <div class="small muted">
            {{ formatRange(ev.start, ev.end) }}<template v-if="timeLabel(ev)"> · {{ timeLabel(ev) }}</template> ·
            {{ CATEGORY_LABELS[ev.category] }}
          </div>
          <div class="pills">
            <span v-for="k in kidsFor(ev)" :key="k.id" class="pill" :class="{ undecided: !pillText(ev, k.id).status }">
              <KidAvatar :kid="k" :size="20" />
              <span
                class="pill-text"
                :style="pillText(ev, k.id).status ? { color: statusColor(data.settings, pillText(ev, k.id).status!) } : {}"
              >{{ pillText(ev, k.id).text }}</span>
            </span>
          </div>
          <div v-if="progress(ev).total" class="row small muted" style="margin-top: 6px">
            <span>Tasks {{ progress(ev).done }}/{{ progress(ev).total }}</span>
            <div class="progress"><div :style="{ width: `${(progress(ev).done / progress(ev).total) * 100}%` }" /></div>
          </div>
        </div>
      </RouterLink>
    </section>
  </div>
</template>

<style scoped>
.agenda {
  display: flex;
  gap: 14px;
  color: inherit;
  text-decoration: none;
}
.date-block {
  width: 48px;
  flex-shrink: 0;
  border-radius: 12px;
  background: var(--primary-container);
  color: var(--on-primary-container);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 54px;
}
.date-block.ongoing {
  background: var(--surface-3);
  color: var(--text-2);
}
.num {
  font-size: 20px;
  font-weight: 600;
  line-height: 1;
}
.wd {
  font-size: 11px;
  text-transform: uppercase;
}
.info {
  flex: 1;
  min-width: 0;
}
.title {
  font-weight: 500;
}
.pills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}
.pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--surface-2);
  border-radius: 14px;
  padding: 2px 10px 2px 2px;
  font-size: 12px;
  font-weight: 500;
}
.pill.undecided {
  background: transparent;
  border: 1px dashed var(--outline);
  color: var(--text-2);
}
.pill-text {
  filter: brightness(0.75);
}
</style>
