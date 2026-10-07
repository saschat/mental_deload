import { BazaarApp, type BazaarOptions } from "@bzr/bazaar";
import { ref } from "vue";

/** Last API connection problem, shown in the UI (we stay logged in for offline use). */
export const connectError = ref<string | null>(null);
export const apiConnected = ref(false);

const config: BazaarOptions = {
  appId: import.meta.env.VITE_APP_ID || "test",
  loginRedirectUri: window.location.origin + window.location.pathname,
  onApiConnect: async () => {
    apiConnected.value = true;
    connectError.value = null;
  },
  onApiConnectError: async (_bzr: BazaarApp, message: string) => {
    console.warn("Bazaar connect error:", message);
    apiConnected.value = false;
    connectError.value = message;
  },
  onLoginError: async (_bzr: BazaarApp, message: string) => {
    console.warn("Bazaar login error:", message);
    connectError.value = message;
  },
};

if (import.meta.env.VITE_BAZAAR_URI) {
  config.bazaarUri = import.meta.env.VITE_BAZAAR_URI;
} else if (import.meta.env.DEV) {
  config.bazaarUri = "http://localhost:3377";
}

export const bzr = new BazaarApp(config);
