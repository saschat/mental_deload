<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute } from "vue-router";
import AppIcon from "@/components/AppIcon.vue";
import BottomSheet from "@/components/BottomSheet.vue";
import { formatRange } from "@/core/dates";
import { CATEGORIES, newId } from "@/core/defaults";
import type { Source, SourceCategory } from "@/core/types";
import { normalizeIcsUrl } from "@/lib/fetchIcs";
import { useDataStore, HORIZON_MONTHS, type PendingImport } from "@/stores/data";
import { useUiStore } from "@/stores/ui";

const route = useRoute();
const data = useDataStore();
const ui = useUiStore();

const mode = ref<"url" | "file" | null>(null);
const editingId = ref<string | null>(null);
const form = reactive({
  name: "",
  url: "",
  defaultCategory: "school" as SourceCategory,
  kidIds: [] as string[],
});
const file = ref<File | null>(null);
const fetchError = ref<string | null>(null);
const busy = ref(false);
const pending = ref<PendingImport | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const refreshTarget = ref<Source | null>(null);
const refreshInput = ref<HTMLInputElement | null>(null);

const sorted = computed(() => [...data.sources].sort((a, b) => a.name.localeCompare(b.name)));

function resetForm(m: "url" | "file" | null) {
  mode.value = m;
  editingId.value = null;
  form.name = "";
  form.url = "";
  form.defaultCategory = "school";
  form.kidIds = data.kids.map((k) => k.id);
  file.value = null;
  fetchError.value = null;
}

onMounted(() => {
  const add = route.query.add;
  if (add === "url" || add === "file") resetForm(add);
});

function toggleKid(id: string) {
  form.kidIds = form.kidIds.includes(id) ? form.kidIds.filter((k) => k !== id) : [...form.kidIds, id];
}

function sourceFromForm(type: "url" | "file"): Source {
  const prev = editingId.value ? data.sources.find((s) => s.id === editingId.value) : undefined;
  return {
    ...(prev ?? {}),
    id: prev?.id ?? newId(),
    name: form.name.trim() || (type === "url" ? "Calendar" : (file.value?.name.replace(/\.ics$/i, "") ?? "Calendar")),
    type,
    url: type === "url" ? normalizeIcsUrl(form.url) : undefined,
    defaultCategory: form.defaultCategory,
    kidIds: form.kidIds.length === data.kids.length ? [] : [...form.kidIds],
  };
}

function preview(source: Source, text: string) {
  const p = data.prepareImport(source, text);
  if (!source.name || source.name === "Calendar") {
    if (p.calendarName) p.source = { ...source, name: p.calendarName };
  }
  pending.value = p;
}

