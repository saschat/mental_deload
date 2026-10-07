<script setup lang="ts">
import { computed, ref } from "vue";
import EventCard from "@/components/EventCard.vue";
import StatusSheet from "@/components/StatusSheet.vue";
import AppIcon from "@/components/AppIcon.vue";
import { KID_COLORS } from "@/core/defaults";
import type { FamilyEvent } from "@/core/types";
import { urgency } from "@/lib/eventMeta";
import { useDataStore } from "@/stores/data";
import { useUiStore } from "@/stores/ui";

const data = useDataStore();
const ui = useUiStore();

const sheetEvent = ref<FamilyEvent | null>(null);
const liveSheetEvent = computed(() => (sheetEvent.value ? (data.eventsById.get(sheetEvent.value.id) ?? null) : null));

const flagged = computed(() => data.flaggedEvents.slice().sort((a, b) => (a.start < b.start ? -1 : 1)));
const undecided = computed(() => data.undecidedEvents.filter((e) => !e.upstreamFlag));
const urgentCount = computed(() => data.undecidedEvents.filter((e) => urgency(e, data.today) === "red").length);

const kidNames = ref(["", ""]);
async function addKids() {
  const names = kidNames.value.map((n) => n.trim()).filter(Boolean);
  if (!names.length) return;
  await ui.run(async () => {
    for (const [i, name] of names.entries()) {
      await data.saveKid({ name, color: KID_COLORS[i % KID_COLORS.length], order: i });
    }
  }, "Kids added");
}
</script>

<template>
  <div class="page">
    <div v-if="!data.kids.length && !data.readOnly" class="card">
      <h3 style="margin-bottom: 6px">Welcome! Who are you planning for?</h3>
      <p class="small muted" style="margin-top: 0">Add your kids. You can change names, colours and avatars later in Settings.</p>
      <div class="row wrap">
        <input v-for="(_, i) in kidNames" :key="i" v-model="kidNames[i]" class="input" style="flex: 1; min-width: 120px" :placeholder="`Kid ${i + 1} name`" />
      </div>
      <div class="row" style="margin-top: 10px">
        <button class="btn text" @click="kidNames.push('')">+ Another kid</button>
        <span class="spacer" />
        <button class="btn primary" @click="addKids">Save</button>
      </div>
    </div>

    <div v-if="ui.newReminders.length" class="banner info">
      <AppIcon name="bell" />
      <div class="spacer">
        <strong>{{ ui.newReminders.length }} new reminder{{ ui.newReminders.length === 1 ? "" : "s" }}</strong>
        <div v-for="r in ui.newReminders.slice(0, 4)" :key="r.key" class="small">
          <RouterLink :to="`/event/${r.eventId}`">{{ r.title }}</RouterLink>
        </div>
      </div>
      <button class="icon-btn" aria-label="Dismiss" @click="ui.newReminders = []"><AppIcon name="close" /></button>
    </div>

    <div class="chips">
      <span class="chip selected">{{ data.undecidedEvents.length }} undecided</span>
      <span class="chip" :class="{ urgent: urgentCount }">{{ urgentCount }} urgent</span>
      <RouterLink to="/tasks" class="chip" style="text-decoration: none">{{ data.openTasks.length }} open tasks</RouterLink>
    </div>

    <template v-if="flagged.length">
      <h2>Changed upstream</h2>
      <EventCard v-for="ev in flagged" :key="ev.id" :event="ev" @set-status="sheetEvent = $event" />
    </template>

    <h2 v-if="undecided.length">Needs decision</h2>
    <EventCard v-for="ev in undecided" :key="ev.id" :event="ev" @set-status="sheetEvent = $event" />

    <div v-if="!undecided.length && !flagged.length" class="empty">
      <template v-if="data.events.length">
        <div class="big">🎉</div>
        <p>Everything upcoming is decided.</p>
        <RouterLink to="/upcoming">See upcoming events</RouterLink>
      </template>
      <template v-else>
        <div class="big">📅</div>
        <p>No events yet. Import your school calendar or add an event.</p>
        <RouterLink to="/sources?add=url" class="btn tonal">Import a calendar</RouterLink>
      </template>
    </div>

    <StatusSheet :event="liveSheetEvent" @close="sheetEvent = null" />
  </div>
</template>

<style scoped>
.chip.urgent {
  border-color: #e53935;
  color: #b71c1c;
}
</style>
