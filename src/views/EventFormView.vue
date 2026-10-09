<script setup lang="ts">
import { computed, reactive } from "vue";
import { useRoute, useRouter } from "vue-router";
import CategoryChips from "@/components/CategoryChips.vue";
import { fitSegments } from "@/core/coverage";
import { detectCategory } from "@/core/icsParse";
import { stripUndefined } from "@/core/importDiff";
import type { Category } from "@/core/types";
import { useDataStore } from "@/stores/data";
import { useUiStore } from "@/stores/ui";

const route = useRoute();
const router = useRouter();
const data = useDataStore();
const ui = useUiStore();

const existing = computed(() => (route.params.id ? data.eventsById.get(route.params.id as string) : undefined));
const imported = computed(() => !!existing.value?.sourceId);

const form = reactive({
  title: existing.value?.title ?? "",
  start: existing.value?.start ?? data.today,
  end: existing.value?.end ?? data.today,
  startTime: existing.value?.startTime ?? "",
  endTime: existing.value?.endTime ?? "",
  category: (existing.value?.category ?? "") as Category | "",
  kidIds: existing.value?.kidIds?.length ? [...existing.value.kidIds] : data.kids.map((k) => k.id),
  location: existing.value?.location ?? "",
  description: existing.value?.description ?? "",
});

function toggleKid(id: string) {
  form.kidIds = form.kidIds.includes(id) ? form.kidIds.filter((k) => k !== id) : [...form.kidIds, id];
}

async function save() {
  if (!form.title.trim()) return ui.toast("Please enter a title", "error");
  if (form.end < form.start) form.end = form.start;
  const category = form.category || detectCategory(form.title, "other");
  // Store an empty list when all kids are selected so new kids are included by default.
  const kidIds = form.kidIds.length === data.kids.length ? [] : form.kidIds;
  if (!kidIds.length && form.kidIds.length === 0 && data.kids.length) return ui.toast("Select at least one kid", "error");

  const base = existing.value ?? data.newManualEvent({});
  const ev = imported.value
    ? { ...base, category, kidIds }
    : stripUndefined({
        ...base,
        title: form.title.trim(),
        start: form.start,
        end: form.end,
        startTime: form.startTime || undefined,
        endTime: (form.startTime && form.endTime) || undefined,
        location: form.location.trim() || undefined,
        description: form.description.trim() || undefined,
        category,
        kidIds,
        segments: fitSegments(base.segments ?? [], form.start, form.end),
      });
  const ok = await ui.run(async () => {
    await data.saveEvent(ev);
    return true;
  });
  if (ok) router.replace(`/event/${ev.id}`);
}
</script>

<template>
  <div class="page">
    <form class="card" @submit.prevent="save">
      <fieldset :disabled="data.readOnly">
        <template v-if="!imported">
          <label class="field"><span>Title</span><input v-model="form.title" required placeholder="e.g. Lena's birthday party" /></label>
          <div class="row">
            <label class="field" style="flex: 1"><span>Start</span><input v-model="form.start" type="date" required /></label>
            <label class="field" style="flex: 1"><span>End</span><input v-model="form.end" type="date" :min="form.start" required /></label>
          </div>
          <div class="row">
            <label class="field" style="flex: 1"><span>Start time (optional)</span><input v-model="form.startTime" type="time" /></label>
            <label class="field" style="flex: 1"><span>End time</span><input v-model="form.endTime" type="time" :disabled="!form.startTime" /></label>
          </div>
        </template>
        <p v-else class="small muted" style="margin-top: 0">
          Title and dates come from the calendar “{{ data.sources.find((s) => s.id === existing?.sourceId)?.name }}” and update on re-import.
        </p>

        <div class="field">
          <span>Category</span>
          <CategoryChips v-model="form.category" :empty-label="imported ? undefined : 'Detect from title'" />
        </div>

        <div v-if="data.kids.length" class="field">
          <span>Relevant for</span>
          <div class="chips wrap">
            <button v-for="k in data.sortedKids" :key="k.id" type="button" class="chip" :class="{ selected: form.kidIds.includes(k.id) }" @click="toggleKid(k.id)">
              <span class="dot" :style="{ background: k.color }" /> {{ k.name }}
            </button>
          </div>
        </div>

        <template v-if="!imported">
          <label class="field"><span>Location</span><input v-model="form.location" /></label>
          <label class="field"><span>Notes</span><textarea v-model="form.description" /></label>
        </template>

        <div class="row">
          <span class="spacer" />
          <button type="button" class="btn text" @click="router.back()">Cancel</button>
          <button type="submit" class="btn primary">Save</button>
        </div>
      </fieldset>
    </form>
  </div>
</template>
