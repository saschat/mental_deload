<script setup lang="ts">
import { computed, ref, watch } from "vue";
import AppIcon from "@/components/AppIcon.vue";
import { travelLabel, type ActivityDate } from "@/core/activities";
import { formatDate } from "@/core/dates";
import type { IdeaGroup, IdeaItem } from "@/core/groups";

const props = defineProps<{
  group: IdeaGroup;
  /** Members in list order; the first leads. */
  items: IdeaItem[];
  /** Open with the members showing, e.g. while searching. */
  startOpen?: boolean;
  /** Snooze and Not relevant only show when set. */
  markable?: boolean;
  /** Last day the group is kept out of the picks. */
  snoozedUntil?: string;
}>();
const emit = defineEmits<{ snooze: []; hide: [] }>();

const open = ref(!!props.startOpen);
watch(
  () => props.startOpen,
  (v) => (open.value = !!v),
);

const isEvent = computed(() => props.items.some((i) => i.dates));
const places = computed(() => [...new Set(props.items.map((i) => i.activity.place).filter(Boolean))] as string[]);
/** "14 places", or "3 dates" for one place on several days. */
const count = computed(() =>
  isEvent.value && places.value.length < 2 ? `${props.items.length} dates` : `${props.items.length} places`,
);

const SHOWN = 3;
/** The first few members with town and travel time: what the group is about at a glance. */
const preview = computed(() =>
  props.items.slice(0, SHOWN).map((i) => {
    const a = i.activity;
    const where = isEvent.value ? a.place : [a.place && !a.title.includes(a.place) ? a.place : "", travelLabel(a)].filter(Boolean).join(", ");
    return { id: a.id, title: isEvent.value ? "" : a.title, where };
  }),
);

/** Days the events are on, soonest first. */
const days = computed(() => {
  const all = props.items.flatMap((i) => i.dates ?? []).map((d: ActivityDate) => d.start);
  const unique = [...new Set(all)].sort();
  const opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" };
  const shown = unique.slice(0, SHOWN).map((d) => formatDate(d, opts));
  return unique.length > SHOWN ? `${shown.join(", ")} +${unique.length - SHOWN}` : shown.join(", ");
});

/** "5 indoor · 30 outdoor" when the members differ, which matters when it rains. */
const settings = computed(() => {
  const n = { indoor: 0, outdoor: 0 };
  for (const i of props.items) {
    if (i.activity.setting === "indoor") n.indoor += 1;
    else if (i.activity.setting === "outdoor") n.outdoor += 1;
  }
  return n.indoor && n.outdoor ? [`${n.indoor} indoor`, `${n.outdoor} outdoor`] : [];
});
</script>

<template>
  <div class="idea-group">
    <div class="card group-card">
      <button class="head" :aria-expanded="open" @click="open = !open">
        <span class="title">{{ group.title }}</span>
        <span class="tag">{{ count }}</span>
        <span class="spacer" />
        <AppIcon name="chevron" :size="20" class="chev" :class="{ up: open }" />
      </button>
      <div v-if="isEvent" class="small muted">{{ items[0].activity.kind }} · {{ days }}</div>
      <div class="small muted preview">
        <template v-if="isEvent">
          {{ places.slice(0, SHOWN).join(", ") }}<template v-if="places.length > SHOWN"> +{{ places.length - SHOWN }}</template>
        </template>
        <template v-else>
          <span v-for="(p, i) in preview" :key="p.id"
            ><template v-if="i">; </template><span class="name">{{ p.title }}</span><template v-if="p.where"> ({{ p.where }})</template></span
          ><template v-if="items.length > SHOWN">; +{{ items.length - SHOWN }} more</template>
        </template>
      </div>
      <div v-if="settings.length" class="facts">
        <span v-for="s in settings" :key="s" class="tag">{{ s }}</span>
      </div>
      <div class="row foot">
        <button class="toggle small" :aria-expanded="open" @click="open = !open">
          {{ open ? "Close" : `Show all ${items.length}` }}
        </button>
        <span v-if="markable" class="actions">
          <button class="hide small" :class="{ on: snoozedUntil }" aria-haspopup="dialog" @click="emit('snooze')">
            {{ snoozedUntil ? `Snoozed till ${formatDate(snoozedUntil, { day: "numeric", month: "short" })}` : "Snooze" }}
          </button>
          <button class="hide small" @click="emit('hide')">Not relevant</button>
        </span>
      </div>
    </div>
    <div v-if="open" class="members">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.group-card {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.head {
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
.title {
  font-weight: 500;
}
.chev {
  transform: rotate(90deg);
  transition: transform 0.15s;
  color: var(--text-2);
}
.chev.up {
  transform: rotate(-90deg);
}
.preview .name {
  color: var(--text);
}
.facts {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}
.foot {
  flex-wrap: wrap;
  align-items: center;
  margin-top: 2px;
}
.toggle,
.hide {
  border: 0;
  background: none;
  padding: 2px 0;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.toggle {
  color: var(--primary);
  font-weight: 500;
}
.actions {
  display: flex;
  gap: 16px;
  margin-left: auto;
  white-space: nowrap;
}
.hide {
  color: var(--text-2);
}
.hide.on {
  color: var(--primary);
}
.hide:hover,
.toggle:hover {
  text-decoration: underline;
}
.members {
  margin: -4px 0 12px 10px;
  padding-left: 10px;
  border-left: 2px solid var(--outline);
}
</style>
