# Mental Deload

An installable PWA that helps a (single) parent stay ahead of school holidays, birthdays and other family events: decide early who looks after which kid, get the follow-up tasks generated, and be reminded in time.

Built with Vue 3, Vite, TypeScript, Pinia and [Bazaar](https://cloud.bzr.dev) as the backend (each user's data lives in their own Bazaar account).

## Features

- **Kids**: name, colour, emoji or photo avatar.
- **Sources**: subscribe to ICS URLs (school calendars, Google Calendar "secret address in iCal format", `webcal://` links), upload `.ics` files, or add events manually.
- **Idempotent import**: events are matched by source + UID (+ RECURRENCE-ID). Re-importing updates unchanged events in place. Events you already decided or have tasks for are never silently changed; they get flagged as **changed upstream** or **removed upstream** for review. Recurring events are expanded for the next 18 months.
- **Coverage**: per-kid statuses (Child care, Grandparents, Family vacation, Parent off, Holiday camp, Attending, Not relevant), with a "same for both kids" default. Events can be split into segments (e.g. week 1 grandparents, week 2 camp). An event stays in the inbox until every day is covered for every relevant kid.
- **Tasks**: each status has an editable template of (nested) tasks with due dates relative to the segment start. Changing a status offers to replace the previously generated tasks.
- **Reminders**: tiered reminders for undecided events (default 6 months, 3 months, 1 month, then weekly; birthdays 3 weeks, 1 week, then every 2 days) plus overdue / due-soon tasks. See [Notifications](#notifications-and-their-limits).
- **Offline**: the last synced data is cached in IndexedDB; without a connection the app is read-only and shows a banner.

Screens: Inbox (needs decision), Upcoming, Tasks, Event detail, Import & sources, Settings.

## Development

Requires Node 22+ and pnpm 9.

```sh
pnpm install
pnpm run mock   # terminal 1: Bazaar mock server on http://localhost:3377
pnpm dev        # terminal 2: app on http://localhost:5173
```

The mock is configured for app ID `test` and redirect URI `http://localhost:5173/`, so keep the dev server on port 5173.

**Mock login quirk:** log in with any email (no code needed). The very first login with a new email asks for a handle and name (onboarding), and that breaks the login flow. Just click "Log in with Bazaar" again afterwards.

A sample school calendar is served in dev at `http://localhost:5173/samples/school-sample.ics`. Use it via Import & sources → Add calendar URL.

Other scripts:

```sh
pnpm test        # vitest unit tests for the pure domain modules (src/core)
pnpm type-check  # vue-tsc
pnpm build       # type-check + production build (dist/, including the service worker)
pnpm icons       # regenerate public/icons/*.png (pure Node, no deps)
```

## Configuration

Copy `.env.example` to `.env.local` if you need to override anything.

| Variable          | Purpose                                                                                   |
| ----------------- | ----------------------------------------------------------------------------------------- |
| `VITE_APP_ID`     | Bazaar app ID. Defaults to `test` (the mock).                                             |
| `VITE_BAZAAR_URI` | Bazaar server. Defaults to `http://localhost:3377` in dev, the SDK default in production. |
| `VITE_BASE`       | Base path for hosting under a sub-path, e.g. `/mental_deload/` for GitHub Pages.          |

### Registering the app with Bazaar

1. Go to [cloud.bzr.dev/developers](https://cloud.bzr.dev/developers) and create an app.
2. Add the redirect URI where the app will be hosted, exactly as the browser sees it, including the trailing slash, e.g. `https://<user>.github.io/<repo>/`. The app uses `origin + pathname` as its redirect URI and hash-based routes, so this single URI covers every screen.
3. Use the app ID as `VITE_APP_ID`.

## Deploying to GitHub Pages

`.github/workflows/deploy.yml` builds and deploys on every push to `main`:

1. In the repository settings, go to **Pages** and set **Source: GitHub Actions**.
2. Under **Settings → Secrets and variables → Actions → Variables**, add `BAZAAR_APP_ID` with your app ID.
3. Push to `main`. The workflow runs the tests, builds with `VITE_BASE=/<repo-name>/` and deploys `dist/`.

For a custom domain or user site (served from `/`), drop `VITE_BASE` from the workflow.

## Installing on Android

1. Open the deployed URL in Chrome on Android.
2. Tap the menu → **Install app** (or **Add to Home screen**).
3. Open it from the home screen, log in, then go to Settings → Notifications → **Enable**.

Installing matters: background reminder checks (see below) only work for an installed PWA.

## Notifications and their limits

Bazaar has no web push and no server-side scheduling, so everything happens on the device:

- **When the app is opened** (and whenever it comes back to the foreground), reminders are computed and shown as in-app banners and, if permitted, system notifications.
- **In the background**, the service worker registers [Periodic Background Sync](https://developer.mozilla.org/en-US/docs/Web/API/Web_Periodic_Background_Synchronization_API) (roughly every 12 hours) and computes reminders from the IndexedDB snapshot of your data. This only works in Chromium browsers for an **installed** PWA, and the browser decides when (and whether) it runs based on how much you use the app. Expect at most about one check per day, possibly less. It does not work on iOS or Firefox.
- Every reminder tier is sent only once (tracked in IndexedDB), and only the most recent tier you've crossed fires.
- The background check works from the last synced snapshot. Changes made on another device show up after this device has opened the app again.

**Guaranteed alerts:** Settings → **Export reminders to calendar** downloads an `.ics` file with all undecided events and open tasks, with alarms at each reminder tier. Import it into Google Calendar or your phone's calendar. Re-export after changes; the entries keep stable IDs, so importing again updates them.

## Calendar URLs and CORS

ICS URLs are fetched directly by the browser (Bazaar can't fetch URLs server-side). Many calendar servers, including Google Calendar, don't send CORS headers, so the fetch fails. When that happens, the app explains it and offers two ways around it:

- **Upload the file** instead: download the `.ics` yourself and use "Upload file" on the source. You can upload a new version later, and the import stays idempotent.
- **CORS proxy**: Settings → CORS proxy prefix. The calendar URL is appended to the prefix (URL-encoded), or substituted for `{url}` if the prefix contains it, e.g. `https://my-proxy.example/?url=`. Only use a proxy you trust: secret calendar URLs pass through it.

## Project structure

```
src/
  core/          Pure, framework-free domain logic (unit tested)
    types.ts       Data model: Kid, Source, FamilyEvent, Segment, Task, Settings
    dates.ts       ISO date helpers (all-day dates, inclusive end)
    defaults.ts    Statuses, colours, default task templates and reminder tiers
    coverage.ts    Segments, per-kid coverage, "undecided" logic
    tasks.ts       Template → task generation, task trees, grouping
    reminders.ts   Tiered reminder computation and dedupe keys
    icsParse.ts    ICS parsing + recurrence expansion (ical.js)
    importDiff.ts  Import planning: create / update / flag / remove
    icsExport.ts   Reminders .ics export with VALARMs
  lib/           Browser glue: IndexedDB, notifications, ICS fetch, reminder check
  stores/        Pinia stores (data mirrors the Bazaar collections; ui for toasts/dialogs)
  components/    UI components (coverage editor, task tree, status sheet, ...)
  views/         Screens
  sw.ts          Service worker: precache, periodic sync reminders, notification clicks
  bazaar.ts      Bazaar SDK singleton
samples/         Sample school calendar for development
scripts/         Icon generator
```

Data is stored in five owner-scoped Bazaar collections: `kids`, `sources`, `events`, `tasks` and `settings`.

## Known limitations

- Reminders are best-effort (see above); use the calendar export for anything critical.
- Offline mode is read-only. There's no offline write queue.
- Import from web pages (non-ICS) is not supported.
- Single user. There's no sharing with a co-parent or grandparents yet.
