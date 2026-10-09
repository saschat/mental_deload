<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { bzr } from "@/bazaar";
import AppIcon from "@/components/AppIcon.vue";
import KidAvatar from "@/components/KidAvatar.vue";
import TemplateNodes from "@/components/TemplateNodes.vue";
import { CATEGORIES, CATEGORY_LABELS, KID_COLORS, STATUSES, STATUS_LABELS, defaultSettings, newId, statusColor } from "@/core/defaults";
import { buildRemindersIcs } from "@/core/icsExport";
import type { Category, Kid, Settings, StatusKey } from "@/core/types";
import { downloadText, imageToDataUrl } from "@/lib/download";
import { idbGet, LAST_CHECK_KEY } from "@/lib/idb";
import {
  checkRemindersNow,
  notificationPermission,
  registerPeriodicSync,
  requestNotificationPermission,
  showTestNotification,
  type PeriodicSyncState,
} from "@/lib/notify";
import { useDataStore } from "@/stores/data";
import { useUiStore } from "@/stores/ui";

const data = useDataStore();
const ui = useUiStore();

//
// Kids
//
const newKidName = ref("");

async function addKid() {
  const name = newKidName.value.trim();
  if (!name) return;
  const i = data.kids.length;
  await ui.run(() => data.saveKid({ name, color: KID_COLORS[i % KID_COLORS.length], order: i }));
  newKidName.value = "";
}

async function updateKid(kid: Kid, patch: Partial<Kid>) {
  const next = { ...kid, ...patch };
  if (!next.name.trim()) return;
  await ui.run(() => data.saveKid(next));
}

async function setAvatarImage(kid: Kid, e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  try {
    await updateKid(kid, { avatar: await imageToDataUrl(f) });
  } catch (err) {
    ui.error(err);
  }
}

async function removeKid(kid: Kid) {
  if (!(await ui.confirm(`Remove ${kid.name}?`, "Statuses already set for this kid are ignored afterwards.", "Remove", true))) return;
  await ui.run(() => data.deleteKid(kid.id));
}

//
// Settings draft
//
const draft = reactive<Settings>(JSON.parse(JSON.stringify(data.settings)));
const tierText = reactive<Record<Category, string>>(
  Object.fromEntries(CATEGORIES.map((c) => [c.key, ""])) as Record<Category, string>,
);
const baseline = ref("");
const serialize = () => JSON.stringify({ draft, tierText });
const dirty = computed(() => serialize() !== baseline.value);

function loadDraft(s: Settings) {
  Object.assign(draft, JSON.parse(JSON.stringify(s)));
  for (const c of CATEGORIES) tierText[c.key] = s.reminderTiers[c.key].tiers.join(", ");
  baseline.value = serialize();
}
loadDraft(data.settings);
watch(
  () => JSON.stringify(data.settings),
  () => {
    if (!dirty.value) loadDraft(data.settings);
  },
);

async function saveSettings() {
  for (const c of CATEGORIES) {
    draft.reminderTiers[c.key].tiers = tierText[c.key]
      .split(/[,\s]+/)
      .filter(Boolean)
      .map(Number)
      .filter((n) => Number.isFinite(n) && n >= 0);
  }
  const ok = await ui.run(async () => {
    await data.saveSettings(JSON.parse(JSON.stringify(draft)));
    return true;
  }, "Settings saved");
  if (ok) loadDraft(draft);
}

function discard() {
  loadDraft(data.settings);
}

function resetTemplates() {
  draft.templates = defaultSettings().templates;
}

const newTplStatus = ref<StatusKey>("camp");
const newTplCategory = ref<Category | "">("");
function addTemplate() {
  draft.templates.push({ id: newId(), status: newTplStatus.value, category: newTplCategory.value || null, nodes: [] });
}

function removeTemplate(id: string) {
  draft.templates = draft.templates.filter((t) => t.id !== id);
}

const sortedTemplates = computed(() =>
  [...draft.templates].sort(
    (a, b) =>
      STATUSES.findIndex((s) => s.key === a.status) - STATUSES.findIndex((s) => s.key === b.status) ||
      (a.category ? 0 : 1) - (b.category ? 0 : 1),
  ),
);

//
// Notifications
//
const permission = ref(notificationPermission());
const syncState = ref<PeriodicSyncState | null>(null);
const lastCheck = ref<string | null>(null);
const isStandalone = window.matchMedia("(display-mode: standalone)").matches;

onMounted(async () => {
  lastCheck.value = (await idbGet<string>(LAST_CHECK_KEY)) ?? null;
  if (permission.value === "granted") syncState.value = await registerPeriodicSync();
});

async function enableNotifications() {
  permission.value = await requestNotificationPermission();
  if (permission.value === "granted") {
    syncState.value = await registerPeriodicSync();
    await showTestNotification();
  }
}

