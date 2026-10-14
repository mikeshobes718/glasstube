# GlassTube agent mailbox

You are the other Cursor (not the Mac Cursor Mike talks to). Mike talks only to the Mac Cursor in this repo. You talk only through this file. Always use HANDOFF.md. Never wait for a chat from Mike.

Standing orders (do this every session):
1. `git pull` (or `git pull gitlab main`) before you read or write this file.
2. Read `## To other`. That is your job list.
3. Do the work in this repo. Leave unrelated files alone.
4. Edit only `## To Mac` and one line under `### HUD v2 on the Mac, 2026-10-14

- **Live.** `npm run deploy` from a clean `hud-v2` worktree
  (`~/Documents/glasstube-hud-v2`). Page, `/api/pair` and local stamp all say
  build `12aa906d`. `node scripts/selftest.mjs` against production: every
  check passes (1 expected skip, server-side resolve), including the browser
  checks: HUD loads clean and plays the phone file route in 2.1 s.
  `scripts/test-delivery.mjs` 50/50. `/api/suggest` and
  `/.well-known/meta-wearables-manifest.json` answer.
- **iOS.** Built and installed with `ios/install.sh` from the hud-v2 worktree:
  first compile, no errors. This build has hud-v2's iOS code only, NOT the
  uncommitted Berth account-sync work in `~/Documents/glasstube`.
- **Backend is Berth**, app `glasstube` (`berth logs --app glasstube` shows the
  live glasstube_poll/push/touch traffic and the WP6 probes 404ing).
- **WP6 SQL rewritten, not run.** The draft would have broken WP6 itself:
  `ack_seq` already exists and the live `glasstube_ack` writes it, so a 'got'
  for push N landed on a row still saying 'playing' for N-1 and /api/push
  would answer "Playing" for every later push (reproduced on a local copy of
  the live schema). Also: Berth takes one statement per request (no
  begin/commit), lookups now go through the live `glasstube_find` (trim +
  expiry), no revoke/grant (live functions use default EXECUTE, and the
  Supabase roles do not exist on Berth), and the rollback no longer drops the
  live `ack_seq`. **Run on 2026-10-14** with `sh scripts/sql/run-berth.sh
  scripts/sql/2026-10-delivery.sql`; /api/push now waits for the glasses
  (verified on production: playing -> "Playing", pinch -> "Pinch to start
  it", got only -> "still starting it"). The selftest treats the honest
  "not checked in" answer for its glasses-less pair as a pass.
- **Mike's decisions**, applied: amber (not red) phone banner for
  not-yet-confirmed outcomes, outlined Play all pill, HUD proxy wait 9 s,
  pinch on Finished replays the last video, held pushes go to Missed after
  10 min. Live as build `e8081a40`. The amber-banner iOS build compiled but
  the iPhone was unavailable; install it with `ios/install.sh` from the
  hud-v2 worktree.

## Log`. Do not rewrite `## To other` except a short DONE line if needed.
5. When done or blocked, write a clear status under `## To Mac` so Mac Cursor can tell Mike.
6. Commit with a message like `handoff: ...` then `git push` the GitLab remote only. Never push origin/GitHub.
7. No secrets, no PATs, no `.env` contents in this file.
8. After you push, stop. Mac Cursor will pull and read `## To Mac`.
9. Start the next session the same way: pull, read, work, push.
10. Remote: `gitlab` = `https://gitlab.com/mikeshobes718/glasstube.git`

## Rules

- Always `git pull` (or `git pull gitlab main` on the Mac) before reading or writing.
- Edit only your section.
- Commit message like `handoff: ...` and `git push` the GitLab remote.
- Mac Cursor writes under `## To other`
- Other Cursor writes under `## To Mac`
- Both append a one-line dated note under `## Log`
- Do not rewrite the other agent's section except to mark items done with a short DONE line if needed
- No secrets, no PATs, no .env

## To other

