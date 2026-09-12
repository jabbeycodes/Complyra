# iOS and Android from this website

Complyrer is a Vite + React web app with a Supabase backend. Do not rewrite it in Flutter or React Native. The store apps should wrap this same product.

## What changes in the current build

**Nothing about the website loop changes.** `npm run dev`, `npm run build`, Playwright, and hosted Supabase stay as they are.

This repo now has a Capacitor shell next to that web app:

| Surface | Source | Affected by mobile work? |
|---|---|---|
| Website (`npm run dev` / `npm run build`) | Vite + React | No product rewrite. Optional safe-area meta tags only. |
| iOS / Android binaries | Capacitor loads the same UI | New folders after you run `npx cap add` on a Mac |
| Supabase Auth, RLS, storage | Existing hosted project | Same APIs. Native apps must use the hosted backend, not localStorage demo data. |

Apple and Google review a **native binary**. They do not review every website deploy. You can keep shipping web updates daily.

## Two ways to feed the native apps

1. **Bundled `dist/` (default)**  
   `npm run mobile:sync` builds the website and copies it into Xcode / Android Studio. Store updates require a new binary, or a later live-update service.

2. **Live URL (recommended once complyrer.com is hosted)**  
   `CAPACITOR_SERVER_URL=https://complyrer.com npm run mobile:sync`  
   The app is a branded shell. Website deploys appear in the app without a store resubmit. The Vite config does not need a different `base` path.

Do not point store builds at the local demo API. App Store users must hit Auth + RLS.

## One-time machine setup (your Mac)

You need Xcode, an Apple Developer Program membership, Android Studio, and a Google Play developer account. This Linux environment cannot sign or upload store binaries.

```sh
npm install
npx cap add ios
npx cap add android
npm run mobile:sync
npm run mobile:ios      # opens Xcode
npm run mobile:android  # opens Android Studio
```

Then, in Xcode: set the team, bundle id `com.complyrer.app`, icons, splash, and signing. Archive → TestFlight → App Store.

In Android Studio: generate a Play App Signing key, build an AAB, upload to Play Console.

## Store review you should plan for now

- Privacy policy URL on complyrer.com (required).
- Account deletion path (Apple).
- No HIPAA or “certified compliant” claims.
- Production builds must not expose the fictional Evergreen demo password.
- Apple sometimes rejects a bare website in a WebView. Mitigations that still reuse this UI: splash screen, status bar, provider-code login, file picker for ISP/PCSP PDFs, later push notifications.
- If you add Google/Apple social login later, Apple requires Sign in with Apple. Username + provider code does not trigger that rule.

## When to add native plugins

Add a plugin only when the browser cannot do the job:

- `@capacitor/camera` or filesystem — if in-app PDF capture is painful
- Push — acknowledgment / due-date alerts
- Biometrics — unlock after the first provider-code login

Each plugin is opt-in. The website ignores them.

## What this is not

A Flutter rewrite, a second product, or a reason to pause the web sellable loop (PCSP upload → review → acknowledgments). Ship the website first. Use TestFlight when the hosted login and pending-agency queue are stable.
