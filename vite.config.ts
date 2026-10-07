import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  if (mode === "production" && !process.env.VITE_APP_ID) {
    throw new Error(
      "VITE_APP_ID is required for a production build. Set the BAZAAR_APP_ID GitHub Actions secret or repository variable.",
    );
  }

  // On GitHub Pages the app lives under /<repo>/; the workflow sets VITE_BASE.
  const base = process.env.VITE_BASE || "/";

  return {
    base,
    plugins: [
      vue(),
      VitePWA({
        strategies: "injectManifest",
        srcDir: "src",
        filename: "sw.ts",
        registerType: "autoUpdate",
        injectRegister: false,
        injectManifest: {
          globPatterns: ["**/*.{js,css,html,svg,png,ico,webmanifest}"],
        },
        devOptions: {
          enabled: true,
          type: "module",
        },
        manifest: {
          name: "Mental Deload",
          short_name: "Deload",
          description:
            "Plan school holidays, birthdays and family events for your kids.",
          theme_color: "#4a5bd4",
          background_color: "#f7f8fc",
          display: "standalone",
          orientation: "portrait",
          start_url: ".",
          scope: ".",
          icons: [
            { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
            { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
            {
              src: "icons/icon-maskable-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        },
      }),
    ],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    test: {
      include: ["src/**/*.test.ts"],
      environment: "node",
    },
  };
});