Job from Mike (2026-09-14): DONE by the Mac side. Read this before you touch the
play path again. Two of the standing instructions in the old 2026-08-31 entry
are now known to be wrong, so that entry is superseded.

Facts, all measured on 2026-09-14, none guessed:

- YouTube answers **Vercel's IPs** with `LOGIN_REQUIRED` ("Sign in to confirm
  you're not a bot") for nearly every video. Measured across ANDROID,
  ANDROID_SDKLESS, ANDROID_VR and IOS, with and without a real `visitorData`
  lifted from a live page load. Server-side resolve is a bonus route, never the
  plan.
- YouTube answers InnerTube with **403** whenever the request carries a
  non-YouTube `Origin` header. A browser always sends one on a cross-origin
  POST, so the HUD can never call InnerTube itself. `askClientStream()` was
  deleted rather than left in to fail. Do not re-add it.
- The file URL carries `ip` inside its signed `sparams`, so it is bound to the
  public IP that resolved it. That is exactly why pushing it to the glasses
  works: on the same WiFi they share the phone's public IP. The old entry read
  this as a reason to avoid the raw URL; it is the reason to use it.
- The **YouTube embed does play** - verified end to end in Chromium against
  production. Whether the Meta WebView still throws error 150 is unknown, so
  the embed is now the third route rather than a banned one.

What changed:

- HUD route chain is `file > proxy > embed > go`, named not numbered, and
  whichever route worked last is tried first next time (`glasstube.route`).
  `file` is skipped when there is no file, so no attempt is wasted.
- The HUD **no longer `location.replace`s to the phone's relay**. That threw
  away the queue, the settings and every Neural Band binding. The relay is
  plain HTTP against an HTTPS HUD, so it can never be an inline `<video>`; it
  is now a button on the error screen and nothing else.
- iOS `attachStreams` sends **both**: `u` is the googlevideo file (HTTPS, plays
  inside the HUD, survives the phone sleeping), `r` is the LAN relay. The old
  build sent only `r`, and dropped `u` entirely whenever the relay probe
  failed.
- Root cause of "nothing plays at all": the phone was still on **1.23 (24)**.
  1.24 was built but never installed, so the HUD sat waiting for a payload the
  phone had no code to send. Now **1.25 (26)**, installed.
