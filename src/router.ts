import { createRouter, createWebHashHistory } from "vue-router";

import InboxView from "@/views/InboxView.vue";

export const router = createRouter({
  // Hash history keeps GitHub Pages and the OAuth redirect URI simple.
  history: createWebHashHistory(),
  routes: [
    { path: "/", name: "inbox", component: InboxView, meta: { title: "Needs decision", tab: true } },
    { path: "/upcoming", name: "upcoming", component: () => import("@/views/UpcomingView.vue"), meta: { title: "Upcoming", tab: true } },
    { path: "/tasks", name: "tasks", component: () => import("@/views/TasksView.vue"), meta: { title: "Tasks", tab: true } },
    { path: "/event/new", name: "event-new", component: () => import("@/views/EventFormView.vue"), meta: { title: "New event" } },
    { path: "/event/:id", name: "event", component: () => import("@/views/EventView.vue"), meta: { title: "Event" } },
    { path: "/event/:id/edit", name: "event-edit", component: () => import("@/views/EventFormView.vue"), meta: { title: "Edit event" } },
    { path: "/sources", name: "sources", component: () => import("@/views/SourcesView.vue"), meta: { title: "Import & sources" } },
    { path: "/settings", name: "settings", component: () => import("@/views/SettingsView.vue"), meta: { title: "Settings" } },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
  scrollBehavior: () => ({ top: 0 }),
});
