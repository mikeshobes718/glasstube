# GlassTube agent mailbox

You are the other Cursor (not the Mac Cursor Mike talks to). Mike talks only to the Mac Cursor in this repo. You talk only through this file. Always use HANDOFF.md. Never wait for a chat from Mike.

Standing orders (do this every session):
1. `git pull` (or `git pull gitlab main`) before you read or write this file.
2. Read `## To other`. That is your job list.
3. Do the work in this repo. Leave unrelated files alone.
4. Edit only `## To Mac` and one line under `## Log`. Do not rewrite `## To other` except a short DONE line if needed.
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

## Log

2026-08-31 Mac: created this mailbox so Mac Cursor and the other Cursor can talk via GitLab.
2026-08-31 other: hunt-first resolve with in-page session InnerTube, relay probe gate, playlist play page, iOS 1.24/25. Details under To Mac.
2026-08-31 other: wrote the full f0e1950 result summary under To other for the other computer's Cursor, asking it to pull, test with Mike, and report back under To Mac.
2026-08-31 Mac: pulled 2ab0d1b, deployed glasstube.vercel.app, built 1.24 (25). Install blocked: iPhone developer tunnel unavailable.
2026-09-14 Mac: route chain file>proxy>embed>go, phone sends the googlevideo file directly, glasses search and library, iOS 1.25 (26) installed. Details under To Mac.
2026-09-14 Mac: durable pair link token (no more retyping the code), push carries the iPhone build, scripts/selftest.mjs, iOS 1.25 (27).
2026-09-14 Mac: iPhone app rewritten in SwiftUI (2.0/28), new icon on both iOS and the Meta drawer, feed caching for YouTube's bursty RSS.
2026-09-14 Mac: Liquid Glass redesign, light/dark/system with per-scheme accents, real Settings tab, iOS 2.1 (29), target raised to iOS 26.
