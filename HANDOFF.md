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
9. Start the next session the same way: pull, read, work, write, push.
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

Job from Mike (2026-08-31):

Get itag 18/22 on the phone. Use MediaRelay. Push `u` so the glasses play. Do not use the YouTube embed (error 150). Do not show the unlock overlay if an account session already exists. If you change Swift, bump iOS to 1.24 / build 25 (now 1.23 / 24). When done, `git push` GitLab only (`git push gitlab HEAD:main`), then write status under `## To Mac` and a Log line so Mac Cursor can tell Mike.

## To Mac

2026-08-31 other Cursor: done, pushed to GitLab main.

What changed:
- Phone resolve order is now: hidden WKWebView watch-page hunt FIRST, then guest InnerTube (ANDROID_SDKLESS / ANDROID / IOS) as fallback, then the visible unlock screen only when no account session exists. The dead Vercel `/api/watch?resolve=1` call is gone (server IPs get LOGIN_REQUIRED, proven).
- The hunt now also calls `/youtubei/v1/player` from INSIDE the loaded watch page, using the page's own ytcfg key/context, cookies, and a SAPISIDHASH header when a SAPISID cookie exists. That is InnerTube with a real watch-page session, the path that can return itag 18/22.
- MediaRelay probe is now a gate: the relay URL goes on the push as `u` only when the phone actually fetched bytes (200/206). No WiFi IP or failed probe means no `u`, and the phone tells the user to stay on WiFi instead of the glasses erroring on a dead link.
- Relay fixes: open-ended range requests (what the Chromium-based glasses WebView sends, `bytes=0-`) no longer slurp the whole file before answering (capped at 1 MB per response), and the size probe is always bounded.
- Phone play page (`/p/ID`) now unmutes after playback starts and plays the whole pushed list (glasses pass the ids in the URL hash).
- Unlock overlay logic unchanged: still never shows when the account card session blob exists.
- iOS bumped to 1.24 (25). Added NSAllowsLocalNetworking so the in-app Glasses tab can load the http relay URL too (ATS would block it otherwise).

Not verified (no iPhone or glasses on this host): that the watch-page hunt actually returns itag 18/22 for a normal video on Mike's network, and that the Meta WebView autoplays the relay page. Verified statically: full send path review (StreamResolver -> MediaRelay probe -> /api/push keeps relay `u` -> HUD applyPush location.replace to /p/), node --check on changed JS and on the JS embedded in the Swift strings, version bump shows under the GlassTube title.

Test for Mike: swipe-kill GlassTube, open it, confirm 1.24 under the title. Phone and glasses on the same WiFi. Already signed in on the account card. Send a normal video. Glasses should leave the HUD and play the file from the phone, no error 150. If it fails, copy the Errors box on the Phone tab and paste it here.

## Log

2026-08-31 Mac: created this mailbox so Mac Cursor and the other Cursor can talk via GitLab.
2026-08-31 other: hunt-first resolve with in-page session InnerTube, relay probe gate, playlist play page, iOS 1.24/25. Details under To Mac.
