import { bindings, defineConfig } from "cf/config";
import * as entrypoint from "./src/index.js" with { type: "cf-worker" };

export default defineConfig({
  worker: {
    name: "rain-alley-auth",
    compatibilityDate: "2026-10-24",
    entrypoint,
    // Use a first-party zone hostname for desktop clients.  The workers.dev
    // hostname is not reliably reachable on every network, while Cloudflare
    // can provision the certificate and Worker binding for this domain during
    // deployment.
    domains: ["auth.600318.xyz"],
    workersDev: true,
    previewUrls: true,
    env: {
      DB: bindings.d1({ name: "rain-alley-accounts" }),
    },
    observability: {
      enabled: true,
      logs: { enabled: true, headSamplingRate: 1, persist: true },
      traces: { enabled: true, headSamplingRate: 0.1, persist: true },
    },
  },
});
