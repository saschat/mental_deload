<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";

import { bzr, connectError } from "@/bazaar";
import AppIcon from "@/components/AppIcon.vue";
import AppDialog from "@/components/AppDialog.vue";
import BottomSheet from "@/components/BottomSheet.vue";
import { checkRemindersNow, notificationPermission, registerPeriodicSync } from "@/lib/notify";
import { useDataStore } from "@/stores/data";
import { useUiStore } from "@/stores/ui";

const data = useDataStore();
const ui = useUiStore();
const route = useRoute();
const router = useRouter();

const baseUrl = import.meta.env.BASE_URL;
const loggedIn = ref(bzr.isLoggedIn());
const fabOpen = ref(false);

const isTab = computed(() => !!route.meta.tab);
const title = computed(() => (route.meta.title as string) ?? "Mental Deload");
const authProblem = computed(() => connectError.value === "Unauthorized" || connectError.value === "Token expired");

let checking = false;
async function checkReminders() {
  if (checking || data.loading) return;
  checking = true;
  try {
    await data.flushCache();
    const res = await checkRemindersNow();
    if (res.reminders.length) {
      ui.newReminders = res.reminders;
      if (notificationPermission() !== "granted") {
        ui.toast(`${res.reminders.length} new reminder${res.reminders.length === 1 ? "" : "s"}`);
      }
    }
  } catch (e) {
    console.warn("Reminder check failed", e);
  } finally {
    checking = false;
  }
}

/** Leftover OAuth params make the SDK skip future login attempts, so drop them once logged in. */
function cleanLoginParams() {
  const params = new URLSearchParams(location.search);
  if (!params.has("code") && !params.has("state")) return;
  history.replaceState(history.state, "", location.pathname + location.hash);
}

async function boot() {
  cleanLoginParams();
  await data.loadCache();
  await data.start();
  await checkReminders();
  if (notificationPermission() === "granted") registerPeriodicSync();
}

function onVisibility() {
  if (document.visibilityState !== "visible" || !loggedIn.value) return;
  data.refreshToday();
  if (!data.live) data.start().then(checkReminders);
  else checkReminders();
}
const onOnline = () => data.setNetworkOnline(true);
const onOffline = () => data.setNetworkOnline(false);

onMounted(() => {
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  document.addEventListener("visibilitychange", onVisibility);
  if (loggedIn.value) boot();
});
onUnmounted(() => {
  window.removeEventListener("online", onOnline);
  window.removeEventListener("offline", onOffline);
  document.removeEventListener("visibilitychange", onVisibility);
});

bzr.onLogin(async () => {
  loggedIn.value = true;
  connectError.value = null;
  await boot();
});

function login() {
  bzr.login();
}

function retry() {
  data.start().then(checkReminders);
}

function goBack() {
  if (window.history.state?.back) router.back();
  else router.push("/");
}

function fab(to: string) {
  fabOpen.value = false;
  router.push(to);
}
</script>

