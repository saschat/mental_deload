import { createApp } from "vue";
import { createPinia } from "pinia";
import { registerSW } from "virtual:pwa-register";

import App from "./App.vue";
import { router } from "./router";
import "./assets/main.css";

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount("#app");

registerSW({
  immediate: true,
  // An installed app is resumed rather than reloaded, so the browser rarely looks for a new
  // version on its own; check whenever it comes to the foreground (autoUpdate then reloads).
  onRegisteredSW(_url, registration) {
    if (!registration) return;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && navigator.onLine) registration.update().catch(() => {});
    });
  },
});

navigator.serviceWorker?.addEventListener("message", (e) => {
  if (e.data?.type === "navigate" && typeof e.data.route === "string") router.push(e.data.route);
});
