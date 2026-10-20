import { computed, ref, watch, type Ref } from "vue";
import { defineStore } from "pinia";
import type { CollectionAPI, Doc } from "@bzr/bazaar";

import { apiConnected, apiConnects, bzr } from "@/bazaar";
import { addMonths, HORIZON_MONTHS, today as todayOf } from "@/core/dates";
import { isUndecided, relevantKidIds } from "@/core/coverage";
import { normalizeSettings, newId, SETTINGS_ID } from "@/core/defaults";
import { parseIcs } from "@/core/icsParse";
import { planImport, stripUndefined, summarize, type ImportPlan, type ImportSummary } from "@/core/importDiff";
import { planWeekends } from "@/core/weekends";
import { planSegmentTasks, withDescendants, type SegmentTaskPlan } from "@/core/tasks";
import type { FamilyEvent, IdeaMark, Kid, Segment, Settings, Source, Task } from "@/core/types";
import { fetchIcs } from "@/lib/fetchIcs";
import { idbClear, idbGet, idbSet, SNAPSHOT_KEY, type Snapshot } from "@/lib/idb";

export { HORIZON_MONTHS };

const WRITE_TIMEOUT_MS = 15_000;
const CONNECT_TIMEOUT_MS = 8_000;

function timeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);
}

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

/** Run promises with limited concurrency (bulk imports). */
async function inBatches<T>(items: T[], size: number, fn: (x: T) => Promise<unknown>) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

export interface PendingImport {
  source: Source;
  plan: ImportPlan;
  summary: ImportSummary;
  calendarName?: string;
}