async function checkNow() {
  await data.flushCache();
  const res = await checkRemindersNow();
  lastCheck.value = new Date().toISOString();
  ui.newReminders = res.reminders;
  ui.toast(res.reminders.length ? `${res.reminders.length} new reminder(s)` : "No new reminders right now");
}

const syncLabel = computed(() => {
  switch (syncState.value) {
    case "registered":
      return "Daily background check is registered (the browser decides the exact timing).";
    case "denied":
      return isStandalone
        ? "The browser hasn't allowed background checks yet. Use the app regularly and it usually gets enabled."
        : "Background checks need the app installed to the home screen (Chrome on Android).";
    case "unsupported":
      return "This browser doesn't support background checks. Reminders appear when you open the app.";
    case "error":
      return isStandalone
        ? "Registering background checks failed. Reminders appear when you open the app."
        : "Background checks need the app installed to the home screen (Chrome on Android).";
    default:
      return "";
  }
});

//
// Export
//
function exportIcs() {
  const ics = buildRemindersIcs({
    events: data.events,
    tasks: data.tasks,
    kids: data.kids,
    settings: data.settings,
    today: data.today,
  });
  downloadText("mental-deload-reminders.ics", ics);
}

//
// Account
//
async function logout() {
  if (!(await ui.confirm("Log out?", "Locally cached data on this device will be removed.", "Log out"))) return;
  await data.clearLocalData();
  bzr.logOut();
}
</script>

