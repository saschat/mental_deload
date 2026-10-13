import { computed, ref } from "vue";
import { defineStore } from "pinia";

import type { ActivityIndex } from "@/core/activities";
import { ACTIVITIES_KEY, idbGet, idbSet } from "@/lib/idb";

/**
 * Revalidate on the first visit after the app starts (so pulling down to
 * reload also reloads the ideas) and then after a short pause. The fetch is
 * conditional ("no-cache"), so an unchanged index costs a 304, and the cached
 * copy is shown meanwhile.
 */
const CACHE_MS = 5 * 60 * 1000;

interface Cached {
  v: 1;
  fetchedAt: number;
  index: ActivityIndex;
}

function valid(index: unknown): index is ActivityIndex {
  return !!index && typeof index === "object" && (index as ActivityIndex).v === 1 && Array.isArray((index as ActivityIndex).activities);
}

/** activities.json, built by scripts/activities and deployed next to the app. Cached for offline use. */
export const useActivitiesStore = defineStore("activities", () => {
  const index = ref<ActivityIndex | null>(null);
  const fetchedAt = ref<number | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  let hydrated = false;
  let checkedThisRun = false;
  let pending: Promise<void> | null = null;

  const activities = computed(() => index.value?.activities ?? []);

  async function hydrate() {
    const cached = await idbGet<Cached>(ACTIVITIES_KEY).catch(() => undefined);
    if (cached?.v === 1 && valid(cached.index) && !index.value) {
      index.value = cached.index;
      fetchedAt.value = cached.fetchedAt;
    }
    hydrated = true;
  }

  async function refresh() {
    loading.value = true;
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}activities.json`, { cache: "no-cache" });
      if (!res.ok) throw new Error(res.status === 404 ? "The activity index has not been built yet." : `HTTP ${res.status}`);
      const body: unknown = await res.json();
      if (!valid(body)) throw new Error("The activity index has an unknown format.");
      index.value = body;
      fetchedAt.value = Date.now();
      error.value = null;
      await idbSet(ACTIVITIES_KEY, { v: 1, fetchedAt: fetchedAt.value, index: body } satisfies Cached).catch((e) =>
        console.warn("Could not cache activities", e),
      );
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  /** Load the cached index, then refetch it if it is stale. */
  function ensure(force = false) {
    if (pending) return pending;
    pending = (async () => {
      if (!hydrated) await hydrate();
      if (force || !checkedThisRun || fetchedAt.value === null || Date.now() - fetchedAt.value >= CACHE_MS) {
        checkedThisRun = true;
        await refresh();
      }
    })().finally(() => {
      pending = null;
    });
    return pending;
  }

  return { index, activities, fetchedAt, loading, error, ensure };
});