export const useDataStore = defineStore("data", () => {
  const kids: Ref<Kid[]> = ref([]);
  const sources: Ref<Source[]> = ref([]);
  const events: Ref<FamilyEvent[]> = ref([]);
  const tasks: Ref<Task[]> = ref([]);
  const settingsDocs: Ref<Settings[]> = ref([]);
  const ideaMarks: Ref<IdeaMark[]> = ref([]);

  const live = ref(false);
  const connecting = ref(false);
  const loading = ref(true);
  const fromCache = ref(false);
  const cacheSavedAt = ref<string | null>(null);
  const networkOnline = ref(typeof navigator === "undefined" ? true : navigator.onLine);
  const loadError = ref<string | null>(null);

  const readOnly = computed(() => !live.value || !networkOnline.value || !apiConnected.value);
  const settings = computed(() => normalizeSettings(settingsDocs.value.find((s) => s.id === SETTINGS_ID)));
  const sortedKids = computed(() =>
    [...kids.value].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name)),
  );
  const today = ref(todayOf());

  const col = {
    kids: bzr.collection<Kid>("kids"),
    sources: bzr.collection<Source>("sources"),
    events: bzr.collection<FamilyEvent>("events"),
    tasks: bzr.collection<Task>("tasks"),
    settings: bzr.collection<Settings>("settings"),
    ideaMarks: bzr.collection<IdeaMark>("ideaMarks"),
  };

  //
  // Derived
  //
  const eventsById = computed(() => new Map(events.value.map((e) => [e.id, e])));
  const tasksByEvent = computed(() => {
    const m = new Map<string, Task[]>();
    for (const t of tasks.value) m.set(t.eventId, [...(m.get(t.eventId) ?? []), t]);
    return m;
  });
  const upcomingEvents = computed(() =>
    events.value
      .filter((e) => e.end >= today.value)
      .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.title.localeCompare(b.title))),
  );
  const undecidedEvents = computed(() => upcomingEvents.value.filter((e) => isUndecided(e, kids.value)));
  const flaggedEvents = computed(() => events.value.filter((e) => e.upstreamFlag));
  /** Favourite or not relevant, by activity id. */
  const ideaMarksByActivity = computed(() => new Map(ideaMarks.value.map((m) => [m.activityId, m])));
  const openTasks = computed(() => tasks.value.filter((t) => !t.done && eventsById.value.has(t.eventId)));

  function relevantKids(ev: Pick<FamilyEvent, "kidIds">): Kid[] {
    const ids = relevantKidIds(ev, kids.value);
    return sortedKids.value.filter((k) => ids.includes(k.id));
  }

  //
  // Offline cache
  //
  async function loadCache() {
    const snap = await idbGet<Snapshot>(SNAPSHOT_KEY).catch(() => undefined);
    if (snap && !live.value) {
      kids.value = snap.kids ?? [];
      sources.value = snap.sources ?? [];
      events.value = snap.events ?? [];
      tasks.value = snap.tasks ?? [];
      settingsDocs.value = snap.settings ? [snap.settings] : [];
      ideaMarks.value = snap.ideaMarks ?? [];
      cacheSavedAt.value = snap.savedAt;
      fromCache.value = true;
      loading.value = false;
    }
  }

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  function scheduleSave() {
    if (!live.value) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const snap: Snapshot = clone({
        kids: kids.value,
        sources: sources.value,
        events: events.value,
        tasks: tasks.value,
        settings: settingsDocs.value.find((s) => s.id === SETTINGS_ID) ?? null,
        ideaMarks: ideaMarks.value,
        savedAt: new Date().toISOString(),
      });
      cacheSavedAt.value = snap.savedAt;
      idbSet(SNAPSHOT_KEY, snap).catch((e) => console.warn("Could not cache data", e));
    }, 400);
  }
  watch([kids, sources, events, tasks, settingsDocs, ideaMarks], scheduleSave, { deep: true });

  /** Write the snapshot right away (e.g. before a reminder check). */
  async function flushCache() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = undefined;
      scheduleSave();
      await new Promise((r) => setTimeout(r, 450));
    }
  }

  //
  // Live data
  //
  const unsubscribers: (() => Promise<string>)[] = [];

  async function mirror<T extends Doc>(collection: CollectionAPI<T>, target: Ref<T[]>) {
    const buffer: T[] = [];
    let initial = true;
    const arr = () => (initial ? buffer : target.value);
    const upsert = (doc: T) => {
      const a = arr();
      const i = a.findIndex((d) => d.id === doc.id);
      if (i >= 0) a[i] = doc;
      else a.push(doc);
    };
    const unsub = await collection.subscribeAll(
      {},
      {
        onInitial: (doc) => buffer.push(doc),
        onAdd: upsert,
        onChange: (_old, doc) => upsert(doc),
        onDelete: (doc) => {
          const a = arr();
          const i = a.findIndex((d) => d.id === doc.id);
          if (i >= 0) a.splice(i, 1);
        },
      },
    );
    target.value = buffer;
    initial = false;
    unsubscribers.push(unsub);
  }

  let starting: Promise<void> | null = null;

  /** Subscribe to all collections. Falls back to cached data when offline. */
  function start(): Promise<void> {
    if (live.value) return Promise.resolve();
    if (starting) return starting;
    loadError.value = null;
    connecting.value = networkOnline.value;
    const work = (async () => {
      try {
        await Promise.all([
          mirror(col.kids, kids),
          mirror(col.sources, sources),
          mirror(col.events, events),
          mirror(col.tasks, tasks),
          mirror(col.settings, settingsDocs),
          mirror(col.ideaMarks, ideaMarks),
        ]);
      } catch (e) {
        await stop();
        throw e;
      }
      live.value = true;
      fromCache.value = false;
      loading.value = false;
      scheduleSave();
    })();
    starting = work.finally(() => {
      starting = null;
    });
    // Don't block the UI on a slow/missing connection; subscriptions keep trying.
    return timeout(starting, CONNECT_TIMEOUT_MS, "Bazaar connection timed out")
      .catch((e) => {
        loadError.value = e instanceof Error ? e.message : String(e);
        loading.value = false;
      })
      .finally(() => {
        connecting.value = false;
      });
  }

  let resubscribing: Promise<void> | null = null;

  /**
   * Renew the subscriptions after the socket reconnected (the phone slept, the
   * network dropped). The server forgets them with the old connection, so
   * changes would stop arriving. Mirroring again also reloads what was missed.
   */
  function resubscribe(): Promise<void> {
    if (!live.value || starting) return Promise.resolve();
    resubscribing ??= (async () => {
      const old = unsubscribers.splice(0);
      try {
        await Promise.all([
          mirror(col.kids, kids),
          mirror(col.sources, sources),
          mirror(col.events, events),
          mirror(col.tasks, tasks),
          mirror(col.settings, settingsDocs),
          mirror(col.ideaMarks, ideaMarks),
        ]);
      } catch (e) {
        console.warn("Bazaar resubscribe failed:", e);
      }
      for (const u of old) await u().catch(() => undefined);
    })().finally(() => {
      resubscribing = null;
    });
    return resubscribing;
  }
  watch(apiConnects, (n, prev) => {
    if (prev > 0 && n > prev) void resubscribe();
  });

  async function stop() {
    for (const u of unsubscribers.splice(0)) await u().catch(() => undefined);
    live.value = false;
  }

  function setNetworkOnline(v: boolean) {
    networkOnline.value = v;
    if (v && !live.value) start();
  }

  function refreshToday() {
    today.value = todayOf();
  }

  async function clearLocalData() {
    await idbClear();
  }

  //
  // Writes
  //
  function guard() {
    if (readOnly.value) throw new Error("You're offline. Changes are disabled until the connection is back.");
  }

  function write<T>(p: Promise<T>): Promise<T> {
    return timeout(p, WRITE_TIMEOUT_MS, "Saving to Bazaar timed out. Check your connection.");
  }

  /**
   * Save a doc and show it right away. The subscription echoes it back later;
   * the screen does not wait for that, so a slow or dropped subscription
   * never leaves a change invisible until a reload.
   */
  async function put<T extends Doc>(collection: CollectionAPI<T>, target: Ref<T[]>, doc: T, exists: boolean) {
    const saving: Promise<unknown> = exists ? collection.replaceOne(doc.id, doc) : collection.insertOne(doc);
    // Also when it lands after the timeout message, e.g. once a dead connection is replaced.
    saving.then(
      () => {
        const i = target.value.findIndex((d) => d.id === doc.id);
        if (i >= 0) target.value[i] = doc;
        else target.value.push(doc);
      },
      () => undefined,
    );
    await write(saving);
  }

  async function remove<T extends Doc>(collection: CollectionAPI<T>, target: Ref<T[]>, id: string) {
    const removing = collection.deleteOne(id);
    removing.then(
      () => {
        const i = target.value.findIndex((d) => d.id === id);
        if (i >= 0) target.value.splice(i, 1);
      },
      () => undefined,
    );
    await write(removing);
  }

  const nowIso = () => new Date().toISOString();

  // Kids
  async function saveKid(kid: Omit<Kid, "id"> & { id?: string }) {
    guard();
    const exists = !!kid.id && kids.value.some((k) => k.id === kid.id);
    await put(col.kids, kids, stripUndefined({ ...kid, id: kid.id ?? newId() } as Kid), exists);
  }

  async function deleteKid(id: string) {
    guard();
    await remove(col.kids, kids, id);
  }

  // Settings
  async function saveSettings(s: Settings) {
    guard();
    const doc = clone({ ...s, id: SETTINGS_ID });
    await put(col.settings, settingsDocs, doc, settingsDocs.value.some((d) => d.id === SETTINGS_ID));
  }

  // Idea marks
  /** Mark an idea as a favourite or not relevant; null removes the mark. */
  async function setIdeaMark(activity: { id: string; title: string }, mark: IdeaMark["mark"] | null) {
    guard();
    const existing = ideaMarksByActivity.value.get(activity.id);
    if (!mark) {
      if (existing) await remove(col.ideaMarks, ideaMarks, existing.id);
      return;
    }
    const doc: IdeaMark = { id: existing?.id ?? newId(), activityId: activity.id, mark, title: activity.title, updatedAt: nowIso() };
    await put(col.ideaMarks, ideaMarks, doc, !!existing);
  }

  // Events
  async function saveEvent(ev: FamilyEvent) {
    guard();
    const doc = stripUndefined(clone({ ...ev, updatedAt: nowIso() }));
    await put(col.events, events, doc, eventsById.value.has(ev.id));
  }

  function newManualEvent(partial: Partial<FamilyEvent>): FamilyEvent {
    const t = todayOf();
    return {
      id: newId(),
      title: "",
      start: t,
      end: t,
      category: "other",
      kidIds: [],
      segments: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
      ...partial,
    };
  }

  async function deleteEvent(id: string) {
    guard();
    const ts = tasks.value.filter((t) => t.eventId === id);
    await inBatches(ts, 20, (t) => remove(col.tasks, tasks, t.id));
    await remove(col.events, events, id);
  }

  /** Task changes implied by new segments (UI asks before deleting stale ones). */
  function planSegments(ev: FamilyEvent, segments: Segment[], segmentIds?: string[]): SegmentTaskPlan {
    const kidIds = relevantKidIds(ev, kids.value);
    const out: SegmentTaskPlan = { stale: [], create: [] };
    let pool = [...tasks.value];
    for (const seg of segments) {
      if (segmentIds && !segmentIds.includes(seg.id)) continue;
      const p = planSegmentTasks({
        event: ev,
        segment: seg,
        kids: kids.value,
        kidIds,
        tasks: pool,
        templates: settings.value.templates,
        today: todayOf(),
      });
      out.stale.push(...p.stale);
      out.create.push(...p.create);
      pool = [...pool, ...p.create];
    }
    return out;
  }

  async function commitSegments(ev: FamilyEvent, segments: Segment[], plan: SegmentTaskPlan | null, replaceStale: boolean) {
    guard();
    await saveEvent({ ...ev, segments });
    if (!plan) return;
    if (replaceStale) await inBatches(plan.stale, 20, (t) => remove(col.tasks, tasks, t.id));
    await inBatches(plan.create, 20, (t) => put(col.tasks, tasks, stripUndefined(t), false));
  }

  // Tasks
  async function saveTask(task: Task) {
    guard();
    const doc = stripUndefined(clone(task));
    await put(col.tasks, tasks, doc, tasks.value.some((t) => t.id === task.id));
  }

  async function addTask(
    eventId: string,
    title: string,
    parentId: string | null = null,
    due: string | null = null,
    segmentId?: string,
  ) {
    const siblings = tasks.value.filter((t) => t.eventId === eventId);
    const order = Math.max(-1, ...siblings.map((t) => t.order)) + 1;
    await saveTask({ id: newId(), eventId, segmentId, parentId, title, due, done: false, order });
  }

  async function toggleTask(task: Task) {
    await saveTask({ ...task, done: !task.done });
  }

  async function deleteTask(task: Task) {
    guard();
    const all = withDescendants([task], tasks.value);
    await inBatches(all, 20, (t) => remove(col.tasks, tasks, t.id));
  }

  // Sources & import
  async function saveSource(src: Source) {
    guard();
    const doc = stripUndefined(clone(src));
    await put(col.sources, sources, doc, sources.value.some((s) => s.id === src.id));
  }

  async function deleteSource(id: string, deleteEvents: boolean) {
    guard();
    const evs = events.value.filter((e) => e.sourceId === id);
    if (deleteEvents) {
      for (const e of evs) await deleteEvent(e.id);
    } else {
      await inBatches(evs, 20, (e) =>
        saveEvent(stripUndefined({ ...e, sourceId: undefined, externalKey: undefined, upstreamFlag: null })),
      );
    }
    await remove(col.sources, sources, id);
  }

  function prepareWeekendImport(source: Source): PendingImport {
    const fromToday = todayOf();
    const until = addMonths(fromToday, HORIZON_MONTHS);
    const plan = planWeekends({
      source,
      existing: events.value,
      tasks: tasks.value,
      today: fromToday,
      until,
      now: nowIso(),
    });
    return { source, plan, summary: summarize(plan) };
  }

  function prepareImport(source: Source, icsText: string): PendingImport {
    const from = todayOf();
    const until = addMonths(from, HORIZON_MONTHS);
    const parsed = parseIcs(icsText, { from, until, defaultCategory: source.defaultCategory });
    const plan = planImport({
      source,
      existing: events.value,
      parsed: parsed.items,
      tasks: tasks.value,
      from,
      until,
      now: nowIso(),
    });
    return { source, plan, summary: summarize(plan), calendarName: parsed.calendarName };
  }

  async function fetchSource(source: Source): Promise<string> {
    if (!source.url) throw new Error("This source has no URL.");
    try {
      return await fetchIcs(source.url, settings.value.corsProxy);
    } catch (e) {
      if (sources.value.some((s) => s.id === source.id) && !readOnly.value) {
        await saveSource({ ...source, lastError: e instanceof Error ? e.message : String(e) }).catch(() => undefined);
      }
      throw e;
    }
  }

  async function applyImport(pending: PendingImport) {
    guard();
    const { plan, source } = pending;
    const byId = eventsById.value;
    await saveSource({ ...source, lastImportedAt: nowIso(), lastError: undefined });
    await inBatches(plan.create, 20, (e) => put(col.events, events, stripUndefined(e), false));
    await inBatches(plan.update, 20, async (u) => {
      const ev = byId.get(u.id);
      if (ev) await put(col.events, events, stripUndefined({ ...ev, ...u.patch }), true);
    });
    await inBatches(plan.flagChanged, 20, async (f) => {
      const ev = byId.get(f.id);
      if (ev) {
        const doc = { ...ev, upstreamFlag: "changed" as const, upstreamPending: f.pending, category: f.category ?? ev.category };
        await put(col.events, events, stripUndefined(doc), true);
      }
    });
    await inBatches(plan.flagRemoved, 20, async (id) => {
      const ev = byId.get(id);
      if (ev) await put(col.events, events, stripUndefined({ ...ev, upstreamFlag: "removed", upstreamPending: null }), true);
    });
    await inBatches(plan.remove, 20, (id) => deleteEvent(id));
  }

  return {
    // state
    kids,
    sortedKids,
    sources,
    events,
    tasks,
    settings,
    ideaMarks,
    ideaMarksByActivity,
    live,
    connecting,
    loading,
    fromCache,
    cacheSavedAt,
    networkOnline,
    loadError,
    readOnly,
    today,
    // derived
    eventsById,
    tasksByEvent,
    upcomingEvents,
    undecidedEvents,
    flaggedEvents,
    openTasks,
    relevantKids,
    // lifecycle
    loadCache,
    start,
    stop,
    flushCache,
    setNetworkOnline,
    refreshToday,
    clearLocalData,
    // actions
    saveKid,
    deleteKid,
    saveSettings,
    setIdeaMark,
    saveEvent,
    newManualEvent,
    deleteEvent,
    planSegments,
    commitSegments,
    saveTask,
    addTask,
    toggleTask,
    deleteTask,
    saveSource,
    deleteSource,
    prepareWeekendImport,
    prepareImport,
    fetchSource,
    applyImport,
  };
});
