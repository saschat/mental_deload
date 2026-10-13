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
- **Ideas**: outings, courses and holiday camps around Zürich for any upcoming weekend or holiday. Offers on those dates and seasonal places come first; filters (indoor/outdoor, travel time, category such as hikes, museums or pools, source, search) sit in a collapsible panel, and the weekend forecast preselects indoor or outdoor. Ideas match your kids' birth years, and any idea can be added to the weekend or holiday as an activity. See [Activity index](#activity-index).
- **Offline**: the last synced data is cached in IndexedDB; without a connection the app is read-only and shows a banner.

Screens: Inbox (needs decision), Upcoming, Tasks, Ideas, Event detail, Import & sources, Settings.

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
pnpm activities  # crawl the activity sources into public/activities.json (see below)
```

## Configuration

Copy `.env.example` to `.env.local` if you need to override anything.

| Variable          | Purpose                                                                                   |
| ----------------- | ----------------------------------------------------------------------------------------- |
| `VITE_APP_ID`     | Bazaar app ID. Defaults to `test` in dev. Required for production builds.                |
| `VITE_BAZAAR_URI` | Bazaar server. Defaults to `http://localhost:3377` in dev, the SDK default in production. |
| `VITE_BASE`       | Base path for hosting under a sub-path, e.g. `/mental_deload/` for GitHub Pages.          |

### Registering the app with Bazaar

1. Go to [cloud.bzr.dev/developers](https://cloud.bzr.dev/developers) and create an app.
2. Add the redirect URI where the app will be hosted, exactly as the browser sees it, including the trailing slash, e.g. `https://<user>.github.io/<repo>/`. The app uses `origin + pathname` as its redirect URI and hash-based routes, so this single URI covers every screen.
3. Use the app ID as `VITE_APP_ID`.

## Deploying to GitHub Pages

`.github/workflows/deploy.yml` builds and deploys on every push to `main`:

1. In the repository settings, go to **Pages** and set **Source: GitHub Actions**.
2. Under **Settings → Secrets and variables → Actions**, add `BAZAAR_APP_ID` with your app ID. A repository secret (Secrets tab) or a repository variable (Variables tab) both work. The value is not an environment variable on `github-pages`; the build job does not use that environment.
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

## Activity index

The Ideas screen reads `activities.json`, a static index built locally by `scripts/activities`, committed as `public/activities.json` and deployed with the app. The deploy workflow does not crawl: to refresh the ideas, run `pnpm activities`, then commit and push the updated index. A source that fails keeps its previous entries.

| Source | What | How it is read |
| --- | --- | --- |
| [swissfamilyfun.com](https://swissfamilyfun.com) | Hikes and outings across Switzerland: km, hours, climb, highest point, car/train time from Zürich, season, stroller, cost | Sitemap plus each post's fact table. The WordPress API is blocked. Round-ups without a fact table are skipped. |
| [familienausflug.info](https://familienausflug.info) | Rainy-day and indoor places within 60 km: age bands, stroller, season | Region listings, then each entry's JSON-LD and property blocks |
| [OpenStreetMap](https://www.openstreetmap.org) | Indoor playgrounds, trampoline parks, climbing halls, ice rinks, pools within 45 km | Overpass API |
| [Zürcher Gemeinschaftszentren](https://gz-zh.ch) | Kids' and family offers of all 17 GZs, including holiday weeks: dates, cost, ages, drop-in or sign-up | Each centre's `angebote` sitemap and offer pages. Centre locations come from the city's open-data WFS. |
| [Sportamt Stadt Zürich](https://www.stadt-zuerich.ch/sport-portal/angebot/ferienkurse) | Holiday and semester courses with birth-year ranges | The course portal's JSON API (`POST /sport-portal/API/api/courses`). It is undocumented and may change. |
| [Pro Juventute Ferienplausch](https://ferienplausch.feriennet.projuventute.ch) | Summer holiday activities with age, cost and location | Feriennet's public `/activities/json` |

The index keeps facts and a link only: no descriptions or images are copied, and every card links to the source page. Coordinates without a source value are geocoded with [geo.admin.ch](https://api3.geo.admin.ch) and elevations come from [Open-Meteo](https://open-meteo.com). The crawler waits between requests to each host and honours robots.txt crawl delays.

Run it locally with `pnpm activities` (Node 24+). `--only=gz,osm` limits the sources and `--max-pages=20` caps detail pages per source for a quick test. The first full run takes about an hour (mostly swissfamilyfun posts); incremental runs take a few minutes, because the crawl state in `.cache/activities-state.json` (gitignored) remembers which pages are unchanged. Without that file the next run is a full crawl again.

There is no official API for the City of Zürich's holiday offers. The city's [Ferienangebote für Kinder](https://www.stadt-zuerich.ch/de/lebenslagen/jugend-und-familie/kinder/freizeit-und-ferien/ferienangebote-fuer-kinder.html) page is a hand-maintained list per holiday that mostly links to GZ offers, which the GZ source covers.

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
    activities.ts  Activity index types and the Ideas filters (season, dates, ages, travel)
  lib/           Browser glue: IndexedDB, notifications, ICS fetch, reminder check
  stores/        Pinia stores (data mirrors the Bazaar collections; ui for toasts/dialogs)
  components/    UI components (coverage editor, task tree, status sheet, ...)
  views/         Screens
  sw.ts          Service worker: precache, periodic sync reminders, notification clicks
  bazaar.ts      Bazaar SDK singleton
samples/         Sample school calendar for development
scripts/         Icon generator; activities/ builds the activity index (one module per source)
```

Data is stored in five owner-scoped Bazaar collections: `kids`, `sources`, `events`, `tasks` and `settings`.

## Known limitations

- Reminders are best-effort (see above); use the calendar export for anything critical.
- Offline mode is read-only. There's no offline write queue.
- Import from web pages (non-ICS) is not supported.
- Single user. There's no sharing with a co-parent or grandparents yet.
