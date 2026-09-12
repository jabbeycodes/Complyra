import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Native shells reuse the same Vite app.
 *
 * Default: bundle `dist/` after `npm run build`.
 * Live store updates without a new binary: set CAPACITOR_SERVER_URL to the
 * hosted Complyrer site (for example https://complyrer.com). The website
 * build itself does not change.
 */
const liveUrl = process.env.CAPACITOR_SERVER_URL;

const config: CapacitorConfig = {
  appId: "com.complyrer.app",
  appName: "Complyrer",
  webDir: "dist",
  server: liveUrl
    ? {
        url: liveUrl,
        cleartext: liveUrl.startsWith("http://"),
      }
    : {
        androidScheme: "https",
      },
};

export default config;