<template>
  <div class="page">
    <h2>Kids</h2>
    <div class="card">
      <fieldset :disabled="data.readOnly">
        <div v-for="k in data.sortedKids" :key="k.id" class="list-item kid">
          <label class="avatar-pick" title="Change photo">
            <KidAvatar :kid="k" :size="40" />
            <input type="file" accept="image/*" hidden @change="setAvatarImage(k, $event)" />
          </label>
          <input class="input" :value="k.name" aria-label="Name" @change="updateKid(k, { name: ($event.target as HTMLInputElement).value })" />
          <input
            class="input emoji"
            :value="k.avatar && !k.avatar.startsWith('data:') ? k.avatar : ''"
            maxlength="4"
            placeholder="🙂"
            aria-label="Emoji avatar"
            @change="updateKid(k, { avatar: ($event.target as HTMLInputElement).value || undefined })"
          />
          <input type="color" :value="k.color" aria-label="Colour" @change="updateKid(k, { color: ($event.target as HTMLInputElement).value })" />
          <button class="icon-btn" title="Remove" @click="removeKid(k)"><AppIcon name="delete" /></button>
        </div>
        <form class="row" style="margin-top: 8px" @submit.prevent="addKid">
          <input v-model="newKidName" class="input" placeholder="Add a kid" />
          <button class="btn tonal" type="submit">Add</button>
        </form>
      </fieldset>
    </div>

    <h2>Notifications</h2>
    <div class="card">
      <p class="small" style="margin-top: 0">
        Mental Deload reminds you about events that still need a decision (e.g. 6, 3 and 1 month before, then weekly) and about
        overdue tasks. Reminders are checked when you open the app and, on Android with the app installed, about once a day in the
        background. This is best effort: phones may delay or skip background checks. For guaranteed alerts, also export the
        reminders to your calendar below.
      </p>
      <div class="row wrap">
        <span class="tag" :class="{ danger: permission === 'denied' }">Permission: {{ permission }}</span>
        <span class="spacer" />
        <button v-if="permission !== 'granted' && permission !== 'unsupported'" class="btn primary" @click="enableNotifications">
          <AppIcon name="bell" :size="18" /> Enable notifications
        </button>
        <button v-if="permission === 'granted'" class="btn outline" @click="showTestNotification">Test</button>
        <button class="btn outline" @click="checkNow">Check now</button>
      </div>
      <p v-if="permission === 'denied'" class="small danger-text">Notifications are blocked. Allow them in the browser's site settings.</p>
      <p v-if="syncLabel" class="small muted">{{ syncLabel }}</p>
      <p v-if="lastCheck" class="small muted" style="margin-bottom: 0">Last check: {{ new Date(lastCheck).toLocaleString() }}</p>
    </div>

    <h2>Calendar backup</h2>
    <div class="card">
      <p class="small" style="margin-top: 0">
        Download an .ics file with all undecided events and open tasks, including alarms. Import it into Google Calendar or your
        phone's calendar as a reliable backup. Re-export after changes (events keep their IDs, so re-importing updates them).
      </p>
      <button class="btn tonal" @click="exportIcs"><AppIcon name="download" :size="18" /> Export reminders to calendar</button>
    </div>

    <fieldset :disabled="data.readOnly">
      <h2 id="reminders">Reminder tiers</h2>
      <div class="card">
        <div v-for="c in CATEGORIES" :key="c.key" class="row wrap tier">
          <strong class="tier-label">{{ c.label }}</strong>
          <label class="field" style="flex: 2"><span>Days before</span><input v-model="tierText[c.key]" placeholder="180, 90, 30" /></label>
          <label class="field" style="flex: 1"
            ><span>Then every … days</span><input v-model.number="draft.reminderTiers[c.key].repeatEveryDays" type="number" min="0"
          /></label>
        </div>
        <label class="field" style="max-width: 260px"
          ><span>Remind about tasks due within … days</span><input v-model.number="draft.taskDueSoonDays" type="number" min="0"
        /></label>
      </div>

      <h2>Status colours</h2>
      <div class="card">
        <div class="chips wrap">
          <label v-for="s in STATUSES" :key="s.key" class="chip">
            <input
              type="color"
              :value="draft.statusColors[s.key] ?? statusColor(null, s.key)"
              @input="draft.statusColors[s.key] = ($event.target as HTMLInputElement).value"
            />
            {{ s.label }}
          </label>
        </div>
        <button class="btn text" @click="draft.statusColors = {}">Reset colours</button>
      </div>

      <h2>Task templates</h2>
      <div class="card">
        <p class="small muted" style="margin-top: 0">
          When you set a status, these tasks are created. Due dates are in days relative to the start of the segment (−90 = 90 days
          before). Category-specific templates win over generic ones.
        </p>
        <div v-for="t in sortedTemplates" :key="t.id" class="tpl">
          <div class="row">
            <span class="dot" :style="{ background: statusColor(draft, t.status) }" />
            <strong>{{ STATUS_LABELS[t.status] }}</strong>
            <span class="tag">{{ t.category ? CATEGORY_LABELS[t.category] : "Any category" }}</span>
            <span class="spacer" />
            <button class="icon-btn" title="Delete template" @click="removeTemplate(t.id)"><AppIcon name="delete" :size="18" /></button>
          </div>
          <TemplateNodes :nodes="t.nodes" />
        </div>
        <div class="row wrap" style="margin-top: 8px">
          <select v-model="newTplStatus" class="input" style="width: auto">
            <option v-for="s in STATUSES" :key="s.key" :value="s.key">{{ s.label }}</option>
          </select>
          <select v-model="newTplCategory" class="input" style="width: auto">
            <option value="">Any category</option>
            <option v-for="c in CATEGORIES" :key="c.key" :value="c.key">{{ c.label }}</option>
          </select>
          <button class="btn tonal" @click="addTemplate">Add template</button>
          <span class="spacer" />
          <button class="btn text" @click="resetTemplates">Reset to defaults</button>
        </div>
      </div>

      <h2>Import</h2>
      <div class="card">
        <label class="field">
          <span>CORS proxy prefix (optional)</span>
          <input v-model="draft.corsProxy" placeholder="e.g. https://my-proxy.example/?url=" />
        </label>
        <p class="small muted" style="margin: 0">
          Most calendar servers block direct downloads from web apps. If set, calendar URLs are fetched as
          <code>prefix + URL</code> (or the prefix's <code>{url}</code> placeholder is replaced with the encoded URL). Only use a proxy
          you trust: it sees your calendar links.
        </p>
      </div>
    </fieldset>

    <h2>Account</h2>
    <div class="card row wrap">
      <span class="small muted spacer">Data is stored in your Bazaar account and cached on this device for offline viewing.</span>
      <button class="btn outline" @click="logout">Log out</button>
    </div>

    <div v-if="dirty" class="save-bar">
      <span>Unsaved settings</span>
      <span class="spacer" />
      <button class="btn text" @click="discard">Discard</button>
      <button class="btn primary" :disabled="data.readOnly" @click="saveSettings">Save</button>
    </div>
  </div>
</template>

<style scoped>
.kid .input {
  flex: 1;
}
.kid .emoji {
  flex: 0 0 56px;
  text-align: center;
}
.avatar-pick {
  cursor: pointer;
}
input[type="color"] {
  width: 36px;
  height: 32px;
  border: none;
  background: none;
  padding: 0;
  cursor: pointer;
}
.chip input[type="color"] {
  width: 22px;
  height: 22px;
}
.tier {
  align-items: flex-end;
  gap: 10px;
}
.tier-label {
  width: 130px;
  padding-bottom: 22px;
}
.tpl {
  border-top: 1px solid var(--surface-2);
  padding: 10px 0 4px;
}
.dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  display: inline-block;
}
.save-bar {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  bottom: calc(16px + env(safe-area-inset-bottom));
  width: min(94vw, 600px);
  background: var(--surface-1);
  box-shadow: 0 4px 16px rgba(20, 24, 60, 0.2);
  border-radius: 16px;
  padding: 8px 8px 8px 16px;
  display: flex;
  align-items: center;
  gap: 6px;
  z-index: 30;
}
</style>