- New on the glasses: D-pad letter-grid search with no sign-in (`/api/search`
  reads `ytInitialData`, and that endpoint does answer Vercel's IPs), library
  browse once the phone sends its session, per-video resume marks, next-video
  prefetch, scrolling lists, a buffered-ahead bar, and Diagnostics with a live
  self-test.
- Pairing is no longer the six character code alone. A successful pair mints a
  **link token** (64 hex, `glasstube_pairs.link_token`); `poll`, `push`, `touch`
  and `ack` all accept a code *or* a token under the same `p_code` argument, and
  a paired row now lives **365 days past last activity** instead of 24 hours.
  The code keeps its 24h window because it is guessable and on-screen. Both
  clients store the token and send it as `code`. Migration:
  `glasstube_durable_pair_link`.
- Every push carries the iPhone build as `app`. The HUD compares it against
  `MIN_PHONE_APP` in `app.js` and says "update the iPhone app" rather than
  blaming YouTube. **Raise `MIN_PHONE_APP` whenever you change the push payload
  shape** - that is the guard against repeating the September outage.
- `node scripts/selftest.mjs` runs the whole chain against production, browser
  included. Run it before and after anything in the play path. It needs
  `npm i playwright-core` for the browser half and skips it cleanly otherwise.
- Hobby plan caps at **12 serverless functions**. `/api/search` is a rewrite
  onto `api/feed.js` for that reason alone. Count before adding an endpoint.

## To Mac

2026-09-14 Mac: play path rebuilt, deployed to production, iOS 1.25 (26) built
and installed on Mike's iPhone over the wireless pairing.

Verified on production in a real browser:

- `file` route plays a phone-resolved googlevideo URL end to end inside the HUD
  (two videos, correct durations, buffered bar advancing).
- With no file at all, the chain falls through `proxy` (fails in about 2s) to
  `embed`, which plays in about 4s.
- `/api/search?q=` returns 20 results with durations and view counts.
- push -> poll round trip carries both `u` (1101 chars) and `r`.
- Every screen renders and navigates with arrows and Enter only; Back is
  reachable from the search grid without the glasses' own back gesture.

Not verified, needs Mike wearing the glasses:

- Whether the Meta WebView plays the googlevideo `<video>`. This is the one
  that matters; everything else is a fallback.
- Whether the WebView still throws error 150 on the embed route.
- Whether the glasses really do share the phone's public IP on his WiFi.

If it still fails: Diagnostics on the glasses, Run self-test, Copy errors. The
readout now names the page origin, the route chain, whether the phone sent a
file, and whether the server can resolve anything today.
2026-10-14 Mac: deployed hud-v2 (build 12aa906d) to production; selftest all pass; iOS WebScreen change built and installed (2.2 (35), hud-v2 code only); WP6 SQL corrected for Berth, not run yet. Details under To Mac.
2026-10-14 Mac: WP6 migration run on Berth (5 statements, smoke-tested), Mike's decisions applied (amber phone banner, outlined Play all, 9s proxy wait, Finished replays the last video), build e8081a40 deployed; selftest all pass; confirmed delivery verified end to end on production; PR #1 merged.

### Follow-up, same day

Mike confirmed video plays again on the glasses. Two things came out of it:

- He had to retype the pair code on every app launch. Cause: pair rows expired
  24h after last touch, and the phone's `connect()` on boot just showed an
  error when the touch failed. Fixed with the link token above; verified in a
  browser that the phone reconnects on its own after a restart, and after the
  six character code is deleted outright.
- "Make sure this never breaks again" -> the self test script, the version
  stamp guard, and route memory that can no longer demote the phone file route
  behind a fallback it happened to use last night.

### Native rewrite, 2026-09-14

The iPhone app is now SwiftUI, version **2.0 (28)**. `phone.html` is no longer
what the app shows; it stays deployed as the browser fallback only.

- New files: `Models.swift`, `Store.swift`, `API.swift`, `GoogleAuth.swift`,
  `Components.swift`, `SendView.swift`, `PairView.swift`, `SearchView.swift`,
  `LibraryView.swift`, `ListsView.swift`, `AccountView.swift`,
  `GlassesView.swift`. `RootView.swift` is a four-tab `TabView`.
- `WebScreen.swift` is untouched apart from the version stamp and the u/r
  split. It still owns `YouTubePage`, `StreamResolver` and the unlock screen,
  and native code now calls `StreamResolver.attachStreams` / `postPush`
  directly instead of going through the JS message bridge. **Do not move the
  resolver**: it has to run in native code on the phone's own IP.
- The Google session moved from web `localStorage` to the **Keychain**
  (`Store.swift`). Session rotation from the `X-GlassTube-Session` header is
  captured in `API.onSessionRotated`.
- The project is generated by **xcodegen** from `project.yml`. After adding a
  Swift file run `xcodegen generate` in `ios/`, or the build will not see it.
- Debug-only launch hooks, used for screenshots and for exercising the send
  path without tapping: `GT_TAB`, `GT_QUERY`, `GT_SEND`. They are inside
  `#if DEBUG` and cannot fire in a release build.
- Icon replaced everywhere: `ios/.../AppIcon.appiconset`, `LaunchIcon`, and the
  web set (`icon-96/128/192/512`, `apple-touch-icon`, `favicon*`,
  `glasstube-icon-master`). The manifest icons carry `?v=3` so the Meta drawer
  refetches them.

### Redesign and settings, 2026-09-14

iPhone app **2.1 (29)**. Deployment target raised to **iOS 26** - the phone runs
iOS 27 and the SDK is 27, so Liquid Glass is used natively rather than behind
availability checks everywhere.

- `Theme.swift` is the design system: appearance mode (system/light/dark), six
  accents with a **separate value per colour scheme**, `gtGlass` / `gtSoftScrollEdges`
  / `gtTabBarMinimize` wrappers, and a `Haptics` switch. Every glass call goes
  through those wrappers, so a fallback for an older OS is one edit.
- `.preferredColorScheme(.dark)` is gone from `GlassTubeApp`. It is driven from
  `RootView` by the setting. The old build hardcoded dark and then assumed dark
  underneath, which is why light mode was not a switch away.
- New `SettingsView` (fifth tab): appearance, accent, data saver, confirm-before-list,
  haptics, account, pairing summary, re-send channels, diagnostics, a plain-English
  "how a video gets there" page, and reset-local-data.
- `StreamResolver.dataSaver` caps the format at 360p when Settings asks. The HUD
  is 600x600, so the difference is hard to see and the saving is not.
- The Glasses tab lost account and diagnostics to Settings; it is now connection,
  sign-in handoff and the HUD preview.

Note for whoever picks this up: the visual layer is my own design against
Apple's current HIG and the iOS 27 SDK, **not** reference-driven from Mobbin.
Mobbin's MCP server was authorized after this session began, so its tools never
registered. Re-running the design pass with Mobbin references is still open.

### Red icon, 2026-09-14

Icon redone in YouTube red at Mike's request, build **2.1 (30)**. Three variants
were rendered and compared at 200/80/56/40px before picking: a straight recolour
of the cyan mark and an all-red glowing version both collapse into a red blob at
drawer size. The shipped one keeps a **white brow against the solid red panel** -
that contrast is the only thing separating it from a generic red play button
once it is small.

The in-app accent now defaults to red too, so the app and its icon read as one
thing. Anyone who prefers the old cyan picks "Glass" in Settings > Accent; the
cyan values are still in `Theme.Accent`.

Web icons went to `?v=4` so the Meta drawer refetches.

## Log

2026-08-31 Mac: created this mailbox so Mac Cursor and the other Cursor can talk via GitLab.
2026-08-31 other: hunt-first resolve with in-page session InnerTube, relay probe gate, playlist play page, iOS 1.24/25. Details under To Mac.
2026-08-31 other: wrote the full f0e1950 result summary under To other for the other computer's Cursor, asking it to pull, test with Mike, and report back under To Mac.
2026-08-31 Mac: pulled 2ab0d1b, deployed glasstube.vercel.app, built 1.24 (25). Install blocked: iPhone developer tunnel unavailable.
2026-09-14 Mac: route chain file>proxy>embed>go, phone sends the googlevideo file directly, glasses search and library, iOS 1.25 (26) installed. Details under To Mac.
2026-09-14 Mac: durable pair link token (no more retyping the code), push carries the iPhone build, scripts/selftest.mjs, iOS 1.25 (27).
2026-09-14 Mac: iPhone app rewritten in SwiftUI (2.0/28), new icon on both iOS and the Meta drawer, feed caching for YouTube's bursty RSS.
2026-09-14 Mac: Liquid Glass redesign, light/dark/system with per-scheme accents, real Settings tab, iOS 2.1 (29), target raised to iOS 26.
2026-09-14 Mac: icon redone in YouTube red across iOS and the web set, app accent defaults to match, iOS 2.1 (30).
2026-10-14 cloud: HUD v2 (WP1-WP8 plus 9 review rounds) on branch hud-v2; deploy, Restart, iOS build and WP6 SQL left for the Mac. Details under "HUD v2 built".

### Share from YouTube, 2026-09-24

iPhone app **2.2 (33)**, installed. New `GlassTubeShare` share extension
(`ios/GlassTubeShare/`, bundle `com.mikeshobes.glasstube.share`). It sends
nothing itself: the resolver needs the app's WKWebView, its unlock screen and
the LAN relay. It finds the link and opens `glasstube://send?url=…`, which
`RootView.onOpenURL` already sends to the glasses. If iOS ever stops letting
extensions open their app, it copies the link and says to tap Paste.

Build and install with `ios/install.sh`. Xcode has no Apple ID here, and the
wildcard profile cannot carry Sign In with Apple (added with the Berth work),
so the script builds unsigned and signs with the ASC-made profiles in
`ios/signing/` (gitignored). The signing cert expires 2027-07-24; remake them with
`~/Documents/Cook/scripts/asc.py` and the key in `~/Documents/Keys/.env`.

### Glasses HUD overhaul, 2026-10-13 (to the cloud session)

The plan is `docs/hud-plan/PLAN.md` (8 work packages, WP1 to WP8, design
system, platform research incl. Meta's official toolkit values). Every
finding with evidence is in `docs/hud-plan/audit.json`. Judge visuals with
`scripts/hudshot.mjs --additive` (it stubs pairing locally and can fake a
phone push with `--push <videoId>`), never by reading CSS alone.

Rules that bit us:
- `api/_rpc.js` routes pairing to Berth (`api.atberth.com`). It is live.
  Any deploy without it breaks pairing for everyone.
- The glasses keep the loaded page for days. Nothing deployed reaches them
  until WP1's self-update lands, or Mike uses Restart in the web app menu.
- `node scripts/selftest.mjs` before and after anything in the play path.
- The iPhone app cannot be built or installed from the cloud (no signing,
  no device). iOS changes go in a branch for the Mac to build with
  `ios/install.sh`.
- Uncommitted iOS work (Berth account sync: Berth.swift, SyncAccountView.swift,
  Store.swift...) lives only on the Mac and belongs to another chat.

### HUD v2 built, 2026-10-14 (from the cloud session)

Branch `hud-v2`, PR to main. All eight work packages from
`docs/hud-plan/PLAN.md` are in, merged in plan order, then put through nine
rounds of review (visuals on additive screenshots, Neural Band navigation,
player and push, code regressions, performance against Meta's budgets). Each
finding was reproduced by two independent skeptics before it was fixed. The
last rounds: performance clean for four rounds, player and regressions clean
for three. Before/after additive screenshots are in `docs/hud-plan/shots/`.

Not done from the cloud, needs the Mac:
- **Deploy.** The cloud environment blocks glasstube.vercel.app, youtube.com
  and vercel.com, and has no Vercel login. Run `npm run deploy` (it stamps the
  build, then `vercel --prod`) from a clean checkout of `hud-v2`. Then
  `node scripts/selftest.mjs`; it has not been run against production with
  this code. `api/_rpc.js` is byte-identical to main.
- **One Restart on the glasses after the deploy.** The page in memory has no
  updater. Middle-finger tap on GlassTube's Home, then Restart. After that the
  build chip at the top right shows the new hash for 3 s, and later deploys
  reload by themselves after about 20 s idle on Home.
- **iOS** (not compiled here): `ios/GlassTube/WebScreen.swift` gives the push
  request its own 30 s session (semaphore 32 s), because `/api/push` now waits
  up to 9.5 s for the glasses to confirm. Build with `ios/install.sh`. Once that
  build is out, `BUDGET_MS` in `api/push.js` can go from 9500 to about 13000.
- **WP6 migration** `scripts/sql/2026-10-delivery.sql` is NOT run. Read its
  header: pick the backend `GLASSTUBE_SUPABASE_URL` serves (Supabase or Berth),
  check the ASSUMED lines against `pg_get_functiondef`, deploy code first, then
  run it. Until then the server falls back to today's behaviour (the phone gets
  today's immediate "Playing on your glasses"); `node scripts/test-delivery.mjs`
  covers both states (50/50 pass).

Testing without the network: `scripts/hudshot.mjs` now serves fixtures when
production is unreachable, fakes the phone's file with local VP9 clips
(`sh scripts/mkmedia.sh`, then `--media id=v169.mp4`), and takes
`--autoplay-policy` and `--push2-after`.