async function submitUrl() {
  if (!form.url.trim()) return ui.toast("Please paste a calendar URL", "error");
  busy.value = true;
  fetchError.value = null;
  const source = sourceFromForm("url");
  try {
    const text = await data.fetchSource(source);
    preview(source, text);
  } catch (e) {
    fetchError.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

async function saveWithoutImport() {
  const source = sourceFromForm(mode.value ?? "url");
  await ui.run(() => data.saveSource(source), "Source saved");
  resetForm(null);
}

async function submitFile() {
  if (!file.value) return ui.toast("Choose an .ics file", "error");
  busy.value = true;
  try {
    const text = await file.value.text();
    preview(sourceFromForm(mode.value === "url" ? "url" : "file"), text);
  } catch (e) {
    ui.error(e);
  } finally {
    busy.value = false;
  }
}

function onFile(e: Event) {
  file.value = (e.target as HTMLInputElement).files?.[0] ?? null;
}

async function apply() {
  if (!pending.value) return;
  busy.value = true;
  const p = pending.value;
  const ok = await ui.run(async () => {
    await data.applyImport(p);
    return true;
  });
  busy.value = false;
  if (ok) {
    const s = p.summary;
    ui.toast(`Imported: ${s.created} new, ${s.updated} updated, ${s.flagged} flagged, ${s.removed} removed`);
    pending.value = null;
    resetForm(null);
  }
}

async function refresh(src: Source) {
  busy.value = true;
  try {
    const text = await data.fetchSource(src);
    preview(src, text);
  } catch (e) {
    ui.toast(e instanceof Error ? e.message : String(e), "error", 9000);
  } finally {
    busy.value = false;
  }
}

function uploadFor(src: Source) {
  refreshTarget.value = src;
  refreshInput.value?.click();
}

async function onRefreshFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = "";
  if (!f || !refreshTarget.value) return;
  try {
    preview(refreshTarget.value, await f.text());
  } catch (err) {
    ui.error(err);
  }
}

function edit(src: Source) {
  mode.value = src.type;
  editingId.value = src.id;
  form.name = src.name;
  form.url = src.url ?? "";
  form.defaultCategory = src.defaultCategory;
  form.kidIds = src.kidIds.length ? [...src.kidIds] : data.kids.map((k) => k.id);
  fetchError.value = null;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function remove(src: Source) {
  const count = data.events.filter((e) => e.sourceId === src.id).length;
  const choice = await ui.ask(
    `Remove “${src.name}”?`,
    count ? `${count} events were imported from this source.` : "No events were imported from this source.",
    [
      { value: "cancel", label: "Cancel" },
      ...(count ? [{ value: "keep", label: "Keep events" }] : []),
      { value: "delete", label: count ? "Delete events too" : "Remove", danger: true },
    ],
  );
  if (!choice || choice === "cancel") return;
  await ui.run(() => data.deleteSource(src.id, choice === "delete"), "Source removed");
}

function eventCount(src: Source) {
  return data.events.filter((e) => e.sourceId === src.id).length;
}
</script>

<template>
  <div class="page">
    <fieldset :disabled="data.readOnly">
      <div v-if="!mode" class="row wrap" style="margin: 4px 0 8px">
        <button class="btn tonal" @click="resetForm('url')"><AppIcon name="link" :size="18" /> Add calendar URL</button>
        <button class="btn tonal" @click="resetForm('file')"><AppIcon name="upload" :size="18" /> Upload .ics file</button>
      </div>

      <form v-if="mode" class="card" @submit.prevent="mode === 'url' && !file ? submitUrl() : submitFile()">
        <h3 style="margin-bottom: 12px">
          {{ editingId ? "Edit source" : mode === "url" ? "Subscribe to a calendar URL" : "Upload an .ics file" }}
        </h3>
        <label v-if="mode === 'url'" class="field">
          <span>ICS / iCal URL</span>
          <input v-model="form.url" type="url" inputmode="url" placeholder="https://… or webcal://…" />
        </label>
        <p v-if="mode === 'url'" class="small muted" style="margin-top: -6px">
          Google Calendar: Settings → your calendar → “Secret address in iCal format”.
        </p>
        <label v-if="mode === 'file' || fetchError" class="field">
          <span>.ics file</span>
          <input ref="fileInput" type="file" accept=".ics,text/calendar" @change="onFile" />
        </label>
        <label class="field"><span>Name</span><input v-model="form.name" placeholder="e.g. School calendar" /></label>
        <label class="field">
          <span>Default category</span>
          <select v-model="form.defaultCategory">
            <option value="auto">Detect from title (else Other)</option>
            <option v-for="c in CATEGORIES" :key="c.key" :value="c.key">{{ c.label }}</option>
          </select>
        </label>
        <p class="small muted" style="margin-top: -6px">Holidays and birthdays are detected from titles automatically.</p>
        <div v-if="data.kids.length" class="field">
          <span>Relevant for</span>
          <div class="chips wrap">
            <button v-for="k in data.sortedKids" :key="k.id" type="button" class="chip" :class="{ selected: form.kidIds.includes(k.id) }" @click="toggleKid(k.id)">
              <span class="dot" :style="{ background: k.color }" /> {{ k.name }}
            </button>
          </div>
        </div>

        <div v-if="fetchError" class="banner warn" style="align-items: flex-start">
          <AppIcon name="warning" />
          <div>
            {{ fetchError }}
            <div class="small" style="margin-top: 4px">Choose the downloaded file above and press “Import file”, or save the source without importing.</div>
          </div>
        </div>

        <div class="row wrap">
          <span class="spacer" />
          <button type="button" class="btn text" @click="resetForm(null)">Cancel</button>
          <button v-if="editingId || fetchError" type="button" class="btn outline" :disabled="busy" @click="saveWithoutImport">Save only</button>
          <button v-if="mode === 'url' && !file" type="submit" class="btn primary" :disabled="busy">{{ busy ? "Loading…" : "Load & preview" }}</button>
          <button v-else type="submit" class="btn primary" :disabled="busy || !file">Import file</button>
        </div>
      </form>
    </fieldset>

    <h2>Sources</h2>
    <div v-if="!sorted.length" class="card muted small">No calendars yet. Events are imported for the next {{ HORIZON_MONTHS }} months.</div>
    <div v-for="src in sorted" :key="src.id" class="card">
      <div class="row">
        <AppIcon :name="src.type === 'url' ? 'link' : 'upload'" />
        <div style="flex: 1; min-width: 0">
          <strong>{{ src.name }}</strong>
          <div v-if="src.url" class="small muted url">{{ src.url }}</div>
          <div class="small muted">
            {{ eventCount(src) }} events ·
            {{ src.lastImportedAt ? `imported ${new Date(src.lastImportedAt).toLocaleString()}` : "never imported" }}
          </div>
          <div v-if="src.lastError" class="small danger-text">{{ src.lastError }}</div>
        </div>
      </div>
      <div class="row wrap" style="margin-top: 8px">
        <button v-if="src.type === 'url'" class="btn tonal" :disabled="data.readOnly || busy" @click="refresh(src)">
          <AppIcon name="refresh" :size="18" /> Refresh
        </button>
        <button class="btn outline" :disabled="data.readOnly || busy" @click="uploadFor(src)">
          <AppIcon name="upload" :size="18" /> Upload {{ src.type === "url" ? "file" : "new version" }}
        </button>
        <span class="spacer" />
        <button class="icon-btn" title="Edit" :disabled="data.readOnly" @click="edit(src)"><AppIcon name="edit" /></button>
        <button class="icon-btn" title="Remove" :disabled="data.readOnly" @click="remove(src)"><AppIcon name="delete" /></button>
      </div>
    </div>
    <input ref="refreshInput" type="file" accept=".ics,text/calendar" hidden @change="onRefreshFile" />

    <BottomSheet :open="!!pending" :title="pending ? `Import preview · ${pending.source.name}` : ''" @close="pending = null">
      <template v-if="pending">
        <div class="summary">
          <div><strong>{{ pending.summary.created }}</strong><span>new</span></div>
          <div><strong>{{ pending.summary.updated }}</strong><span>updated</span></div>
          <div :class="{ warn: pending.summary.flagged }"><strong>{{ pending.summary.flagged }}</strong><span>flagged</span></div>
          <div><strong>{{ pending.summary.removed }}</strong><span>removed</span></div>
          <div><strong>{{ pending.summary.unchanged }}</strong><span>unchanged</span></div>
        </div>
        <p v-if="pending.summary.flagged" class="small muted">
          Flagged events already have statuses or tasks; they'll be marked “changed/removed upstream” for you to review.
        </p>
        <div v-if="pending.plan.create.length" class="small">
          <div v-for="e in pending.plan.create.slice(0, 8)" :key="e.id" class="list-item" style="padding: 6px 0">
            <span style="flex: 1">{{ e.title }}</span><span class="muted">{{ formatRange(e.start, e.end) }}</span>
          </div>
          <div v-if="pending.plan.create.length > 8" class="muted">…and {{ pending.plan.create.length - 8 }} more</div>
        </div>
        <div class="row" style="margin-top: 14px">
          <span class="spacer" />
          <button class="btn text" @click="pending = null">Cancel</button>
          <button class="btn primary" :disabled="busy || data.readOnly" @click="apply">{{ busy ? "Importing…" : "Apply" }}</button>
        </div>
      </template>
    </BottomSheet>
  </div>
</template>

<style scoped>
.url {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.summary {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 6px;
  text-align: center;
  margin-bottom: 10px;
}
.summary div {
  background: var(--surface-2);
  border-radius: 12px;
  padding: 8px 2px;
  display: flex;
  flex-direction: column;
}
.summary strong {
  font-size: 20px;
}
.summary span {
  font-size: 11px;
  color: var(--text-2);
}
.summary .warn {
  background: #fff1df;
}
</style>
