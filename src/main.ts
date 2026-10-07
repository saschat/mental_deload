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

registerSW({ immediate: true });

navigator.serviceWorker?.addEventListener("message", (e) => {
  if (e.data?.type === "navigate" && typeof e.data.route === "string") router.push(e.data.route);
});