<template>
  <div v-if="!loggedIn" class="login">
    <img :src="`${baseUrl}icons/icon-192.png`" alt="" width="96" height="96" />
    <h1>Mental Deload</h1>
    <p class="muted">
      School holidays, birthdays and family events for your kids — decided early, organised with tasks, and reminded in
      time.
    </p>
    <button class="btn primary" @click="login">Log in with Bazaar</button>
    <p class="small muted">Your data is stored in your own Bazaar account.</p>
  </div>

  <template v-else>
    <header class="topbar">
      <button v-if="!isTab" class="icon-btn" aria-label="Back" @click="goBack"><AppIcon name="back" /></button>
      <h1>{{ title }}</h1>
      <span class="spacer" />
      <RouterLink v-if="isTab" to="/sources" class="icon-btn" aria-label="Import & sources" title="Import & sources">
        <AppIcon name="upload" />
      </RouterLink>
      <RouterLink v-if="isTab" to="/settings" class="icon-btn" aria-label="Settings" title="Settings">
        <AppIcon name="settings" />
      </RouterLink>
    </header>

    <div class="status-banners">
      <div v-if="authProblem" class="banner warn">
        <AppIcon name="warning" />
        <span class="spacer">Your Bazaar session expired. Showing saved data.</span>
        <button class="btn tonal" @click="bzr.logOut()">Log in again</button>
      </div>
      <div v-else-if="data.readOnly && !data.loading && !data.connecting" class="banner offline">
        <AppIcon name="offline" />
        <span class="spacer">
          Offline, read-only.
          <template v-if="data.cacheSavedAt">Data from {{ new Date(data.cacheSavedAt).toLocaleString() }}.</template>
        </span>
        <button class="btn text" style="color: white" @click="retry">Retry</button>
      </div>
    </div>

    <main>
      <div v-if="data.loading" class="empty">Loading…</div>
      <RouterView v-else />
    </main>

    <button v-if="isTab" class="fab" aria-label="Add" :disabled="data.readOnly" @click="fabOpen = true">
      <AppIcon name="add" :size="26" />
    </button>

    <nav v-if="isTab" class="bottom-nav">
      <RouterLink to="/" class="nav-item" exact-active-class="active">
        <span class="pill"><AppIcon name="inbox" /></span>
        <span>Inbox</span>
        <span v-if="data.undecidedEvents.length" class="badge">{{ data.undecidedEvents.length }}</span>
      </RouterLink>
      <RouterLink to="/upcoming" class="nav-item" active-class="active">
        <span class="pill"><AppIcon name="calendar" /></span>
        <span>Upcoming</span>
      </RouterLink>
      <RouterLink to="/tasks" class="nav-item" active-class="active">
        <span class="pill"><AppIcon name="tasks" /></span>
        <span>Tasks</span>
      </RouterLink>
    </nav>

    <BottomSheet :open="fabOpen" title="Add" @close="fabOpen = false">
      <button class="sheet-item" @click="fab('/event/new')">
        <AppIcon name="edit" /> <span><strong>Add event manually</strong><br /><span class="small muted">Birthday party, trip, anything</span></span>
      </button>
      <button class="sheet-item" @click="fab('/sources?add=url')">
        <AppIcon name="link" /> <span><strong>Subscribe to calendar URL</strong><br /><span class="small muted">School calendar, Google Calendar iCal link</span></span>
      </button>
      <button class="sheet-item" @click="fab('/sources?add=file')">
        <AppIcon name="upload" /> <span><strong>Upload .ics file</strong><br /><span class="small muted">Exported or downloaded calendar</span></span>
      </button>
    </BottomSheet>
  </template>

  <div class="toasts">
    <div v-for="t in ui.toasts" :key="t.id" class="toast" :class="t.kind">{{ t.text }}</div>
  </div>
  <AppDialog />
</template>

<style scoped>
.login {
  max-width: 420px;
  margin: 0 auto;
  padding: 18vh 24px 24px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}
.login img {
  border-radius: 24px;
}
.login h1 {
  font-size: 28px;
}
.topbar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: calc(8px + env(safe-area-inset-top)) 8px 8px 16px;
  background: var(--surface);
  max-width: 720px;
  margin: 0 auto;
}
.topbar h1 {
  font-size: 22px;
}
.status-banners {
  max-width: 720px;
  margin: 0 auto;
  padding: 0 12px;
}
.fab {
  position: fixed;
  right: max(16px, calc(50vw - 360px + 16px));
  bottom: calc(var(--nav-h) + 16px + env(safe-area-inset-bottom));
  width: 56px;
  height: 56px;
  border-radius: 16px;
  border: none;
  background: var(--primary-container);
  color: var(--on-primary-container);
  box-shadow: 0 3px 8px rgba(20, 24, 60, 0.25);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 20;
}
.fab:disabled {
  opacity: 0.5;
}
.bottom-nav {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  height: calc(var(--nav-h) + env(safe-area-inset-bottom));
  padding-bottom: env(safe-area-inset-bottom);
  background: var(--surface-2);
  display: flex;
  justify-content: center;
  z-index: 20;
}
.nav-item {
  flex: 1;
  max-width: 160px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  color: var(--text-2);
  text-decoration: none;
  font-size: 12px;
  font-weight: 500;
  position: relative;
}
.nav-item .pill {
  width: 60px;
  height: 30px;
  border-radius: 15px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.nav-item.active {
  color: var(--text);
}
.nav-item.active .pill {
  background: var(--primary-container);
  color: var(--on-primary-container);
}
.badge {
  position: absolute;
  top: 8px;
  left: calc(50% + 8px);
  background: var(--danger);
  color: white;
  border-radius: 9px;
  font-size: 11px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.sheet-item {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  text-align: left;
  border: none;
  background: transparent;
  padding: 12px 6px;
  border-radius: 12px;
  cursor: pointer;
}
.sheet-item:hover {
  background: var(--surface-2);
}
.toasts {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  bottom: calc(var(--nav-h) + 84px + env(safe-area-inset-bottom));
  z-index: 70;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: min(92vw, 480px);
  pointer-events: none;
}
.toast {
  background: #2f3142;
  color: white;
  padding: 12px 16px;
  border-radius: 10px;
  box-shadow: var(--shadow);
  font-size: 14px;
}
.toast.error {
  background: #8e1c1c;
}
</style>
