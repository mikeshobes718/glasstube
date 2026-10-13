# GlassTube glasses HUD: plan to make it as good as possible on Meta Ray-Ban Display

Produced 2026-10-13 by a research agent and five auditors (visual, navigation, player, reliability, performance) working from real screenshots of the HUD, then merged by a design lead. Full data, including every finding with evidence: `docs/hud-plan/audit.json`. Screenshot harness: `scripts/hudshot.mjs`.

## Vision

On the lens, GlassTube should feel like a quiet black window. Black is see-through on this display, so the world shows through everywhere except the few things that matter. Home is six large words, and a bright white ring marks the one a pinch will open. One status word says whether the iPhone is linked. Lists show about four big rows. Thumbnails stay dim until their row is focused, so the light the eye sees follows the user's attention. A playing video sits centred in the sharpest part of the lens, and nothing else is lit. Any swipe brings back a title band above and a thick progress line below for three seconds, then they fade. A bump on the band never skips or quits a video. Skipping takes Down and then a pinch on Next. Leaving takes two left swipes or the system Back gesture. Sending from the iPhone is a closed loop. The glasses show 'From your iPhone · <title>' and start playing with sound, because one swipe earlier in the session unlocks audio for the life of the page. The phone says 'Playing on your glasses' only after the glasses confirm it. Otherwise it says exactly what happened: not listening, waiting for a pinch, or could not play. A push that arrived while the glasses were away waits on Home as 'Missed from iPhone'. Search starts with dictation, offers suggestions after two letters, and keeps recent searches one swipe up. Every deploy reaches the glasses by itself the next time they sit idle on Home, and a version stamp shows briefly at launch so Mike can see it landed.

## Design system

CANVAS: fixed 600x600 #stage at DPR 1. Page background is #000, which shows as transparent on the lens. Font stack: 'Noto Sans', Roboto, system-ui, sans-serif. No web-font download. Every time or count uses font-variant-numeric: tabular-nums.

ZONES (y in px):
- 0-24: clear for the system bar.
- 24-88: header, 64px tall. 36x26 red play mark plus a 32px title on the left. Link chip on the right, plus a build chip that shows at launch.
- 88-552: content. One scroll owner, .screen-body.
- 500-548: toast lane, anchored to the bottom, above the footer.
- 556-580: footer hint, not focusable ('◀ Back').
- Side inset is 24px everywhere, so content runs x 24-576. Nothing focusable sits within 8px of any edge.
- Hero blocks (pair code, play gate, final error, 'Updated') are centred in the middle third, y 200-400.
- Player: top band y 24-120. Video 600x338 at y 131-469. HTML5 routes use a 600x600 box with object-fit: contain, so a 9:16 video gets 338x600. Bottom band y 480-576.

COLOUR TOKENS (on :root):
- --bg #000000
- --t1 #ffffff: titles, focused labels, focus ring.
- --t2 #cfd3d9: labels at rest and secondary text, about 80% brightness.
- --t3 #aaafb9: hints and disabled text only, never under 18px.
- --accent #ff3d3d: brand mark, the single Play-all fill, the Search key outline, the progress knob. Never text, never focus.
- --ok #4ff08f, --warn #ffc24a, --err #ff7a70: always paired with a glyph (✓ ! ✗) and a word, never colour alone.
- --hair rgba(255,255,255,.28): idle outlines of keys and chips.
- --track rgba(255,255,255,.22) and --buffer rgba(255,255,255,.45): progress bar.
- --surface #1c1e21: bounded backing for the player menu only. Never the only cue.

BANNED:
- Text darker than #aaafb9.
- Dark text on a light fill. On this display it reads as letters cut out of a bright slab.
- Any light fill larger than 48x48 other than video, thumbnails and the one red call to action.
- Black text-shadows and black scrims. They add no light, so they do nothing.
- The 14 hard-coded greys in today's styles.css (#212121, #272727, #303030, #3f3f3f, #8d8d8d, #c9c9c9 and so on).

COLOUR CONFLICTS RESOLVED:
- The accent stays YouTube red, not Meta blue #2694fe. Red is used only where its low brightness carries no meaning.
- Status colours are lighter than Meta's #26a756, #ff5668 and #c58600. They sit as text on pure black on an additive display, so they must give off enough light to read.

TYPE SCALE (size / line-height / weight, in px):
- Pair code: 64/72/800, letter-spacing 8.
- Screen title: 32/40/700.
- Player title: 28/34/700, clamped to 2 lines.
- Row label (home, settings, text rows, player menu): 28/36/600.
- Video title: 24/30/600, clamped to 2 lines with an ellipsis.
- Meta line and time: 22/28/500.
- Settings value: 24/30/700 in --t1.
- Toast: 24/30/600.
- Gate: 32/40/700.
- Keyboard keys: 28/600.
- Search field: 28/36/700.
- Chips: 22/600.
- Hint: 18/24/500. This is the smallest text anywhere.

Floor: 18px and weight 500. This resolves a conflict: the visual audit proposed a 16px floor, and Meta's toolkit uses an 18px floor with 22px metadata, 24px labels and 28px body. Meta's scale wins. It was set for exactly this 600px additive panel, and the audits' additive images show 14-16px secondary lines fading over bright scenes.

FOCUS (one style on every screen):
- .focusable{position:relative}
- .focusable::after{content:'';position:absolute;inset:0;border:3px solid #fff;border-radius:16px;opacity:0;transition:opacity 180ms cubic-bezier(.6,0,.4,1);pointer-events:none}
- .focusable:focus::after{opacity:1}
- The label goes from --t2 to --t1 on focus. Thumbnails go from opacity .55 to 1.
- No background fill, no red left bar, no animated box-shadow.
- Pinch feedback: .pressed{transform:scale(.97)} for 120ms.
- Keyboard cursor (.kb-on): the same ring plus transform: scale(1.06).

This resolves a conflict: the navigation audit proposed a red outline with an 8px left bar and dimming to .55, and the visual audit proposed a white ring. The white ring wins, because white is about 4x brighter than red on this panel. Dimming is kept only for thumbnails and resting labels.

ROWS AND TILES:
- Home row: 60px for a label only, 80px for a label plus a 22px status line. Radius 16, padding 0 20px, 4px gap, no separators. Six rows fit in y 88-552.
- Text list rows (Channels, Playlists, Library, Settings): 64px, or 84px with a second line.
- Settings value: right-aligned, 24/700 --t1, with ‹ › in --t3 when the row is focused.
- Video row: 112px. 160x90 thumbnail at radius 12, using mqdefault.jpg. 16px gap. Title 24/30 on two lines, meta 22 on one line. Four rows fit on a screen, matching Meta's ListItem guidance.
- Play all: the only filled button. 64px tall, radius 32, --accent background, 24/700 white text 'Play all · 20'. Focus ring offset 4px.
- Channel and playlist rows are plain text rows, not pills.
- Size conflict: Meta's ListItem is 88-120px tall. Video rows follow it at 112px. Text rows stay at 60-84px so Home fits on one screen without scrolling.

SEARCH SCREEN:
- Field: native <input type=search>, 52px tall, transparent, with a 2px --hair underline. Shows the end of the query, not the start. 2px white blinking caret.
- Chips row: 44px tall, radius 22, 1.5px --hair outline, 22px --t2 text.
- Grid: 10 columns of 52px keys (about 51.6px wide) with 4px gaps. Letters 28/600 --t2 inside 1.5px --hair outlines.
- Action row: Search | Delete | Clear | Back. The Search key has a 2px --accent outline and fills with --accent (white text) only while the cursor is on it.

PLAYER:
- The video is at full brightness while playing. It drops to opacity .35 under the gate, pause, menu or final error. Opacity is used, not filter, so the work stays on the compositor and the light really dims.
- Chrome bands fade in on load, on any key, on pause, on error, and when buffering lasts over 1s. They fade out 3s after playback resumes. With chrome hidden, only the video is lit.
- Bottom band: 6px bar (--track track, --buffer buffered, white fill drawn with transform: scaleX) with a 14px --accent knob. Time 22/600 on the left. 'Next: …' 22 --t2 on the right, with an ellipsis.
- Seek feedback: '+10s' at 28/800 inside the bottom band.
- Gate: a 64px ▶ glyph plus 'Pinch to play' at 32/700, inside a 3px white ring pill with no fill, centred at y 300.
- No text is ever drawn over the picture.

SPACING: use only 4, 8, 12, 16, 20, 24, 32, 40, 48 and 64px. 20px between stacked text lines, 32px between sections.

OVERFLOW:
- One scroll owner per screen.
- Keep the focused row centred: scrollIntoView with block 'center', scroll-padding 24px.
- 32px black-to-transparent gradient overlays at the top and bottom of the scroll area, shown only when content continues past that edge.
- An 'n/N' counter at 22px --t3 to the right of list titles.
- Cut long text at a word boundary with an ellipsis. Never shrink primary text below 24px.

MOTION:
- Animate transform and opacity only.
- Focus ring: 180ms on, 240ms off, cubic-bezier(.6,0,.4,1). This is faster than Meta's 475/625ms because swipes arrive under 140ms apart and the panel content updates at 30 Hz.
- Press 120ms, toast 250ms, chrome 300ms.
- The spinner is the only animation that loops forever, and only while it is visible. The caret blinks only while Search is visible.
- No per-frame JavaScript. UI timers tick at most once a second.

COPY: gesture words and glyphs only, such as 'Pinch to play' and 'Swipe left to go back' with ▲▼◀▶. Never 'Enter', 'Escape' or 'Backspace'.

## Work packages (in order)

### WP1: Lifecycle foundation: guarded polling, self-update, lifecycle handlers, stop pairing loss

**Goal.** Every later fix reaches the glasses on its own. Polling is single-flight, times out and adapts to what the wearer is doing. The two ways the HUD silently drops its pairing are closed.

**Files.** `/Users/mike/Documents/glasstube/scripts/stamp.mjs`, `/Users/mike/Documents/glasstube/api/_build.js`, `/Users/mike/Documents/glasstube/api/pair.js`, `/Users/mike/Documents/glasstube/app.js`, `/Users/mike/Documents/glasstube/index.html`, `/Users/mike/Documents/glasstube/styles.css`, `/Users/mike/Documents/glasstube/package.json`

**Changes.**

Make all changes in app.js unless another file is named.

1. Build stamp, new file scripts/stamp.mjs:
- Compute an 8-hex sha256 for each of app.js, player.js, styles.css, prefs.js and sound.js. Rewrite every ?v= on the matching <script src> and <link href> in index.html to that file's hash.
- Compute GLASSTUBE_BUILD as an 8-hex sha256 over all per-file hashes, embed.html, and index.html with the build value and ?v= values blanked. Write it into index.html (window.GLASSTUBE_BUILD = '<hash>') and into a new api/_build.js (export const BUILD = '<hash>';). The underscore keeps api/_build.js from counting as a function, so the total stays at 12.
- The script must be idempotent.
- package.json scripts: "stamp": "node scripts/stamp.mjs" and "deploy": "node scripts/stamp.mjs && vercel --prod".

2. api/pair.js:
- Import BUILD and add build: BUILD to every GET response, including { ok: false } responses.
- noteAgent: log req.query.b, i and who. Rate-limit the log per key with a Map from key to last-logged time, not one global timer.

3. Poll loop:
- Replace setInterval(pollPair, PAIR_POLL_MS) with a setTimeout chain: schedulePoll(ms), pollNow() and a pollBusy flag, so only one request is ever in flight. Wrap each fetch in an AbortController with an 8s timeout.
- Cadence pollDelay():
  - document.hidden: 15000ms. Hidden still polls, because whether the glasses report hidden truthfully is unverified.
  - current === 'phone', or Date.now() - lastActiveAt < 180000: 2000ms.
  - Otherwise: 5000ms.
  - lastActiveAt updates at boot, on visible, on any keydown and when a push is applied.
- On a network or HTTP failure, back off 2s, 4s, 8s, then 15s.
- Poll URL: /api/pair?code=<key>&b=<GLASSTUBE_BUILD>&i=<instanceId>&who=<hud|preview>. instanceId is a random 6-character id per page load. who is 'preview' when hasNativeHook() or the user agent matches iPhone or iPad.
- Watchdog: setInterval every 10s. If no poll has started for 30s while visible, restart the chain.
- startPairPoll() guards on pairKey(), not pairCode. Today it never starts when only the link token exists.
- Reset pairLastSeq to -1 whenever pairKey() changes, inside linkStore() and pairCodeStore().
- Keep the destSeq !== pairLastSeq test, not >. Single-flight already prevents out-of-order responses, and > would block every push after a server-side seq reset. This resolves the perf audit's 'monotonic >' against the reliability audit's seq-reset concern.

4. 'Gone' guard:
- pollPair counts dead responses: { ok: false } with /expir|not active|not found|unknown/ or d.gone === true.
- Wipe the link and re-mint only after 3 dead responses at least 30s apart in total. Reset the count on any ok response.
- While strikes are counting, pair-help says 'Checking your link…'.

5. Self-update:
- On every successful poll: if d.build && d.build !== window.GLASSTUBE_BUILD, set updatePending = d.build and send hudNote('update-pending', { from, to }) once.
- maybeUpdate() runs after each poll and from a 5s idle check. It reloads only when all of these hold: updatePending is set; not hidden; current === 'home'; Date.now() - lastKeyAt >= 20000; no push applied in the last 60s; the URL's rv is not already updatePending; and localStorage 'glasstube.reloadedFor' is not { build: updatePending } from less than 10 minutes ago.
- Resume path, on visibilitychange to visible or on pageshow: if updatePending and current is not 'player' and no search text is typed, call show('home') and reload immediately. This is the 'I reopened the app' moment, before any input.
- reloadForUpdate():
  - Call progressSave().
  - Set sessionStorage 'glasstube.updatedFrom' = GLASSTUBE_BUILD.
  - Set localStorage 'glasstube.reloadedFor' = { build, at }.
  - Build u = new URL(location.href), call u.searchParams.set('rv', build), which keeps any ?pair=, then call location.replace(u).
- If a push arrives while an update is pending, play it on the current code. The reload waits for the next safe moment.
- After load: if sessionStorage has updatedFrom, show the toast 'Updated · v<build>' for 2.5s, send hudNote('updated', { from, to }), and clear the marker.

6. Lifecycle handlers:
- visibilitychange: when visible, set lastActiveAt, call pollNow() and run the resume path. When hidden, reschedule at the hidden cadence.
- pageshow (including persisted): same as visible.
- window 'focus' and 'online': pollNow().

7. Launch stamp:
- Add <span id=build-chip> to the home header with 'v<build>', 22px in --t3 (tokens arrive in WP2; use #aaafb9 until then). Fade it to opacity 0 at 3s.
- Splash: remove the dead .splash-icon code. Call hideSplash() 300ms after boot. Change the fade in styles.css .splash to 200ms.

8. Launch path:
- Delete the Player.preload() call (app.js:1874) so YouTube iframe_api never loads in the HUD.
- Remove <link rel=preload href=/icon-192.png> from index.html.

9. From iPhone stop-gap:
- In index.html, put #btn-phone-back first in the screen's DOM order so it gets default focus.
- Rename #btn-pair-new to 'Link a different phone' and require two pinches. The first pinch sets the label 'Pinch again to unlink your iPhone' and arms for 4000ms, then the label reverts. Only a second pinch inside that window runs today's unlink code, plus hudNote('unlink').

10. Diagnostics (debugLines):
- New first rows: Build, Server build, Update ('none', 'waiting for idle home' or 'reloaded from <x>'), Last poll ('3s ago · ok' or the error), Poll every (s), Instance.
- Add the row 'Old version? Middle-finger tap on the home screen, then Restart.'

11. Tooling, in the scratchpad and not the repo: in shot.mjs and audit/player/shotp.mjs, answer POST /api/diag like POST /api/watch (print it as [hud-report], do not forward it). Audit runs then stop polluting production logs.

**Acceptance.**

Setup:
- H = cd /private/tmp/claude-501/-Users-mike/d0c887a3-23b0-4c19-8596-7e911651ee39/scratchpad/hudtools && node shot.mjs --root /Users/mike/Documents/glasstube --additive --out impl/wp1
- PATCHBUILD = eval:(window.__f=window.fetch,window.fetch=(u,o)=>String(u).indexOf('/api/pair?')>=0?window.__f(u,o).then(r=>r.json()).then(j=>new Response(JSON.stringify(Object.assign(j,{build:'zz000001'})))):window.__f(u,o),1)
- HIDE = eval:(Object.defineProperty(document,'hidden',{get:()=>true,configurable:true}),Object.defineProperty(document,'visibilityState',{get:()=>'hidden',configurable:true}),document.dispatchEvent(new Event('visibilitychange')),1)
- SHOW = eval:(delete document.hidden,delete document.visibilityState,document.dispatchEvent(new Event('visibilitychange')),1)

1. Code checks:
- node --check app.js passes.
- grep -c 'setInterval(pollPair' app.js returns 0.
- grep -cE 'visibilitychange|pageshow' app.js returns 2 or more.
- find api -name '*.js' ! -name '_*' | wc -l returns 12.

2. Stamp:
- Run node scripts/stamp.mjs twice. The second run produces no git diff.
- The GLASSTUBE_BUILD value in index.html equals BUILD in api/_build.js.
- Every ?v= in index.html is 8 hex characters.

3. Launch: H --name launch --steps "wait:700;shot:t07;wait:3600;shot:t43;eval:getComputedStyle(document.querySelector('#build-chip')).opacity"
- In t07 the splash is gone and the 'v<hash>' chip is visible.
- The eval returns '0'.

4. Idle reload, once only: H --name upd --steps "wait:2500;eval:window.__mark=1;PATCHBUILD;wait:28000;eval:[location.search,typeof window.__mark];PATCHBUILD;eval:window.__mark2=1;wait:28000;eval:[location.search,typeof window.__mark2]"
- The first eval returns ['?rv=zz000001','undefined'].
- The output shows exactly one [hud-report] line with ev update-pending and one with ev updated.
- The second eval returns ['?rv=zz000001','number'], so there was no second reload.

5. Never reloads mid-video: H --name updp --push 8WSyoITbP-c --push-after 3000 --steps "wait:2000;PATCHBUILD;eval:window.__mark=1;wait:30000;eval:[current,typeof window.__mark]"
- Returns ['player','number'].

6. Resume reload: H --name resume --steps "wait:2500;PATCHBUILD;wait:3000;eval:window.__mark=1;HIDE;wait:1000;SHOW;wait:2500;eval:[location.search,typeof window.__mark]"
- Returns ['?rv=zz000001','undefined'], with no 20s idle wait.

7. Cadence: H --name cad --steps "wait:2500;eval:(window.__n=0,window.__g=window.fetch,window.fetch=(u,o)=>(String(u).indexOf('/api/pair?')>=0&&window.__n++,window.__g(u,o)),lastActiveAt=0,1);wait:20000;eval:window.__n;key:ArrowDown;eval:window.__n=0;wait:10000;eval:window.__n;HIDE;eval:window.__n=0;wait:31000;eval:window.__n;SHOW;eval:window.__n=0;wait:600;eval:window.__n"
- Expected, in order: 4±1, 5±1, at most 2, at least 1.

8. Single in-flight: H --name stall --steps "wait:2500;eval:(window.__c=0,window.__max=0,window.__h=window.fetch,window.fetch=(u,o)=>String(u).indexOf('/api/pair?')>=0?(window.__c++,window.__max=Math.max(window.__max,window.__c),new Promise((res,rej)=>o&&o.signal&&o.signal.addEventListener('abort',()=>(window.__c--,rej(new DOMException('t','AbortError')))))):window.__h(u,o),1);wait:30000;eval:[window.__max,window.__c]"
- __max is 1 and __c is at most 1.

9. Gone guard: H --name gone --steps "wait:2500;eval:(window.__m=0,window.__k=window.fetch,window.fetch=(u,o)=>String(u).indexOf('/api/pair?')>=0?Promise.resolve(new Response(JSON.stringify({ok:false,error:'That code expired. Open From iPhone on the glasses for a new one.'}))):(String(u)==='/api/pair'&&!(o&&o.body)&&window.__m++,window.__k(u,o)),1);wait:12000;eval:[window.__m,localStorage.getItem('glasstube.link')];wait:32000;eval:window.__m"
- The first eval returns [0,'local-test-token']. The second returns 1.

10. New-code safety: H --name pairsafe --paired --steps "wait:2500;key:ArrowDown;wait:400;key:Enter;wait:800;eval:document.activeElement.id;shot:phone;key:ArrowDown;wait:400;key:Enter;wait:300;eval:[document.querySelector('#btn-pair-new').textContent,localStorage.getItem('glasstube.link')];wait:4500;eval:document.querySelector('#btn-pair-new').textContent"
- Returns, in order: 'btn-phone-back'; ['Pinch again to unlink your iPhone','local-test-token']; 'Link a different phone'.

11. Diagnostics: H --name diag --steps "wait:2500;eval:(renderDebug(),show('debug'),1);wait:300;shot:diag"
- The Build, Server build, Last poll and Restart rows are visible.

12. After npm run deploy:
- The build in curl -s https://glasstube.vercel.app/ equals the value of curl -s 'https://glasstube.vercel.app/api/pair?code=ZZZZZZ' | jq -r .build.
- node scripts/selftest.mjs passes.
- On the glasses, Mike restarts once. The chip then shows the new hash, and later deploys arrive after about 20s idle on Home without a Restart.

**Risk.** - Reload loop that drains the battery. Guards: the URL rv marker, localStorage reloadedFor with a 10-minute window, and reloads only on idle Home or on resume, never in the player or with search text typed.
- A reload clears user activation, so after WP5 the next push could hit the gate until the first swipe. Mitigation: reload only at idle Home or resume, and never while a push is fresh.
- The new poll loop could stop polling altogether. Guards: the watchdog, and the cadence test in step 7.
- Unknown whether document.hidden is truthful on the glasses. Hidden backs off to 15s instead of stopping.
- stamp.mjs edits index.html: the idempotence check in step 2 guards it.
- A deploy without stamp leaves index.html and api/_build.js consistent with each other, so it is safe and simply does not trigger an update.
- The working tree has unrelated uncommitted changes in ios/* and api/_rpc.js. Stage only this package's files.
- One manual Restart on the glasses is unavoidable, because the build in memory has no updater.

**Findings addressed.** [reliability] No self-update, and the build stamp is frozen; [perf] No self-update: deployed HUD changes never reach a page kept alive for days; [perf] Pairing poll has no timeout, no in-flight guard and no ordering check; [reliability] Fixed 2s poll in every state, with no timeout or overlap guard; [perf] Pairing poll runs every 2s forever (cadence part); [reliability] Hidden or background HUD instances keep polling (cadence part); [reliability] Any 'expired / not found / unknown' error wipes the durable link (3-strike guard, seq reset on key change); [nav][reliability][visual] 'New code' has default focus on From iPhone and silently unpairs the phone; [visual] No build or freshness indicator on home; [perf] Launch loads YouTube iframe_api and an icon preload nothing uses; [perf] Splash holds a fixed 900ms plus a 600ms fade; [perf] Screenshot harness leaks fake glasses diagnostics into production logs; [reliability] Server logs can't show which device polls which pair (per-key log, b/i/who); [research] Self-update a stale HUD; handle the page lifecycle; teach the Restart path; show a build stamp at launch

### WP2: Additive design system: tokens, type scale, one focus language, every screen except the player

**Goal.** Every non-player screen is legible over a bright room. The item a pinch will open is obvious at a glance. No large bright fills and no letters cut out of light. The launcher gets a proper icon.

**Files.** `/Users/mike/Documents/glasstube/styles.css`, `/Users/mike/Documents/glasstube/index.html`, `/Users/mike/Documents/glasstube/app.js`, `/Users/mike/Documents/glasstube/vercel.json`, `/Users/mike/Documents/glasstube/.well-known/meta-wearables-manifest.json`, `/Users/mike/Documents/glasstube/icon-mono.png`

**Changes.**

1. styles.css foundation:
- Add the :root tokens from the design system. Set the body font stack to 'Noto Sans', Roboto, system-ui, sans-serif.
- Replace every hard-coded grey with a token.
- .screen padding: 24px 24px 20px. Header area 64px. .title 32/40/700.

2. Focus:
- Add the ::after ring rule from the design system.
- Delete the old .focusable:focus fill and red inset bar (styles.css:334-341).
- Delete the cascade overrides that cancel focus on video rows (.list-btn:has(.list-shot) background/color and its small colour, styles.css:716-729).
- .focusable:focus sets the label colour to --t1.
- .list-shot img: opacity .55, and 1 when the row is focused, with a 180ms opacity transition.
- Remove the #272727 separators and the #btn-continue #212121 card.

3. Rows:
- Delete the .list-btn:not(:has(img)) red-pill rules (styles.css:279-311). Add .list-btn.is-action as the only filled call to action.
- Text rows and video rows follow the design system: video row 112px with a 160x90 thumbnail.
- Remove .list-dur. .list-seen becomes a 5px --accent bar along the bottom of the thumbnail.
- Settings value right-aligned at 24/700 --t1.

4. app.js rendering:
- renderList gives each button item.cls. showVideoList adds cls 'is-action' to Play all, with label 'Play all · N' and no second line.
- videoItems: second line is 'Channel · 14:13 · 35% watched' (duration in, view counts out). Stop creating .list-dur.
- openChannels: drop the 'Latest videos' second line.
- Thumbnails: list rows use mqdefault.jpg. Map hqdefault, sddefault and maxresdefault to mqdefault in renderList, recentsAdd and playlistRemember.
- Load thumbnails lazily: rows carry data-src. Assign src for rows within 6 of focus, inside reveal() and on render.
- 'Searching…' shows the .load-spin spinner in the empty message.

5. Messages:
- Add <div id=toast class='toast hidden'> as a sibling of #status, plus showToast(text, kind, ms) in app.js. kind is 'ok', 'err' or 'info' and adds a leading glyph ✓, ! or ↓. The toast sits in the y 500-548 lane, 24/600, no fill, and auto-hides after 4s. show() never clears it.
- #status moves into the same lane at the same style.
- .errbar sits at top 88px, below the header, 22px --err with a '!' glyph. It never covers the title.

6. Search screen restyle, structure unchanged:
- .kb-key: transparent, 1.5px --hair border, 28/600 --t2, 52px tall, 4px gaps.
- .kb-key.kb-on: white ring plus scale(1.06), no white fill.
- .kb-go: 2px --accent outline. Filled --accent only when it is also .kb-on.
- .kb-text: transparent, 28/700, 2px --hair underline.
- Recent chips: 44px, 22px text.

7. Other screens:
- From iPhone: .pair-code 64/800 with letter-spacing 8. .pair-help and steps 24/32 --t2.
- Diagnostics rows 22px --t2, with ✓ or ✗ glyphs alongside the colour. #debug-log stays in the DOM for copying but moves off-screen (position:absolute; left:-9999px).
- Splash text at least 18px.

8. Copy outside the player: replace 'swipe left' and every 'Enter' with gesture words and glyphs ('◀ Back', 'Pinch to open'). Back rows stay focusable for now; WP3 removes them from the focus order.

9. Scrolling:
- Add .fade-top and .fade-bottom pseudo-overlays: 32px gradients from #000 to transparent over .screen-body edges. Toggle them in reveal() from scrollTop and scrollHeight.
- reveal() uses block:'center'.

10. index.html head:
- Delete the two preconnects and the fonts.googleapis.com stylesheet.
- Trim the icon links to favicon.png, icon-192.png and apple-touch-icon, plus the manifest.
- Add <meta name=application-name content=GlassTube>.
- Keep mrbd-web-app-capable.

11. Launcher icon:
- New /.well-known/meta-wearables-manifest.json: {"version":1,"name":"GlassTube","appearance":{"theme_color":"#FF0033","icon":{"src":"../icon-mono.png","type":"monochrome"}}}
- New /icon-mono.png: 192x192, transparent, a white rounded play mark designed for a 64x64 area. Generate it with Python PIL. Keep it under 2 MiB.
- vercel.json headers for the manifest: Content-Type 'application/json; charset=utf-8', Cache-Control 'public, max-age=300'.

**Acceptance.**

Setup:
- H = cd /private/tmp/claude-501/-Users-mike/d0c887a3-23b0-4c19-8596-7e911651ee39/scratchpad/hudtools && node shot.mjs --root /Users/mike/Documents/glasstube --additive --out impl/wp2
- MINFONT = eval:Math.min.apply(null,[].slice.call(document.querySelectorAll('#stage *')).filter(e=>e.offsetParent&&[].some.call(e.childNodes,n=>n.nodeType===3&&n.textContent.trim())).map(e=>parseFloat(getComputedStyle(e).fontSize)))
- WHITEFILL = eval:[].slice.call(document.querySelectorAll('#stage *')).filter(e=>e.offsetParent&&getComputedStyle(e).backgroundColor==='rgb(255, 255, 255)'&&e.offsetWidth>48).length
- OVERFLOW = eval:[].slice.call(document.querySelectorAll('#stage *')).filter(e=>e.offsetParent&&e.getBoundingClientRect().right>600.5).length

1. Home: H --name home --steps "wait:2500;shot:home;MINFONT;WHITEFILL;OVERFLOW;key:ArrowDown*3;wait:300;shot:home-f3;eval:getComputedStyle(document.activeElement,'::after').opacity"
- Expected, in order: at least 18, 0, 0, '1'.

2. Lists: H --name lists --steps "wait:2500;key:ArrowDown*3;wait:400;key:Enter;wait:800;shot:channels;MINFONT;WHITEFILL;key:Enter;wait:6000;key:ArrowDown*2;wait:400;shot:videos;eval:[].slice.call(document.querySelectorAll('.list-shot img')).map(i=>getComputedStyle(i).opacity).join(',');eval:document.querySelectorAll('.list-btn.is-action').length;MINFONT;OVERFLOW"
- Only the focused row's thumbnail has opacity '1'; the others are '0.55'.
- Exactly one .is-action.
- MINFONT at least 18. OVERFLOW 0.

3. Search: H --name search --steps "wait:2500;key:Enter;wait:600;key:m;key:k;key:b;shot:grid;MINFONT;WHITEFILL;eval:(typed='MKBHD',runSearch(),1);wait:6000;key:ArrowDown*3;wait:400;shot:results;MINFONT"
- WHITEFILL is 0 on the grid.

4. Settings, From iPhone, Diagnostics: H --name more --paired --steps "wait:2500;key:ArrowDown*5;wait:400;key:Enter;wait:600;shot:settings;MINFONT;key:ArrowLeft;wait:600;key:ArrowUp*4;wait:400;key:Enter;wait:1000;shot:phone;MINFONT;eval:(renderDebug(),show('debug'),1);wait:300;shot:diag;MINFONT"
- Each MINFONT is at least 18.

5. Error bar: H --name err --steps "wait:2500;eval:window.glasstubeReport('JS error: test');wait:300;shot:errbar"
- The bar sits below the header and the title stays readable.

6. Requests:
- eval:performance.getEntriesByType('resource').filter(r=>/fonts\.(googleapis|gstatic)|iframe_api/.test(r.name)).length returns 0 on Home.
- eval:performance.getEntriesByType('resource').length is under 15 before any list opens.

7. Look at the -additive PNGs: home-f3, channels, videos, results, grid, settings, phone.
- On each, you can point to the focused item within one glance.
- No letter shows as a see-through hole.
- The only red elements are the brand mark and Play all. The Channels list shows no red pills.
- Optional: audit/visual/tools/linear.py gives a linear-light check of dim greys.

8. Code checks:
- grep -c fonts.googleapis index.html returns 0.
- grep -c mrbd-web-app-capable index.html returns 1.
- python3 -c "import json,os;p='/Users/mike/Documents/glasstube/.well-known/meta-wearables-manifest.json';d=json.load(open(p));assert d['version']==1;print(os.path.getsize(p))" prints under 65536.

9. After deploy:
- curl -sI https://glasstube.vercel.app/.well-known/meta-wearables-manifest.json shows content-type application/json; charset=utf-8.
- curl -sI https://glasstube.vercel.app/icon-mono.png returns 200.
- node scripts/selftest.mjs passes.

**Risk.** - CSS cascade regressions could hide focus on some screen. Mitigation: the ::after opacity eval on every screen, and the additive review.
- Removing the web font changes text widths, so check that 2-line clamps and ellipses still fit.
- Gradient fade overlays must have pointer-events:none and must not catch focus.
- Selftest and later packages rely on these selectors: keep .kb-key, .kb-on, data-menu and the screen ids unchanged.
- Lazy thumbnail src must still load the rows near focus on first render.
- Vercel serves /.well-known; confirm with curl after deploy. If it is missing, add a vercel.json rewrite.
- No playback code is touched.

**Findings addressed.** [visual] Focus is invisible on every video row (CSS cascade cancels the focus style); [visual] Channels and Playlists show as a column of red call-to-action pills; [visual] The global focus style is too weak for additive optics; [visual] Dark-on-white elements turn inside out on the additive display; [visual] Type is too small and too light for a see-through HUD; [visual] Adopt one token-based visual system for additive optics; [visual] Thumbnails: small, all at full brightness; the duration badge is illegible and duplicated; [visual] Scrolling hard-clips rows at the edges and parks focus on the bottom edge (fades + centre); [visual] The error bar covers the header; the status toast is small and out of context; [visual] Settings, empty states and the Continue card have weak hierarchy (styling part); [visual][nav] On-screen copy uses keyboard words (non-player screens); [nav] Focus indicator is weak or ambiguous on the additive display; [perf] Google Fonts stylesheet is render-blocking and also blocks app.js; [perf] Launch loads seven icon links; [perf] Thumbnails: loading=lazy does nothing in a 600px list, and some paths use hqdefault; [research] Type scale, text colours, bounded surfaces and focus, insets, spacing, overflow fading, no external fonts, app manifest icon, application-name meta

### WP3: Neural Band input arbiter, navigation stack with history Back, focus restore, stable Home

**Goal.** One gesture always does one thing. Back always returns to exactly where the user was. The system middle-finger Back works where firmware supports it. Loads the user backed out of never take over the screen. Home stops shifting.

**Files.** `/Users/mike/Documents/glasstube/app.js`, `/Users/mike/Documents/glasstube/index.html`, `/Users/mike/Documents/glasstube/styles.css`, `/Users/mike/Documents/glasstube/scripts/selftest.mjs`

**Changes.**

All in app.js unless another file is named.

1. Input arbiter. Replace the bare keydown listener (app.js:1741) with one capture-phase arbiter.
- resolveKey(e): try e.key, then e.code, then keyCode 37-40 and 13, then Android keycodes 19-22, 23 and 66. Escape, Backspace, BrowserBack and GoBack map to 'back'. A single printable character maps to { char }. Anything else returns null and the event is ignored, never guessed.
- Constants in one INPUT object:
  - DUP_MS = 120: the same key within 120ms is one gesture. The harness spaces keys 140ms apart.
  - ENTER_LOCK_MS = 320: ignore Enter for 320ms after any arrow.
  - Ignore Enter whenever e.repeat is true.
- preventDefault() on every handled key. Record lastKeyAt and lastActiveAt.
- Count dropped duplicates and locked Enters for Diagnostics.
- Dispatch to the player, menu, search or default handler.

2. Navigation stack:
- navStack holds entries { name, render, focusKey, scrollTop }. Home is depth 0.
- At boot: history.replaceState({ gt: 1, d: 0 }, '').
- navTo(entry) saves the current focusKey (data-key on rows: video id, data-menu or channel id) and scrollTop. It then calls history.pushState({ gt: 1, d: depth }) while depth <= 4, otherwise replaceState, and renders.
- goBack(), used by ArrowLeft and back keys: if depth > 0 and history.state.d === depth, call history.back(). Otherwise pop internally and call replaceState.
- The popstate handler pops navStack down to e.state.d (0 when e.state is null), re-renders the top entry from cached data, and restores focus by focusKey, then index, then the first video row. It never calls pushState.
- Channel pages ('More channels') replace the current entry instead of pushing.
- Opening the player from a list is a navTo. Next, previous and retry inside the player are not.
- A phone push does navTo(the 'From iPhone' or playlist queue list), then navTo(player). Back then lands on the queue with the played row focused, replacing goBack's special case that sent 'From iPhone' straight to Home.
- reloadForUpdate (from WP1) now requires depth 0. On resume with depth > 0 and not in the player, call history.go(-depth) and reload on the resulting root popstate.

3. Ghost-load guard:
- navGen++ on every navTo, goBack and popstate.
- loadChannel, runSearch, openLibrary, openLibraryPlaylist and authFetch callers capture navGen and drop stale results. goBack clears feedWait.
- The picked row shows .is-loading (spinner plus 'Loading…') while its feed loads.

4. Lists:
- Default focus is the first video row. Play all stays above it.
- Right jumps 4 rows, clamped, no wrap.
- The list title shows an 'n/N' counter.
- Remove the focusable Back rows: #list-back, #btn-settings-back, #btn-debug-back, #btn-search-back and #btn-phone-back. Show a non-focusable footer '◀ Back' (18px --t3) instead.
- The From iPhone screen then has no default focus: activeElement is body, so a pinch does nothing. Down focuses 'Link a different phone', which still needs two pinches.
- Up/Down wrap goes from the last row to the first.
- Playlists open their contents list (Play all plus rows) instead of playing at once.
- Empty states get one focused action row: Recents gets 'Open Channels', Playlists gets 'Pair your iPhone', a Library error gets 'Try again'.

5. Queue:
- showVideoList no longer assigns queue. The onPick handlers set queue = that list, then openPlayer. Browsing a list never replaces what is playing.

6. Home, index.html plus renderHome:
- Fixed order: [Missed, added in WP4] [Continue] Search, From iPhone, Recents, Channels, Playlists, [Library], Settings.
- Remove the Queue row. Continue's second line carries the queue: '<list> · 3/14 · 12:34'.
- Move Diagnostics to the last row of Settings.
- Left on Home is a no-op: a 120ms .pressed pulse on the title, no focus wrap.
- Right on Home acts like Down.

7. Settings: Right and pinch both cycle the value. Left goes back.

8. Diagnostics 'Input test' row: records the next 20 key events with key, code, keyCode, repeat, gap since the previous event and keydown-to-keyup ms. Shows them and sends hudNote('input-test', ...).

9. scripts/selftest.mjs: space ArrowDown presses 200ms apart and wait 400ms before Enter, so it matches the new arbiter. Search-grid escape still targets the grid's Back action.

**Acceptance.**

Setup:
- H = cd /private/tmp/claude-501/-Users-mike/d0c887a3-23b0-4c19-8596-7e911651ee39/scratchpad/hudtools && node shot.mjs --root /Users/mike/Documents/glasstube --additive --out impl/wp3
- From this package on, every step string must put wait:400 between an arrow key and key:Enter. key:X*n is already spaced 140ms apart.

1. Focus restore: H --name restore --steps "wait:2500;key:ArrowDown*3;wait:400;key:Enter;wait:800;key:ArrowDown*2;wait:400;eval:document.activeElement.textContent;key:Enter;wait:6000;eval:[current,document.activeElement.classList.contains('is-action')];key:ArrowLeft;wait:800;eval:document.activeElement.textContent;key:ArrowLeft;wait:800;eval:[current,document.activeElement.dataset.menu,history.state&&history.state.d]"
- Returns, in order: 'Veritasium'; ['list',false]; 'Veritasium'; ['home','channels',0].

2. Back from the player: H --name pback --steps "wait:2500;key:ArrowDown*3;wait:400;key:Enter;wait:800;key:Enter;wait:6000;key:ArrowDown;wait:400;eval:(window.__t=document.activeElement.textContent,1);key:Enter;wait:4000;eval:[current,history.state.d];key:ArrowLeft;wait:800;eval:[current,document.activeElement.textContent===window.__t]"
- Returns ['player',3], then ['list',true].

3. System Back: H --name sysback --steps "wait:2500;key:ArrowDown*3;wait:400;key:Enter;wait:800;eval:history.back();wait:800;eval:[current,document.activeElement.dataset.menu]"
- Returns ['home','channels'].

4. Ghost load: H --name ghost --steps "wait:2500;key:ArrowDown*3;wait:400;key:Enter;wait:800;key:Enter;wait:200;key:ArrowLeft;wait:300;key:ArrowLeft;wait:8000;eval:current;shot:ghost"
- Returns 'home'.

5. Left on Home: H --name lefthome --steps "wait:2500;key:ArrowDown*2;wait:300;key:ArrowLeft*3;wait:300;eval:document.activeElement.dataset.menu"
- Returns 'recents'.

6. Arbiter: H --name arb --steps "wait:2500;eval:(document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true})),setTimeout(()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true})),50),1);wait:400;eval:document.activeElement.dataset.menu;key:ArrowUp;key:Enter;wait:600;eval:current;wait:400;key:Enter;wait:600;eval:current"
- Returns, in order: 'phone' (the duplicate was dropped); 'home' (the Enter 140ms after a swipe was ignored); 'search'.

7. Repeat, unknown and Android keys: H --name keys --steps "wait:2500;eval:document.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',repeat:true,bubbles:true,cancelable:true}));wait:300;eval:current;eval:document.dispatchEvent(new KeyboardEvent('keydown',{key:'Unidentified',bubbles:true,cancelable:true}));wait:300;eval:document.activeElement.dataset.menu;eval:(window.__e=new KeyboardEvent('keydown',{key:'Unidentified',bubbles:true,cancelable:true}),Object.defineProperty(window.__e,'keyCode',{get:()=>20}),document.dispatchEvent(window.__e),1);wait:300;eval:document.activeElement.dataset.menu"
- Returns, in order: 'home', 'search', 'phone'.

8. Browsing leaves the queue alone: H --name q --steps "wait:2500;key:ArrowDown*2;wait:400;key:Enter;wait:800;key:ArrowLeft;wait:600;eval:[queue.length,[].slice.call(document.querySelectorAll('#screen-home .focusable')).filter(e=>e.offsetParent).length,[].slice.call(document.querySelectorAll('#screen-home [data-menu]')).map(e=>e.dataset.menu).join(',')]"
- queue.length is 0. 6 rows are visible. Neither queue nor debug is in the menu list.

9. Paging and counter: in a channel's video list, key:ArrowRight moves focus 4 rows and the title counter reads 5/N. Screenshot it.

10. Input test: open Settings, then Diagnostics, then Input test, and press 5 keys. The screenshot lists 5 events with timings.

11. node --check app.js passes. After deploy, node scripts/selftest.mjs passes.

**Risk.** - Thresholds set too tight could swallow real pinches. They live in one INPUT constant, and the Input test measures the real band. Do not filter on isTrusted, or harness evals break.
- On firmware older than v125.1, pushState is harmless and ArrowLeft still works.
- popstate re-entry: never pushState inside the handler. Test 3 covers it.
- Rebuilt list DOM loses focus: restore by data-key with an index fallback.
- WP1's self-update must still reload only at depth 0.
- The search handler must keep typing and grid moves working until WP8.
- Do not change player key mappings here; WP7 owns them.

**Findings addressed.** [nav] Back never restores focus; from the player it lands on 'Play all'; [nav] Ghost navigation: channel feeds and searches you backed out of still take over the screen; [nav] Home order shifts under your thumb, and browsing a list overwrites the queue; [nav] Left on Home moves focus up and wraps to Diagnostics; [nav] Long lists: focus pinned to the bottom edge, no position count, Right wasted, Back is a dead stop; [nav] Long-press and double-pinch are unmeasured; add an input-capture test; [visual] Wasted space and low density on home, lists and search (Back rows, Diagnostics into Settings); [visual] Settings, empty states and the Continue card have weak hierarchy (empty-state actions, Continue carries the queue); [research] Use browser history for Back; one input arbiter; resolve keys without guessing; ignore Enter repeat; Enter lockout after swipes; keep preventDefault

### WP4: Pairing that survives, and pushes the wearer can see on the glasses

**Goal.** The glasses never quietly drift to a different pairing. The wearer always sees that a push arrived. Pushes that landed while away become a pinchable 'Missed' row instead of vanishing. Home and From iPhone tell the truth about the link.

**Files.** `/Users/mike/Documents/glasstube/app.js`, `/Users/mike/Documents/glasstube/index.html`, `/Users/mike/Documents/glasstube/styles.css`, `/Users/mike/Documents/glasstube/api/pair.js`

**Changes.**

1. Durable pairing (app.js):
- Write the key everywhere: localStorage (existing keys) plus a cookie glasstube_pair=<link||code>; Max-Age=31536000; Path=/; SameSite=Lax. Add Secure only when location.protocol is https:.
- Read order: URL ?pair= (validated against /^[A-Z0-9]{6}$|^[a-f0-9]{64}$/i), then localStorage, then the cookie.
- If the wearer unlinks while the launch URL carries ?pair=X, store ignoreUrlPair=X (localStorage plus cookie) so the old code cannot come back on the next launch. Diagnostics then says 'Launcher link still has the old code'.

2. Keepalive touch: send the HUD touch only when the last poll said d.paired === true, at most once every 6h (localStorage lastTouchAt). It can then never mark a fresh code as claimed.

3. Push handling in pollPair, for each new destSeq after the ack:
- Special kinds: handled as today, plus showToast('Channels updated from your iPhone').
- Stale: dest.stale === true, or, only when there is no stale field, dest.ts older than 10 minutes by the HUD's own clock (legacy fallback).
  - Call missedAdd(dest): localStorage glasstube.missed keeps 3 entries for 24h.
  - Render a focusable top Home row 'Missed from iPhone'. Label is the title; second line is 'Sent 14 min ago · pinch to play', using dest.ageS when present.
  - Focus that row if the wearer is idle on Home. A pinch plays it.
  - Send hudNote('push', { stale: true }).
- document.hidden: hold it as pendingPush, send hudNote('push', { held: true }), and apply it on the next visible event or the first keydown.
- Otherwise: call applyPush and showToast('From your iPhone · ' + title, 'info', 3000). The toast lives in #toast, so route retries do not clear it. Set the load-gate text to 'From your iPhone · starting…'.
- Save lastPushInfo { title, at, outcome } with outcome 'played', 'missed' or 'couldn't play', and update it from updateChrome and skipUnplayable.

4. api/pair.js judgeFresh: for stale pushes set out.dest.stale = true and out.dest.ageS. Keep ts for HUDs still running older builds. Export judgeFresh so it can be unit-tested. This is a one-line, server-only change.

5. From iPhone screen (index.html plus app.js openPhone and pollPair):
- Linked (pairLink present and the last poll said paired):
  - Headline '✓ Linked to your iPhone' at 32/700, with the glyph in --ok.
  - 'Last from iPhone: <title> · 3 min ago · played' at 22 --t2.
  - 'Code ABC123' at 22 --t3.
  - Hide the 3 setup steps.
  - 'Link a different phone' is the last row.
- Not linked: the 64px code, the 3 steps at 24px, and 'Waiting for your iPhone…'.
- Footer: 'Old version? Middle-finger tap on Home, then Restart.'

6. Home status:
- Add #link-chip to the header: '● Linked' (dot in --ok), '○ Not linked' (--t3), or '! Offline' (--err).
- The From iPhone row's second line is one of 'iPhone linked · last video 2 min ago', 'iPhone linked', 'Code ABC123 · waiting for iPhone', or 'Can't reach GlassTube · retrying'.

7. Offline handling (setOffline and pollPair):
- Declare offline only after 2 failures in a row.
- Text is 'No internet' when navigator.onLine === false, otherwise 'Can't reach GlassTube · retrying'.
- setOffline(false) clears that text even while nowPlaying.
- In the player, show it as a toast, never the full-width bar.

**Acceptance.**

Setup:
- H = cd /private/tmp/claude-501/-Users-mike/d0c887a3-23b0-4c19-8596-7e911651ee39/scratchpad/hudtools && node shot.mjs --root /Users/mike/Documents/glasstube --additive --out impl/wp4
- HIDE and SHOW as in WP1.

1. Receipt toast: H --name rcpt --push 8WSyoITbP-c --push-after 3000 --steps "wait:2500;eval:(window.__toasts=[],new MutationObserver(()=>window.__toasts.push(document.querySelector('#toast').textContent)).observe(document.querySelector('#toast'),{childList:true,subtree:true,characterData:true}),1);wait:4500;shot:toast;eval:window.__toasts.join(' | ')"
- The joined text contains 'From your iPhone · '. The toast is visible in toast-additive.png.

2. Missed row: H --name missed --push 8WSyoITbP-c --push-after 4000 --steps "wait:1500;eval:(window.__now=Date.now.bind(Date),Date.now=()=>window.__now()+1200000,1);wait:6000;eval:[current,document.activeElement.textContent];shot:missed;key:Enter;wait:3000;eval:current"
- Returns ['home', text containing 'Missed from iPhone'], then 'player'.

3. Hidden push held: H --name held --push 8WSyoITbP-c --push-after 4000 --steps "wait:2000;HIDE;wait:20000;eval:current;SHOW;wait:1500;eval:current"
- Returns 'home', then 'player'.

4. Linked view: H --name linked --paired --steps "wait:2500;key:ArrowDown;wait:400;key:Enter;wait:1000;shot:linked;eval:[document.activeElement===document.body,getComputedStyle(document.querySelector('#pair-steps')).display];key:ArrowDown;wait:400;key:Enter;wait:300;eval:[document.querySelector('#btn-pair-new').textContent,localStorage.getItem('glasstube.link')];wait:4500;eval:document.querySelector('#btn-pair-new').textContent"
- Returns, in order: [true,'none']; ['Pinch again to unlink your iPhone','local-test-token']; 'Link a different phone'.
- The same run without --paired shows the 64px code and the steps.

5. Durable pairing: H --name durable --steps "goto:/?pair=ABC123;wait:2500;eval:document.cookie;goto:/;wait:300;eval:localStorage.clear();reload;wait:300;eval:pairKey()"
- The cookie contains 'glasstube_pair='. pairKey() is not empty straight after the reload, before any mint.

6. No false claiming: H --name touch --steps "wait:2500;eval:(window.__t=0,window.__p=window.fetch,window.fetch=(u,o)=>(String(u)==='/api/pair'&&o&&String(o.body||'').indexOf('touch')>=0&&window.__t++,window.__p(u,o)),1);wait:40000;eval:window.__t"
- Returns 0 without --paired, and at most 1 with --paired.

7. Offline: H --name off --push 8WSyoITbP-c --push-after 3000 --steps "wait:6000;eval:(window.__x=window.fetch,window.__fail=1,window.fetch=(u,o)=>window.__fail&&String(u).indexOf('/api/pair?')>=0?Promise.reject(new TypeError('Failed to fetch')):window.__x(u,o),1);wait:2500;eval:document.querySelector('#status').textContent;wait:8000;shot:offline;eval:window.__fail=0;wait:8000;eval:[document.querySelector('#status').textContent,document.querySelector('#toast').textContent]"
- After one failure, no offline text. After 2 or more, the offline text shows as a toast in the player. After recovery, both are empty.

8. Home chip: H --name chip --paired --steps "wait:3000;shot:home;eval:[document.querySelector('#link-chip').textContent,document.querySelector('[data-menu=phone] small').textContent]"
- Returns '● Linked' and 'iPhone linked…'. Without --paired: '○ Not linked' and 'Code TESTQA · waiting for iPhone'.

9. Server unit check: node -e "import('/Users/mike/Documents/glasstube/api/pair.js').then(m=>console.log(JSON.stringify(m.judgeFresh({dest:{id:'x',ts:Date.now()-1200000}}).dest)))"
- Output includes "stale":true and ageS around 1200. A fresh ts loses its ts.

10. After deploy: node scripts/selftest.mjs passes.

**Risk.** - The cookie or URL could bring back an old pairing after an intentional unlink. The ignoreUrlPair guard covers it; writing all three stores on every change keeps them in step.
- Mis-flagging fresh pushes as stale would stop playback. The server's explicit stale flag wins, and the clock is only a fallback when the field is missing. Test 2 exercises it.
- A held hidden push might never play if the WebView misreports hidden. The first keydown also releases it.
- Dropping the frequent touch could let a row expire. Rows live 365 days past activity and the 6h touch continues while paired.
- Phone and server copy must avoid the words 'expired' and 'not active'. iOS Store.reconnect unpairs on those.

**Findings addressed.** [reliability] The HUD's own keepalive touch marks the pair 'paired'; [reliability] Stale pushes are still consumed and dropped with nothing on screen; [reliability] Push receipt is almost invisible on the glasses; [reliability] Pairing state isn't readable; [reliability] One failed poll during playback leaves a red 'No internet. Retrying...' bar for good; [reliability] Hidden or background HUD instances can consume a push nobody sees (hold until visible); [visual] From iPhone: linked state is never shown (linked view and home chip); [research] Make pairing outlive storage wipes

### WP5: Playback engine: one unlocked <video>, honest gate, no route dropping, prefs honoured (isolated, riskiest)

**Goal.** Pushes and queued videos play with sound and no 'Pinch to play', once the wearer has made any gesture in the session. The gate appears only when the browser really refused. A waiting gate never makes the HUD abandon the working phone-file route. Speed, Sound, Audio only and Captions take effect.

**Files.** `/Users/mike/Documents/glasstube/player.js`, `/Users/mike/Documents/glasstube/app.js`, `/Users/mike/Documents/glasstube/index.html`, `/Users/mike/Documents/glasstube/styles.css`, `/Users/mike/Documents/glasstube/api/watch.js`

**Changes.**

1. player.js prefs:
- prefs() returns (typeof GlassPrefs !== 'undefined' ? GlassPrefs : null).
- soundOn() becomes !(typeof GlassSound !== 'undefined' && !GlassSound.enabled()).
- Today both read window.GlassPrefs and window.GlassSound, which are always undefined.

2. Persistent element:
- index.html: #yt-wrap gets <div id=yt-video-slot><video id=yt-video playsinline webkit-playsinline disablepictureinpicture preload=auto muted></video></div> next to #yt-slot, which keeps the iframes.
- player.js mountVideo reuses #yt-video. Attach its listeners once, at module init, against the current openId. It sets src and calls load(). Show it; hide #yt-slot.
- resetSoft: html5.pause(), removeAttribute('src'), load(). Keep the element and hide it.
- iframe routes (embed, go) mount only in #yt-slot, never touching the video.
- styles.css: #yt-video takes over the #yt-host video rules.

3. Unlock on first gesture:
- Add exported Player.unlock(). The WP3 arbiter calls it synchronously on the first resolved keydown of the page and again whenever the element is still locked.
- If the element has no src, set a tiny inline silent WebM data URI. Call muted=false and play().catch(()=>{}), then pause(). Set unlocked=true when play() resolves.

4. tryPlay reads the play() promise:
- On NotAllowedError, retry once muted.
- If muted playback runs: set mutedByPolicy=true and show the toast 'Sound off · pinch for sound'. The next pinch unmutes and does not pause.
- If muted playback also fails: set autoplayBlocked=true, show the gate at once, stop the retry timers and the route timers, and send hudNote('autoplay-blocked').
- Remove the unconditional applySound() from the 'playing' listener. Unmute only when unlocked, or when navigator.userActivation.isActive is true.

5. openPlayer timers (app.js):
- const openId = ++openSeq. Every setTimeout returns early unless openId === openSeq.
- Delete the 3.2s gate timer. The gate comes only from autoplayBlocked. Keep the check3s hudNote for diagnostics, adding readyState, buffered and playRejected.
- Stall rule for html5 routes: the route has failed when v.error is set, or networkState is NETWORK_NO_SOURCE, or no 'progress' and no growth in buffered for 10s. While buffered keeps growing, wait.
- Proxy route: also fail it if loadedmetadata has not fired within 6s. Then demote proxy for the rest of the session.
- Iframe routes: fail if there is no state for 20s after load, or 20s after a pinch on the gate.
- Never call tryNextWay while needGesture or autoplayBlocked is set.
- When the chain is exhausted: a single video shows the final error from bestFailText(failsForThisVideo). A queue skips to the next video. No endless 'Loading...'.
- bestFailText picks the most informative failure: file 403 or media error with a phone file means 'Your glasses aren't on the same WiFi as your phone'; an expired file means 'Send it again from your phone'; an outdated phone app says so. Expose it for testing.

6. Stable loading text:
- The file route shows 'Getting video from your phone…'. Fallbacks show 'Trying another way… (2 of 4)'.
- updateChrome no longer overwrites it with 'Loading...'.

7. Ticks and saves:
- Drive html5 chrome from media events: timeupdate, playing, pause, waiting, progress, error, ended.
- Keep a 1s interval only for iframe routes, and only while not paused.
- Replace holdFocus polling with a window 'blur' listener that refocuses the HUD's current control after 60ms, plus iframe tabindex=-1 and aria-hidden.
- progressSave at most every 10s while playing, plus on pause, ended, exit, visibilitychange hidden and pagehide.
- rememberRoute only when the route changes.

8. Keep phone files in memory:
- fileFor[id] = { u, exp }, with exp parsed from the expire= parameter, filled in applyPush.
- openContinue, Recents, the queue and the missed row reuse u while exp is more than 10 minutes away. Never persist it.

9. Dead code and prefetch:
- Remove prefetchNext (it costs about 65s of server time per call) and its call.
- Remove ensureApi and preload from player.js. Leave the yt branches alone.

10. api/watch.js:
- Wrap resolve() in an 8s overall timeout.
- Cache negative results per id for 10 minutes in a module-level Map. Repeat failures answer in under 1s.
- Keep the go=1 redirect and the probe=1 behaviour.

**Acceptance.**

Setup: P = cd /private/tmp/claude-501/-Users-mike/d0c887a3-23b0-4c19-8596-7e911651ee39/scratchpad/hudtools && node audit/player/shotp.mjs --root /Users/mike/Documents/glasstube --additive --out impl/wp5

Before starting: run node /Users/mike/Documents/glasstube/scripts/selftest.mjs and save the baseline output.

1. Unlock carries across the queue: P --name unlock --autoplay-policy user-gesture-required --push 8WSyoITbP-c,dQw4w9WgXcQ --media "8WSyoITbP-c=audit/player/media/v169.mp4,dQw4w9WgXcQ=audit/player/media/vbright.mp4" --push-after 5000 --steps "wait:2500;key:ArrowDown;wait:6000;shot:first;eval:(window.__v=document.querySelector('#yt-video'),[window.__v.currentTime>1,window.__v.muted,Player.lastRoute(),document.querySelector('#play-gate').classList.contains('hidden')]);wait:42000;shot:second;eval:[queueIndex,document.querySelector('#yt-video')===window.__v,window.__v.currentTime>1,window.__v.muted,document.querySelector('#play-gate').classList.contains('hidden')]"
- First eval: [true,false,'file',true].
- Second eval: [1,true,true,false,true]. The second video autoplayed with sound after the first ended naturally.
- Use key presses only before these measurements; Playwright evals count as user gestures.

2. Never unlocked: P --name gate --autoplay-policy user-gesture-required --push 8WSyoITbP-c --media "8WSyoITbP-c=audit/player/media/v169.mp4" --push-after 3000 --steps "wait:6000;shot:gate;eval:[!document.querySelector('#play-gate').classList.contains('hidden'),Player.lastRoute()];wait:20000;eval:Player.lastRoute();key:Enter;wait:2500;eval:[document.querySelector('#yt-video').currentTime>0.5,document.querySelector('#yt-video').muted]"
- Returns [true,'file'], then 'file', then [true,false].
- No [hud-report] line has ev stalled. One line has ev autoplay-blocked.

3. Muted fallback: P --name muted --autoplay-policy document-user-activation-required --push 8WSyoITbP-c --media "8WSyoITbP-c=audit/player/media/v169.mp4" --push-after 3000 --steps "wait:6000;shot:mutedchip;eval:[document.querySelector('#yt-video').muted,document.querySelector('#toast').textContent];key:Enter;wait:1500;eval:[document.querySelector('#yt-video').muted,document.querySelector('#yt-video').paused]"
- Returns [true,'Sound off · pinch for sound'], then [false,false].

4. Prefs honoured: P --name prefs --push 8WSyoITbP-c --media "8WSyoITbP-c=audit/player/media/v169.mp4" --push-after 3000 --steps "wait:1000;eval:(GlassPrefs.setSpeed(1.5),GlassPrefs.setAudioOnly(true),GlassSound.setEnabled(false),1);wait:9000;eval:(v=document.querySelector('#yt-video'),[v.playbackRate,v.muted,document.querySelector('#yt-wrap').classList.contains('audio-only')])"
- Returns [1.5,true,true].

5. Re-push of the same video: P --name repush --push 8WSyoITbP-c --media "8WSyoITbP-c=audit/player/media/v169.mp4" --push-after 3000 --push2-after 9000 --steps "wait:20000;eval:Player.lastRoute()"
- Returns 'file'. No ev stalled in [hud-report].

6. Refused file: P --name f403 --push 8WSyoITbP-c --media "8WSyoITbP-c=403" --push-after 3000 --steps "wait:7000;eval:wayPos;eval:document.querySelector('#load-gate-msg').textContent;wait:25000;shot:after"
- wayPos is at least 1 within 7s.
- The loading text matches /Trying another way/.
- At 25s the screen is either playing on a fallback or showing a final error. It is never 'Loading...'.
- eval:bestFailText(['8WSyoITbP-c · file · code 5 · Media error 4 on file']) mentions WiFi.

7. Storage writes: P --name ls --push 8WSyoITbP-c --media "8WSyoITbP-c=audit/player/media/v169.mp4" --push-after 3000 --steps "wait:6000;eval:(window.__w=0,window.__si=Storage.prototype.setItem,Storage.prototype.setItem=function(k,v){window.__w++,window.__si.call(this,k,v)},1);wait:20000;eval:window.__w"
- Returns 6 or fewer.

8. Code checks: grep -c 'iframe_api' player.js returns 0; grep -c prefetchNext app.js returns 0; node --check player.js app.js passes.

9. After deploy:
- node scripts/selftest.mjs passes, including 'plays the phone file route'.
- time curl -s 'https://glasstube.vercel.app/api/watch?probe=1&v=8WSyoITbP-c' finishes in 9s or less.
- On the glasses: swipe once on Home, push from the phone, and it plays with sound and no pinch.

**Risk.** This is the play path, the riskiest package.
- Keep the route order file, then proxy, then embed, then go, with file first whenever u exists. Keep Player.routes() unchanged; selftest asserts it.
- Run selftest before and after.
- The unlock trick is verified in headless Chrome only. Android WebView may differ. The checks in step 2 and the gate fallback keep today's worst case, a pinch, as the floor.
- A persistent element could leak state between videos. Reset playbackRate, muted, poster and currentTime on each load, and test that the same element plays two videos (step 1).
- Iframe routes must not be affected by the video container. Embed is a real fallback on the glasses.
- Keep WP4's push toast and lastPushInfo hooks, and the WP3 arbiter's call into Player.unlock.
- watch.js runs in production. Keep the probe output shape that Diagnostics and selftest read.

**Findings addressed.** [player] Every push and every queued video stops at 'Enter to play': a new <video> per video, plus unmuting right after muted autoplay; [player] The stall timer drops the working phone-file route while 'Enter to play' waits; ends at an endless 'Loading...'; [player][perf] Speed, Sound Off, Audio only and Captions are ignored (window.GlassPrefs/GlassSound); [perf] 'Enter to play' gate is chosen by a 3.2s timer, not by an autoplay rejection; [perf] Proxy route takes 61-65s to fail in production; prefetch wastes a minute of function time; [perf][player] 400ms player tick writes localStorage 3 times per tick / progress saved 2.5 times a second; [player] Left exits immediately, and a phone push can't be resumed on the file route (in-memory u part); [research] Autoplay: muted start, unmute on first pinch; iframe tabindex -1 and blur refocus

### WP6: Server-confirmed delivery: the phone says 'Playing' only when the glasses are playing

**Goal.** Close the loop with no iPhone release. The glasses report what happened to each push. The server records when the glasses last checked in. /api/push waits briefly for proof. The phone shows the existing green 'Playing on your glasses' only on a confirmed 'playing'. Otherwise it shows an exact sentence through its existing error banner.

**Files.** `/Users/mike/Documents/glasstube/api/pair.js`, `/Users/mike/Documents/glasstube/api/push.js`, `/Users/mike/Documents/glasstube/app.js`, `/Users/mike/Documents/glasstube/scripts/sql/2026-10-delivery.sql`

**Changes.**

1. Database migration, on whichever backend GLASSTUBE_SUPABASE_URL points at (ask Mike: Supabase or Berth). Read the current function bodies first, for example with pg_get_functiondef. Save the SQL in scripts/sql/2026-10-delivery.sql.
- glasstube_pairs gains these columns: hud_seen_at timestamptz, hud_build text, hud_who text, ack_seq int, ack_state text, ack_detail text, ack_at timestamptz, superseded_by text.
- New function glasstube_hud_poll(p_code, p_build, p_who): runs the existing glasstube_poll logic and sets hud_seen_at, hud_build and hud_who.
- New function glasstube_ack_state(p_code, p_seq, p_state, p_detail): records the state. For 'got' and 'missed' it also performs today's glasstube_ack consume.
- New function glasstube_delivery(p_code): returns hud_seen_s, hud_build, ack_seq, ack_state, ack_detail and dest_seq.
- New function glasstube_supersede(p_old, p_new_code).
- Use new function names, not new overloads. Old phone and HUD callers keep working unchanged.

2. api/pair.js:
- GET: call glasstube_hud_poll when who === 'hud', or when there is no who and the user agent matches /Greatwhite|Android/ (builds still running on the glasses from before WP1). Otherwise use glasstube_poll, so the phone's HUD preview never counts as glasses.
- POST { code, ack, state, detail }: call glasstube_ack_state. A legacy { code, ack } without state means 'got'.
- POST { replaces: <old token> } while minting: supersede the old row.
- Touch or push on a superseded row returns { ok: false, error: 'This link is not active any more. Your glasses were linked to a new code. Type the code shown on the glasses.' }. Today's iPhone app then unpairs itself in Store.reconnect.

3. api/push.js, for video pushes only (channels, channel and session stay immediate):
- After glasstube_push, read glasstube_delivery.
- If hud_seen_s is null or over 45: return { ok: false, error: 'Saved, but your glasses have not checked in for <N min>. Open GlassTube on the glasses and it will start.' } The push stays pending.
- If hud_build is null (a build from before WP6 on the glasses): return today's immediate { ok: true }.
- Otherwise poll glasstube_delivery every 400ms for up to 12s, until ack_seq equals this push's seq:
  - 'playing': { ok: true }. The phone shows 'Playing on your glasses', now true.
  - 'pinch': ok:false, 'It is on your glasses. Pinch to start it.'
  - 'failed': ok:false, 'Your glasses could not play it: <detail>'
  - 'hidden': ok:false, 'Your glasses got it. It starts when you look at GlassTube.'
  - Only 'got' at the timeout: ok:false, 'Your glasses got it and are still starting it.'
  - Nothing at the timeout: ok:false, 'Not picked up yet. Is GlassTube open on the glasses?'
- Always add delivery: { state, glassesSeenS, glassesBuild } for a future iPhone build.
- Never use the words 'expired' or 'not active' in these messages.

4. app.js deliveryReport(state, detail): posts { code, ack: pushSeq, state, detail, b } for the push currently being tracked.
- 'got': on receipt, replacing the plain ack.
- 'hidden': when the push is held (WP4).
- 'missed': stale (WP4).
- 'pinch': the first time the gate shows for the push's first video.
- 'playing': the first 'playing' event of that video.
- 'failed': the final error, with the bestFailText sentence.
- Stop after the first terminal state.
- When minting after an unlink, send replaces: oldToken.

5. Logging: [glasstube-poller] logs per key with who, b, i and visibility.

Do not raise MIN_PHONE_APP; the push payload shape does not change.

**Acceptance.**

1. Function count: find api -name '*.js' ! -name '_*' | wc -l returns 12.

2. HUD side: P = cd /private/tmp/claude-501/-Users-mike/d0c887a3-23b0-4c19-8596-7e911651ee39/scratchpad/hudtools && node audit/player/shotp.mjs --root /Users/mike/Documents/glasstube --out impl/wp6
- Recorder step: eval:(window.__acks=[],window.__a=window.fetch,window.fetch=(u,o)=>(String(u)==='/api/pair'&&o&&o.body&&window.__acks.push(JSON.parse(o.body).state),window.__a(u,o)),1)
- Playing: P --name dlv --autoplay-policy user-gesture-required --push 8WSyoITbP-c --media "8WSyoITbP-c=audit/player/media/v169.mp4" --push-after 4000 --steps "wait:1500;<recorder>;key:ArrowDown;wait:9000;eval:window.__acks.join(',')"
  - Returns 'got,playing'.
- Gate: the same run without key:ArrowDown returns 'got,pinch'.
- Stale: with the Date.now +20 min skew from WP4 test 2, returns 'missed'.

3. Server, on a Vercel preview: run vercel deploy without --prod and use the preview URL. The preview shares the database, so use only throwaway pairs. Write a probe script in impl/wp6/probe.mjs:
- (a) POST /api/pair to mint a pair and get a token.
- (b) Start a fake HUD loop: GET /api/pair?code=<token>&who=hud&b=testbuild every 2s with a Greatwhite user agent. When a dest arrives, POST state 'got', then 'playing' after 1s.
- (c) POST /api/push { code: token, url: 'https://youtu.be/8WSyoITbP-c' } returns ok:true within 6s.
- (d) Answer 'pinch' instead of 'playing'. The push returns ok:false with an error matching /Pinch to start/.
- (e) Stop the loop, wait 50s, push. It returns ok:false matching /have not checked in/, and a following GET still returns the dest.
- (f) A legacy loop with no who or b, using the Greatwhite user agent and a plain { code, ack }, gets ok:true immediately.
- (g) A channels push returns at once.
- (h) Mint with replaces: oldToken. Then POST { code: oldToken, touch: true } returns an error containing 'not active'.

4. After npm run deploy:
- node scripts/selftest.mjs passes.
- vercel logs show [glasstube-poller] lines with who and b.
- On the device: push from the iPhone. The phone's banner reads 'Playing on your glasses' only once video is visible on the lens. With GlassTube closed on the glasses, it shows 'Saved, but your glasses have not checked in…'.

**Risk.** - This runs a migration on the live pairing database, and which backend is live is unclear: an uncommitted api/_rpc.js switches to Berth. Confirm with Mike before running, and do not commit the _rpc.js change as part of this package.
- Existing phone and HUD callers must keep working: use new function names with default-free signatures, and keep the legacy paths in tests 3(f) and 3(g).
- push.js now waits up to 12s. The phone's request timeout is 20s, and production functions already run 60s or more, so confirm maxDuration covers it.
- The phone now shows a red banner for 'not confirmed yet'. That is honest, but ask Mike.
- The phone's HUD preview (iPhone user agent) must never set hud_seen_at.
- Superseding rows must only touch the old token the glasses themselves report.

**Findings addressed.** [reliability] The phone says 'Playing on your glasses' without confirmation, and the HUD acks a push before deciding to play it; [reliability] 'New code' orphans the phone (server side: superseded rows tell the phone); [reliability] Stale pushes (server-authoritative stale flag and ageS, phone told the truth); [reliability] Server logs can't show which device polls which pair (who/b/visibility per key); [research] Make delivery honest: ack on 'playing', report gate, lastSeen liveness

### WP7: Player screen and controls: centred video, auto-hiding chrome, swipe-proof gestures, player menu

**Goal.** While watching, only the video is lit, centred in the sharpest part of the lens. A swipe brings back large, readable controls for 3 seconds. No bump skips or quits a video. Speed, sound and next or previous are two gestures away without leaving the video. Errors and the end of a list say what to do in gesture words.

**Files.** `/Users/mike/Documents/glasstube/index.html`, `/Users/mike/Documents/glasstube/styles.css`, `/Users/mike/Documents/glasstube/app.js`, `/Users/mike/Documents/glasstube/player.js`, `/Users/mike/Documents/glasstube/prefs.js`, `/Users/mike/Documents/glasstube/README.md`

**Changes.**

1. Layout:
- #screen-player becomes the full 600x600 canvas.
- Video box: iframe routes 600x338 at top 131. HTML5 #yt-video 600x600 with object-fit: contain, so 16:9 is centred and 9:16 shows at 338x600.
- New #player-top band (y 24-120): title 28/34/700 on 2 lines; second line 22 --t2 'Channel · 2 of 5 · 1.5x · Sleep 12m'.
- New #player-bottom band (y 480-576):
  - #player-bar: 6px. Track --track, buffered --buffer, white fill drawn with transform: scaleX instead of width. 14px --accent knob.
  - Time at 22/600 on the left. 'Next: …' at 22 --t2 on the right, ellipsized with CSS (replaces slice(0,44)).
  - A 18px legend shown only on pause and in the first 3 sessions: 'pinch pause · ▶ +10s · ▲ −10s · ▼ menu · ◀◀ exit'.
- Remove the always-on .player-meta block and the 12px #player-time over the picture. #status is never shown in the player; toasts are used instead.

2. Chrome visibility (#player-chrome):
- Shows on load, on any key, on pause, on error, and when buffering lasts over 1s.
- Fades out (opacity 300ms) 3s after playing resumes.
- With chrome hidden, nothing but the video is lit.

3. Dimming: the video goes to opacity .35 under the gate, pause, menu and final error.

4. Gate: replace the white .play-gate-msg pill with a 64px ▶ glyph plus 'Pinch to play' at 32/700 inside a 3px white ring pill with no fill, centred at y 300. The title appears only in the top band. A pushed video adds a 22px line 'Sent from your iPhone'.

5. handlePlayerKey (swipe-proof):
- Pinch: play or pause. When mutedByPolicy, a pinch unmutes instead.
- Right: +10s.
- Up: −10s, in every queue.
- Repeats of the same direction within 1s accelerate to 30s, then 60s.
- Seek feedback: '+10s' or '+30s' at 28/800 in the bottom band, with the bar visible for 900ms.
- Down: open the player menu.
- Left, guarded: the first Left shows the chrome and the toast 'Swipe left again to leave'. A second Left within 2500ms calls goBack(), which uses history.back().
- popstate (system Back) exits immediately.

This resolves a conflict. The navigation audit wanted Down to open a menu; the player audit wanted Down to skip with a toast; the research says swipes may only seek or show controls. The menu wins, so skipping takes a deliberate pinch. Up is always rewind, not 'previous in the first 5s'. Left stays a guarded exit rather than a seek, because Mike's firmware may not deliver system Back yet.

6. Player menu (#player-menu):
- Over the dimmed video, --surface backing, rows 60px at 28/600.
- Items: Next video (default focus), Previous, Restart, Speed ‹1x›, Sound On/Off, Picture Video/Audio only, Sleep timer.
- Up and Down move. Pinch activates or cycles the value, applied live through Player.applyAll() without destroying playback. Right also cycles. Left closes. The menu closes by itself after 6s idle.
- playNext and playPrev pass resumeAt(id). Previous on the first video restarts it instead of wrapping.

7. Final error (blockedFor === nowPlaying.id):
- Replace the video area with a centred 28px message from bestFailText.
- Gesture actions: 'Pinch: play from phone' only when there is a relay, 'Swipe down: next video' only with a queue, 'Swipe left: back'.
- handlePlayerKey routes Enter to openRelay() and Down to the next video in that state, which makes #btn-relay reachable.

8. End of video and list:
- prefs.js: default repeat becomes 'off'. Pushed queues never wrap.
- On 'ended' with a next video: a 5s 'Up next: <title>' card in the bottom band with a countdown. Pinch plays now; Left cancels.
- At the end of a list: 'Finished · pinch to replay · swipe left to exit'. Hide the chrome after 10s.

9. Audio only: #yt-video-slot gets display:none. The poster becomes a small 160x90 thumbnail at opacity .35, bottom-left, so only 3-5% of the panel is lit. The bands remain.

10. Poster: use hqdefault.jpg with object-fit: cover; the old mqdefault looked blurry. Dim it like the video.

11. Leaving the player focuses the played row in the list and labels it 'Resume · 12:34'.

12. README.md: update the controls section to match.

**Acceptance.**

Setup:
- P = cd /private/tmp/claude-501/-Users-mike/d0c887a3-23b0-4c19-8596-7e911651ee39/scratchpad/hudtools && node audit/player/shotp.mjs --root /Users/mike/Documents/glasstube --additive --out impl/wp7
- M = --push 8WSyoITbP-c,dQw4w9WgXcQ --media "8WSyoITbP-c=audit/player/media/v169.mp4,dQw4w9WgXcQ=audit/player/media/vbright.mp4" --push-after 3000

1. Chrome auto-hide: P --name ui M --steps "wait:6000;shot:chrome;wait:5000;shot:clean;eval:[getComputedStyle(document.querySelector('#player-chrome')).opacity,Math.round(document.querySelector('#yt-video').getBoundingClientRect().top)]"
- chrome-additive.png shows a readable title and progress band, and nothing drawn over the picture.
- The eval returns ['0',0], because the 600x600 box is at top 0 and its 16:9 content is centred at y 131. clean-additive.png shows only the centred video.

2. Seek: P --name seek M --steps "wait:8000;eval:(window.__t0=document.querySelector('#yt-video').currentTime,1);key:ArrowRight;wait:600;shot:seek;eval:Math.round(document.querySelector('#yt-video').currentTime-window.__t0);wait:1500;key:ArrowUp;wait:600;eval:Math.round(document.querySelector('#yt-video').currentTime-window.__t0)"
- Returns about 10, then about 2. The seek shot shows '+10s' in the bottom band.

3. Menu: P --name menu M --steps "wait:8000;key:ArrowDown;wait:500;shot:menu;eval:document.activeElement.textContent;key:ArrowLeft;wait:400;eval:[current,document.querySelector('#yt-video').paused];key:ArrowDown;wait:500;key:Enter;wait:5000;eval:queueIndex"
- Returns, in order: text containing 'Next video'; ['player',false]; 1.

4. Guarded exit: P --name exit M --steps "wait:8000;key:ArrowLeft;wait:300;shot:leave1;eval:[current,document.querySelector('#toast').textContent];key:ArrowLeft;wait:900;eval:[current,document.querySelector('#list-title').textContent,document.activeElement.textContent]"
- Returns ['player','Swipe left again to leave'], then ['list', containing 'From iPhone', the played title with 'Resume'].

5. Gate: P --name gate --autoplay-policy user-gesture-required --push 8WSyoITbP-c --media "8WSyoITbP-c=audit/player/media/v169.mp4" --push-after 3000 --steps "wait:6500;shot:gate;eval:[getComputedStyle(document.querySelector('#yt-video')).opacity,parseFloat(getComputedStyle(document.querySelector('#play-gate-msg')).fontSize),getComputedStyle(document.querySelector('#play-gate-msg')).backgroundColor]"
- Returns ['0.35', 32 or more, 'rgba(0, 0, 0, 0)'].

6. Vertical video: P --name vert --push 8WSyoITbP-c --media "8WSyoITbP-c=audit/player/media/vshort.mp4" --push-after 3000 --steps "wait:7000;shot:vert"
- The picture fills the full 600px height, about 338px wide.

7. End of list: P --name end --push 8WSyoITbP-c --media "8WSyoITbP-c=audit/player/media/v169.mp4" --push-after 3000 --steps "wait:48000;shot:end;eval:document.querySelector('#play-gate').textContent"
- Contains 'Finished'. The queue did not loop.

8. Error actions: after a single push, eval:(skipUnplayable('Media error 4 on file',5),1). The screen shows a centred message plus 'Swipe left: back'. key:ArrowLeft leaves the player.

9. Live settings: in the menu, cycle Speed. eval:document.querySelector('#yt-video').playbackRate changes, and currentTime keeps advancing with no reload.

10. After deploy: node scripts/selftest.mjs passes.

**Risk.** - This changes muscle memory: Down no longer skips. The menu's default focus is Next, so a skip is Down then a pinch.
- The guarded Left might feel slow. System Back exits at once, and the second swipe window is 2.5s.
- Auto-hide must never hide an error, the gate or a paused state.
- The menu takes DOM focus inside the player. holdFocus and the blur refocus from WP5 must not steal it; they may only blur iframes.
- Moving the video box must not resize the embed and go iframes, which keep 600x338.
- Changing the repeat default only affects users who never saved preferences. Pushed queues stop wrapping explicitly.

**Findings addressed.** [player] Player layout: video pinned to the top, text that never hides, 12px time and 3px bar, status line that never clears; [player] Controls: Up means different things, no visual seek feedback, keyboard words; [player] Gate and pause overlay: a white pill over a blurry upscaled poster; [player] Error screen: unreachable 'Play from the phone' button, less useful error shown; [player] Vertical videos render at 190x338; [player] End of video and queue: no up-next, Repeat defaults to All, 'Ended' leaves the gate up; [player] Left exits immediately (guarded exit, return to the From iPhone list); [nav] Player swipes: Down skips instantly, Up changes meaning, next/prev throws away the resume point; [nav] Error recovery dead end: 'Play from the phone instead' can't be reached; [nav] No in-player controls; changing speed means leaving and rebuffering; [nav][visual] Gesture hints mix keyboard words with band words (player); [visual] Player: permanent text clutter below the video, 3px bar, 12px time; [perf] Audio only does not save power (display:none, small dim poster); [research] Make playback swipe-proof; one Back path; centre the main block

### WP8: Search: dictation first, reachable recents and suggestions, a grid that does not throw the query away

**Goal.** Searching costs a pinch and a sentence when the composer exists, or about 12-17 band inputs instead of 33-59 when it does not. Every visible search control is reachable with the band.

**Files.** `/Users/mike/Documents/glasstube/index.html`, `/Users/mike/Documents/glasstube/app.js`, `/Users/mike/Documents/glasstube/styles.css`, `/Users/mike/Documents/glasstube/api/feed.js`, `/Users/mike/Documents/glasstube/vercel.json`, `/Users/mike/Documents/glasstube/scripts/selftest.mjs`

**Changes.**

1. Native search field (index.html):
- Replace #kb-text with <input id=kb-input type=search enterkeyhint=search autocomplete=off placeholder='Pinch to speak or type'>, styled as the design system's 52px field.
- It is row -2 of the cursor model, reached with Up from the chips or the top grid row.
- When the cursor lands on it, give it DOM focus. A pinch then opens the system composer on firmware v127 or later.
- Read the text from 'input' and 'change' into typed, uppercased. Strip ' " _ [ ].
- Enter or 'change' with text runs runSearch(). Down from the input calls blur() and moves to the chips or the grid.
- While the input has focus, the WP3 arbiter still handles Up, Down and Enter but lets printable characters through.
- Keep the field showing the end of the query: input.scrollLeft = input.scrollWidth after each change.

2. Chips row (row -1), class kb-chip, cursor class kb-on:
- Show the 4 most recent queries.
- Once typed has 2 or more letters, replace them with up to 4 suggestions, debounced 300ms, from GET /api/suggest?q=. Run the request through the WP3 navGen guard and give it a 3s AbortController timeout. On failure, fall back to recents silently.
- Left and Right move along the row; a pinch sets typed to the chip and runs it.
- Up from grid row 0 enters the chips, or the input if there are none. Re-running a recent search costs a pinch, Up, pinch.

3. Grid:
- Keep the 10x4 layout. The nav audit's calculation showed re-ordering does not pay.
- Keep horizontal wrap; remove vertical wrap.
- Action row order: Search | Delete | Clear | Back, so landing on column 0 from the grid reaches Search.
- Left at row 0, column 0 with an empty field goes back; otherwise Left moves the cursor.
- After the 3rd letter, show the small hint '▲ suggestions' at 18px --t3.
- Remove #btn-search-back (WP3 already removed it from focus). Blur document focus on entering Search so only the cursor highlight shows.

4. Return from results:
- openSearch() no longer clears typed when coming back from results through the nav stack. The cursor lands on the Search key.
- Opening Search fresh from Home still starts empty.

5. Server, no new function:
- vercel.json rewrite: /api/suggest goes to /api/feed?mode=suggest.
- api/feed.js mode=suggest fetches https://suggestqueries-clients6.youtube.com/complete/search?client=youtube&ds=yt&q=<q> with a 3s timeout. Parse the JSONP or array response and return { ok: true, suggestions: [...up to 6] }, or { ok: false } on any failure.

6. scripts/selftest.mjs: the search-escape check walks to the Back action under the new order: Down 4 times, then Right 3 times.

**Acceptance.**

Setup: H = cd /private/tmp/claude-501/-Users-mike/d0c887a3-23b0-4c19-8596-7e911651ee39/scratchpad/hudtools && node shot.mjs --root /Users/mike/Documents/glasstube --additive --out impl/wp8

1. Recents reachable: H --name chips --steps "eval:localStorage.setItem('glasstube.queries',JSON.stringify(['lofi','mkbhd']));reload;wait:2500;key:Enter;wait:600;eval:document.querySelectorAll('#screen-search :focus').length;key:ArrowUp;wait:400;shot:chips;eval:document.querySelector('.kb-chip.kb-on').textContent;key:Enter;wait:6000;eval:[current,document.querySelector('#list-title').textContent]"
- Returns 0, then 'lofi', then ['list', containing 'lofi'].

2. Native input: H --name input --steps "wait:2500;key:Enter;wait:600;key:ArrowUp;wait:300;key:ArrowUp;wait:400;eval:document.activeElement.id;key:l;key:o;key:f;key:i;wait:300;eval:typed;key:Enter;wait:6000;eval:current"
- Returns 'kb-input', then 'LOFI', then 'list'.
- Typing a long query shows its end in the field (screenshot).

3. The query survives Back: continue the run with "key:ArrowLeft;wait:800;eval:[current,typed,document.querySelector('.kb-key.kb-on').textContent]"
- Returns ['search','LOFI','Search'].

4. Grid Left: with an empty field, the cursor on A, and key:ArrowLeft, eval:current returns 'home'. After typing one letter, Left wraps within the row instead.

5. Suggest endpoint before deploy: import api/feed.js in node with a mock req { method:'GET', query:{ mode:'suggest', q:'taylor' }, headers:{} } and a mock res that records statusCode, headers and the body.
- It returns ok:true with at least 3 suggestions, or ok:false within 3.5s if YouTube refuses. It never hangs.

6. After deploy:
- curl -s 'https://glasstube.vercel.app/api/suggest?q=taylor' returns JSON.
- In H, type 'ta' through the input. Within 1.5s, at least 3 .kb-chip elements show suggestions.
- find api -name '*.js' ! -name '_*' | wc -l still returns 12.
- node scripts/selftest.mjs passes.

7. On the glasses: Up twice, then pinch on the field. If the composer opens, dictate 'lofi' and the results appear. If it does not, the grid still works. Report Mike's firmware version.

**Risk.** - Unknown composer behaviour on Mike's firmware. If a pinch does not open it, the arbiter's Down still leaves the input and the grid is unchanged.
- Arrow keys inside a focused input must not move the text caret: the capture-phase handler prevents the default first.
- The suggest endpoint may be refused from Vercel's IPs. Failure is silent and recents stay.
- vercel.json rewrites must not shadow /api/search.
- Keep the selftest search-escape check working.

**Findings addressed.** [visual][nav] Search: unreachable recent-query chips, a false back hint, two focus indicators; [nav] Letter-grid typing costs about 4 inputs per character (suggestions and dictation); [visual] The search field hides the letters just typed; [research] For search, put a native <input type=search> first; keep the letter grid as a fallback

## Deferred

- Captions on the file and proxy routes, which play on the glasses: deferred. The iPhone would have to include captionTracks in the push, and the Vercel server cannot reliably fetch timedtext. That is iPhone work, out of scope. WP7 keeps the band under the video free for them.
- HUD asking the phone for a fresh file when a queued video has none or it expires soon (the phone only attaches files to the first 8 videos): deferred. It needs a new listener in the iPhone app (WebScreen.swift). WP5 at least reuses still-valid files kept in memory.
- Relay page (MediaRelay.swift) can strand the glasses on the phone's HTTP page: deferred, iPhone code. WP7 makes the relay reachable but keeps it an explicit choice.
- Account sync adopting a dead pairing on a reinstalled phone (Store.swift): deferred, iPhone code. WP6 marks replaced pairings, so the phone unpairs itself on its next check anyway.
- Detailed delivery messages in the iPhone app (reading delivery and glassesSeenS, a 'Type on iPhone' search push, a QR install link with ?pair=): deferred, iPhone code. WP6 already makes the phone's existing banner honest through ok and error text, and returns the new fields for a later app build.
- Service worker or offline shell: deferred. A cached page would add a stale-build failure on top of the stale-build problem WP1 solves. The no-store page plus self-update is enough. Revisit only with a ?swreset=1 escape hatch.
- Long-press and double-pinch gestures: deferred until the WP3 Input test measures the real band. Double-pinch would also delay every single pinch by about 300ms.
- Asking the phone for 360p or lower (itag 18): deferred. The phone chooses the itag, and push.js already accepts only 18 or 22.
- Self-hosting Roboto, as the perf audit proposed: rejected in favour of the research's local font stack, which downloads nothing.
- Visual audit's 16px text floor, a thumbnail on the Continue row, and a permanent thin progress line during playback: rejected. Meta's 18px floor wins, Home has to fit one screen, and a lens showing only the video is cleaner and uses less battery.
- Meta's 475ms/625ms focus animation: replaced by 180ms/240ms on opacity only, because swipes arrive under 140ms apart and content updates at 30 Hz.
- The README's 'Up goes to the previous video in the first 5s': dropped. Previous moves into the player menu so Up always rewinds.
- 'More results' paging after 20 search results: deferred. It needs continuation support in feed.js and matters less than dictation and suggestions.
- Moving the link token from the poll URL into a header: deferred. Low urgency, since Vercel keeps about 1h of logs; do it in a later server pass.
- Server-chosen poll interval (nextPollMs): deferred. The cadence rules in WP1 cut idle traffic by about 60-70%; add it only if Vercel quota becomes a problem.
- Switching the screenshot harness to linear-light blending: a tooling task, not a product change. Implementers should check dim greys with audit/visual/tools/linear.py.
- Spoken feedback through speechSynthesis: not needed for a video app, and the audio-busy error would compete with playback.

## Open questions for Mike

- Which firmware is on your glasses? You can find it in the Meta AI app under Devices, Glasses, About. Version 125.1 or newer turns the middle-finger tap into a real Back inside GlassTube, 127 or newer allows dictation into the search box, and 129 or newer adds the on-screen keyboard.
- Where does the pairing database live today: Supabase, or is it moving to Berth? There is an unfinished, uncommitted switch in api/_rpc.js. WP6 adds columns and functions and needs your OK to run that change on the live one.
- After WP1 goes live, will you restart GlassTube on the glasses once? Middle-finger tap on the GlassTube home screen, then Restart, or fully close and reopen it. The copy in memory now cannot update itself. After that one restart, every later update arrives on its own.
- Until the iPhone app is updated, honest delivery means a red banner on the phone whenever the glasses have not confirmed playback, for example 'It is on your glasses. Pinch to start it.' Is that OK?
- After WP7, does the video sitting in the middle of the lens feel right for your eye line, or would you rather it sat at the top?
- Do your up and down swipes register reliably, or do they sometimes fire when you just move your wrist? In the new player, Up rewinds 10 seconds and Down opens a menu.
- Keep YouTube red as the accent colour rather than Meta's blue?
- Would you reinstall GlassTube on the glasses from a link that includes your pair code? That makes the pairing survive the glasses wiping their storage.
- After WP5 and WP6 ship, could you record your display once while sending a video from the phone? In the Meta AI app it is Devices, then Record Display. That shows exactly what the glasses displayed.

## Platform research

HARDWARE (official, as Meta stated it and the press reported it): one full-colour 600x600 panel in the RIGHT lens, 20 deg field of view, 42 pixels per degree, auto brightness from 30 to 5,000 nits, panel at 90 Hz but content updates at 30 Hz. Wi-Fi 6 and Bluetooth 5.3. Sources: roadtovr.com/meta-ray-ban-smart-glasses-display-price-release-date-specs and gsmarena.

RUNTIME (official): a Chromium WebView on Android 14 (UA "Greatwhite", Chrome 151, observed). It needs glasses firmware v125+ and Meta AI app v272+. HTTPS only. Device pixel ratio is 1. Meta's toolkit gives this measurement profile (official, facebook/meta-wearables-webapp AGENTS.md "device envelope"): about 500 Kbps down (1 KB is about 16 ms), about 150 ms round trip, CPU about 12x slower than a laptop core, 30 Hz panel (33 ms frame budget). The targets that go with it: first paint under 1 s, usable under 5 s, first load under 300 KB, warm launch under 2 s with 0 bytes, fewer than 15 requests, heap under 128 MB. A Meta study measured startup at 650 ms native vs 3,900 ms web.

DISPLAY (official): additive light. #000 means no light, so the world shows through. Meta's guidance is a black canvas with bounded dark surfaces, not bright full-screen fills. Check readability over both bright and dark scenes, and never show state by colour alone. The docs say to treat 600x600 as a validation target and size from the viewport. Meta's custom-UI contract still accepts a fixed 600x600 root.

Values from @wearables-ui-toolkit/mrbd 129.23.0 styles.css (official):
- Typography: Noto Sans. numeral1 80/80, numeral2 64, display1 64/84, heading1 40/48 bold, heading2 36/44 bold, body1 32/40, body2 28/36, label and meta1 24/32, meta2 22/28, meta3 18/24 (the smallest style).
- Spacing: 2, 4, 8, 12, 16, 20, 24 (page inset), 32, 40, 48, 56, 64 px.
- Metrics: system-bar inset at the top 24 px, header area 64 px, ListItem at least 120 px tall, Button 88 px, chip 44 px, fading edges 32 / 64 / 88 / 100 px.
- Colours: window #000, text #fff, secondary #cfd3d9 (with a lighten blend), placeholder #aaafb9, surfaces #27282d and #30333a, border #ffffff40, accent #2694fe, positive #26a756, negative #ff5668, warning #c58600.

INPUT (official): the temple touchpad and the Neural Band deliver only keydown ArrowUp, ArrowDown, ArrowLeft, ArrowRight and Enter. There is no pointer, touch or keyboard. Chromium spatial navigation is on by default. Pinch-drag pointer events are opt-in through body{touch-action:none} in the first stylesheet. The toolkit's own timings: long press 500 ms, minimum pressed feedback 120 ms, arrows under 140 ms apart count as fast scroll.

BACK (official): since firmware v125.1, the middle-finger + thumb tap calls history.back() when history has an entry. Your page sees that as popstate, never as a key. With no history left it opens the native overlay / universal Web App menu (Restart, Resume, Permissions), and a second Back exits. pushState is capped at 5 entries including the root, and the root should be seeded with replaceState. Older glasses-app notes say the OS "never forwards" back; that was true before v125.1 or when the history stack is empty.

TEXT INPUT (official): input type=text or search, textarea and contenteditable open the system composer (handwriting, dictation, keyboard) on focus plus pinch. Firmware v127+ is needed for the composer and v129+ for the on-screen keyboard. It cannot type ' " _ [ ]. Read the text from input/change events. Programmatic .focus() does not open it.

LIFECYCLE (official plus observed):
- Official: if a new deploy behaves like the old build, use Restart in the universal menu. A new service worker waits until the old pages close.
- Official: localStorage and sessionStorage hold 5 MB each and can be wiped by app removal, device reset or storage pressure. Service workers and the Cache API work for an offline shell.
- Observed (IronMath 2a06d7b): an open page keeps its loaded bundle for days.
- Observed (GlassNav f845e40) and community (audiojoe4444/GlassTube): the glasses lose browser storage between launches, and firmware updates can wipe it.

ICONS (official, page dated 2026-09-22): the App Manager reads only /.well-known/meta-wearables-manifest.json, relative to the launch URL's directory. It needs version 1, a name, appearance.theme_color and/or icon_background.colors, and a monochrome transparent icon designed for a 64x64 area. PNG, WebP and SVG are allowed. The manifest must be 64 KiB or less, the icon 2 MiB or less (SVG 512 KiB or less, raster 4096 px or less), served as application/json; charset=utf-8. The legacy dialog uses PNG favicons, which must be larger than 52x52; SVG favicons are not supported. The QR install link is fb-viewapp://web_app_deep_link?appName=..&appUrl=..; navigator.install() also works.

MEDIA: no official Web Apps document covers video or autoplay (I searched both the docs and Meta's docs MCP server). speechSynthesis is official: one en-US voice, volume ignored, plays through the glasses speaker, and errors include audio-busy. The Display Access rule "video at most 400 px per side and 70,000 px" applies to phone-rendered video over Bluetooth, NOT to web apps. Inferred from Chrome policy: muted autoplay is allowed, sound needs user activation, and a pinch keydown grants activation that stays for the life of the page.

HOW TO TEST:
- Meta Ray-Ban Display Simulator Chrome extension (additive blend, scenes, D-pad, QA checklist, View on Glasses QR).
- Record Display from the Meta AI app (Devices > Record Display) or from the glasses settings.
- Docs MCP server at https://mcp.developer.meta.com/wearables (tool search_webapps_docs). It needs no auth and I queried it with curl.

Research files are under /private/tmp/claude-501/-Users-mike/d0c887a3-23b0-4c19-8596-7e911651ee39/scratchpad/hudtools/audit/platform/ (web/*.txt, pkg/, repos/, home-*-additive.png).

### Rules

- **Self-update a stale HUD. At deploy, stamp every /api/pair response with the build (for example d.v='1.26'). When d.v !== window.GLASSTUBE_BUILD, call location.replace with ?rv=<d.v> added. Do it at most once per build: skip if the URL already has rv=d.v. Never reload while current==='player'; defer until playback stops or the HUD is idle on home.** (observed) The glasses keep the old page in memory for days, so fixes never arrive (GlassTube live problem 2). The rv marker stops a reload loop that would drain the battery. Source: /Users/mike/Documents/IronMath/glasses/app.v11.js maybeReloadForVersion(); IronMath commit 2a06d7b
- **Teach the official manual refresh in Help and Diagnostics: 'Old version? Middle-finger tap on the home screen, then Restart.' Also show the build stamp (vX.Y) big for about 3 s at launch, then fade it out.** (official) Meta's documented fix for a deploy that behaves like the old build is Restart in the universal Web App menu. Cook fades its v11 stamp after launch so Mike can see on the lens that the new build loaded. Source: https://wearables.developer.meta.com/docs/develop/webapps/troubleshoot/ and /test/ (universal menu: Restart, Resume, Permissions); /Users/mike/Documents/Cook commit 7ff7b02
- **Handle the page lifecycle. On visibilitychange to visible and on pageshow: poll /api/pair right away (do not wait for the 2 s interval), re-run the version check, and call navigator.serviceWorker registration.update() if a worker exists. On hidden: clear the poll interval, or back it off to 10 s or more. Restart at 2 s when visible again. GlassTube currently has no visibilitychange or pageshow handler.** (observed) Glasses web apps are resumed, not navigated to. Without this the HUD can sit on a stale poll schedule or a stale build after the display wakes. The toolkit says to close polling when hidden. Source: Cook/glasses/app.js:1608; IronMath/glasses/app.v11.js (pageshow + visibilitychange restart polling); glassflow/js/hud.js:665; facebook/meta-wearables-webapp plugins/.../docs/offline-caching.md (update() on launch and when the page returns to the foreground)
- **Make pairing outlive storage wipes. Read the pairing in this order: launch URL (?pair=CODE or a link token in the Meta AI web-app URL), then localStorage, then a 1-year cookie. Write it to all three. Show the pinnable URL on the From iPhone screen. GlassTube today keeps glasstube.pair and glasstube.link in localStorage only.** (observed) The glasses lose browser storage between launches. GlassTube would then mint a new code while the phone keeps pushing to the old pairing, which is exactly 'Playing on your glasses' with nothing happening (live problem 1). The launcher URL is the only store that survives a wipe. Source: /Users/mike/Documents/glassnav commit f845e40; glassboard README (?code=48CA9F baked into the launch URL); community audiojoe4444/GlassTube README ('Glasses software updates can wipe a web app's saved data')
- **Make delivery honest. Let the phone say 'Playing on your glasses' only after the HUD acks: the HUD POSTs {ev:'playing', destSeq} on the video's 'playing' event, or {ev:'gate'} if it is waiting for a pinch. Otherwise the phone shows 'Sent. Glasses last checked in Ns ago' from lastSeen, and warns when that is over 10 s.** (observed) A push 'succeeds' whenever the pairing row exists, even with no glasses listening. GlassNav and GlassFlow had to add liveness and an echo so the phone stopped claiming delivery. Source: /Users/mike/Documents/glassnav commit e33d8e2 (lastSeenSecs); glassflow/js/hud.js echoState() (sawTs)
- **Use browser history for Back. At boot call history.replaceState({s:'home'},''). Push one entry per drill-down level (home > list > video or player), at most 4 pushes, because the cap is 5 entries including the root. Render screens from popstate event.state. Never pushState inside the popstate handler. At home, let Back fall through to the native menu.** (official) Since firmware v125.1 the Neural Band's middle-finger + thumb tap calls history.back() when history exists. That gives GlassTube a real one-gesture Back instead of spending ArrowLeft on it. Source: https://wearables.developer.meta.com/docs/develop/webapps/build/input-and-navigation/ ; github.com/facebook/meta-wearables-webapp issue #12 (a Meta contributor confirms v125.1)
- **Once system Back works, give ArrowLeft in the player a playback job (seek -10 s, or show controls) and route every Back through one goBack() that calls history.back(). On list screens Left may stay as a Back alias, but it must call the same history path.** (official) Today a stray left swipe exits the video. Meta says any on-screen Back must call the same history action, not keep separate navigation state. Source: https://wearables.developer.meta.com/docs/develop/webapps/build/input-and-navigation/ (Back navigation); glasstube/app.js handlePlayerKey()
- **Keep calling preventDefault() on every arrow key and Enter you handle (GlassTube's capture-phase listener already does). Never call el.click() for Enter without preventing the default Enter action.** (official) Chromium WebView spatial navigation is on by default. Without preventDefault, your focus move and the browser's both run, and Enter can activate a control twice. Source: https://wearables.developer.meta.com/docs/develop/webapps/build/input-and-navigation/
- **On keydown Enter, ignore events with e.repeat === true.** (observed) Enter auto-repeat is the band still holding the pinch, not new pinches. Without this, toggles flip back and forth and a play/pause pinch can fire several times. Source: /Users/mike/Documents/Cook/glasses/app.js:1367
- **Ignore Enter for 320 ms after any arrow swipe when it arrives as a keydown/keyup pair, and for 520 ms when it arrives as an atomic click or select.** (observed) A flick ends with the wrist settling, and the band often reports that as a pinch. In GlassTube that plays whatever row the swipe just landed on. Source: /Users/mike/Documents/Cook/glasses/app.js FLICK_LOCK_PRESS_MS=320, FLICK_LOCK_TAP_MS=520
- **Run all input through one arbiter. Drop the same gesture repeated within 130 ms (one physical gesture fanned out as key + synthetic click + wrist event). Treat a different gesture within 240 ms of a commit as a side effect. Treat the same arrow within 140 ms as one swipe; for long lists, accelerate instead of dropping.** (observed) One physical gesture reaches the page from several sources at once. Meta's toolkit also uses 140 ms as its fast-scroll threshold. Source: Cook/glasses/app.js (DUP_MS 130, CROSS_MS 240); glassflow/js/input.js and glassboard/js/input.js emit() 140 ms; @wearables-ui-toolkit/foundation Interactions.d.ts FAST_SCROLL_THRESHOLD_MS 140
- **Never map unknown key codes to a direction. Resolve e.key, then e.code, then keyCode (37-40, 13), then Android keycodes (19-23, 66). Otherwise ignore the event.** (observed) A guessed fallback direction made one swipe go right and the next go left, so the HUD looked dead. Source: /Users/mike/Documents/glassboard/js/input.js header comment
- **Make playback swipe-proof. While a video plays, swipes only show controls or seek; skipping to the next or previous video, or leaving the player, needs a pinch on a visible control or system Back. Swallow wheel events. GlassTube now skips to the next video on a bare ArrowDown.** (observed) A bump against the band must not drop the video. Cook treats up/down as wrist-tilt noise and wheel as a tilt sensor. GlassNav made its walking screens swipe-proof for the same reason. Source: Cook/glasses/app.js onKeyDown ('Up and down are wrist tilt on this band') and the wheel swallow; glassnav commit 702955e
- **Long press only for non-essential shortcuts: 500 ms threshold (Meta toolkit), or 680 ms with a progress meter that appears after 180 ms (Cook). Presses under 45 ms are noise, a double pinch is two within 550 ms, and a press with no release after 2,100 ms counts as released.** (official) Holds are slow, ambiguous and undiscoverable. These numbers are tuned on the band. Source: @wearables-ui-toolkit/foundation dist/base/Interactions.d.ts LONG_PRESS_TIMEOUT 500, QUICK_PRESS_RELEASE_DELAY 120; Cook/glasses/app.js HOLD_MS 680, HOLD_ARM_MS 180, TAP_MIN_MS 45, DOUBLE_MS 550, STUCK_MS 2100
- **For search, put a native <input type="search"> first. A pinch on it opens the system composer (dictation, handwriting, keyboard); read the text from 'input' and 'change'. Keep the letter grid as a fallback. Strip ' " _ [ ] from required inputs, since the composer cannot type them.** (official) The grid needs many swipes per letter; dictation is one gesture. The composer needs firmware v127+ (on-screen keyboard v129+) and opens only on focus plus activation, never from programmatic .focus(). Source: https://wearables.developer.meta.com/docs/develop/webapps/build/input-and-navigation/ (Text input); facebook/meta-wearables-webapp AGENTS.md ('Do not build a custom keyboard')
- **Write on-lens hints in gesture words: 'Pinch to play', 'Swipe left', 'Middle-finger tap to go back'. Never use 'Enter', 'Escape' or 'Backspace'.** (observed) The glasses never send those key names, so the hints confused the wearer. Source: /Users/mike/Documents/glassnav commit 4282472
- **Type scale: no text under 18 px. Metadata 22 px, list labels 24 px, routine copy 28 px, primary titles 32-40 px bold, big numbers 64-80 px. GlassTube home rows are 18 px labels with 14 px subtitles, and settings and debug use 12-16 px: raise every one of them.** (official) These are Meta's own sizes on this 600 px, DPR 1 additive panel. Small or thin text breaks up over bright scenes, and the additive screenshot confirms the 14 px subtitles nearly vanish. Source: @wearables-ui-toolkit/mrbd 129.23.0 dist/styles.css (.uit-text-*); https://wearables.developer.meta.com/docs/develop/webapps/design/foundations/theme/typography/; audit/platform/home-focus2-additive.png
- **Text colours: #fff primary, #cfd3d9 secondary (with mix-blend-mode: lighten), #aaafb9 for placeholder or disabled only. Nothing dimmer for text: drop GlassTube's #8d8d8d back hint. Status colours: #2694fe accent, #26a756 positive, #ff5668 error, #c58600 warning, always paired with an icon or word.** (official) Dim greys add almost no light, so they vanish against the world. Meta requires state to be shown by more than colour alone. Source: @wearables-ui-toolkit/mrbd dist/styles.css --uit-color-*; https://wearables.developer.meta.com/docs/develop/webapps/design/foundations/theme/colors/
- **Separate content with bounded dark surfaces (#1C1E21 to #30333a, radius 16-24 px) on a #000 page, never with large light fills. Show focus with a bright 2-3 px stroke or glow plus content going from 80% opacity at idle to 100% when focused, not a light-grey full-width bar like GlassTube's current focused row.** (official) Large bright areas wash out the world and cost battery. Meta says to add bounded surfaces instead of painting a bright background. Source: https://wearables.developer.meta.com/docs/develop/webapps/build/display-and-layout/; facebook/meta-wearables-webapp plugins/meta-wearables-webapp-game/docs/display-guidelines.md
- **Focus animation: about 475 ms on with cubic-bezier(0.6,0,0.4,1), 625 ms off, 100 ms press, at least 120 ms of visible press feedback. Animate transform and opacity only.** (official) These match the system feel. Other properties force layout work on a CPU about 12x slower than a laptop, with a 33 ms frame budget at 30 Hz. Source: meta-wearables-webapp game docs display-guidelines.md (Animation Curves); https://wearables.developer.meta.com/docs/develop/webapps/design/foundations/utilities/performance-and-validation/
- **Controls: list rows at least 88 px tall (Meta's ListItem is 120 px with a 74 px thumbnail), buttons 88 px, chips 44 px. That means about 4 rows per screen, not GlassTube's 7 rows at about 58 px.** (official) Bigger targets give larger text and fewer, clearer focus stops. They also give a scrolling list room to signal that more content follows. Source: @wearables-ui-toolkit/mrbd dist/styles.css (--uit-listitem-min-height 120px, --uit-chip-min-height 44px, --uit-listitem-media-size 74px); ButtonLayout.d.ts BUTTON_HEIGHT = 88
- **Insets: 24 px left and right, at least 24 px clear at the top for the system bar, a 64 px header area. No control within 8 px of any edge. Put the main block (title, play gate, now-playing) in the middle third of the panel.** (official) System UI and the focus rubber-band clip edge controls, and the waveguide is sharpest in the centre. Source: @wearables-ui-toolkit/mrbd (SYSTEM_BAR_INSET_TOP = 24, --uit-header-area-length 64px, --uit-spacing-large 24px); game docs display-guidelines.md (8 dp safe margin); glassnav commit 51d8209
- **Use only the 2/4/8/12/16/20/24/32/40/48/56/64 px spacing steps: 20 px between lines of a text stack, 32 px between sections.** (official) This is Meta's spacing scale, and it keeps rhythm consistent with system apps. Source: @wearables-ui-toolkit/foundation dist/styles.css --uit-spacing-*
- **Overflow: one scroll owner per axis, with a 32-88 px fading edge as the 'more below' cue. Auto-shrink only as a last resort, and never below about 24 px for primary text. If text still does not fit, cut at a word boundary with an ellipsis rather than slicing through glyphs.** (official) Meta prefers intentional scrolling over 'shrinking everything until it becomes unreadable'. GlassFlow's fit stops at 0.62x and Cook's ladder goes 54, 46, 40, 34, 30, 26 then trims. Source: https://wearables.developer.meta.com/docs/develop/webapps/build/display-and-layout/; glassflow/js/hud.js fitText(); Cook/glasses/app.js SIZES/SIZES_LAST
- **Drop the Google Fonts Roboto link (3 weights). Use a local stack instead: 'Noto Sans', system-ui, Roboto, sans-serif.** (official) On a link of about 500 Kbps with about 150 ms round trips, two extra origins plus font files cost 1-2 s at launch. Meta's guidance says no external font downloads, and its toolkit prefers an installed Noto Sans. Source: meta-wearables-webapp game docs performance-guidelines.md ('No external font downloads'); facebook/meta-wearables-webapp AGENTS.md (device envelope); toolkit typography page
- **Keep the launch budget: shell under 300 KB, fewer than 15 requests, first paint under 1 s, warm launch under 2 s. Stop every interval (pair poll, sleep watch, player tick) when hidden or off-screen.** (official) Meta's device profile is about 500 Kbps down, about 150 ms round trip, a 12x slower CPU and a 30 Hz panel. Source: facebook/meta-wearables-webapp AGENTS.md (Performance targets, device envelope)
- **Ask the phone for 360p or lower (for example muxed itag 18, 640x360). Size the video at most 600 px wide, about 338 px tall for 16:9.** (inferred) The panel is 600x600 at DPR 1, so anything above 360p cannot be seen. At about 500 Kbps, higher bitrates only cause stalls. Source: first principles from the 600x600 DPR 1 display and the official device envelope
- **Do not apply the 'video at most 400 px per side and 70,000 px' limit to GlassTube.** (official) That rule is for the Display Access SDK, where the phone renders and sends video over Bluetooth, not for web apps. Source: https://wearables.developer.meta.com/docs/develop/dat/display-overview/
- **Autoplay: keep the muted start and unmute on the first pinch. If the gate is needed, make it one pinch with a 40 px 'Pinch to play' in the centre. Avoid reloading the page (self-update, Restart) between a pinch and a push, because a reload loses user activation and the next push hits the gate again.** (inferred) No Web Apps document covers <video> autoplay, so Chrome's policy applies: muted autoplay is allowed, sound needs activation, and activation stays for the page's lifetime once granted. Source: glasstube/player.js (html5.muted first); Chrome autoplay and user-activation policy
- **If the YouTube iframe route is used, set tabindex=-1 and aria-hidden on the iframe. On window blur, refocus the HUD's current control after about 60 ms.** (observed) The iframe takes focus, and then the band's arrow keys go into YouTube instead of the HUD. Source: community github.com/audiojoe4444/GlassTube app.js (blur handler, iframe tabindex -1)
- **Audio: create any AudioContext only on the first pinch and suspend it when hidden. For spoken feedback, speechSynthesis uses the single en-US voice at system volume ('volume' is ignored); handle onerror 'audio-busy' and always show the same text on screen.** (official) These are the documented audio behaviours on the glasses. Source: https://wearables.developer.meta.com/docs/develop/webapps/build/text-to-speech/ ; game docs audio.md (Autoplay unlock and battery)
- **Add https://glasstube.vercel.app/.well-known/meta-wearables-manifest.json: {"version":1,"name":"GlassTube","appearance":{"theme_color":"#FF0033","icon":{"src":"../icon-mono.png","type":"monochrome"}}}. The icon is a transparent single-colour play mark designed for a 64x64 area. Serve the manifest as application/json; charset=utf-8, 64 KiB or less; icon 2 MiB or less. Keep PNG favicons larger than 52 px for the legacy dialog, and make sure favicon.ico does not lead with a 16x16 entry.** (official) The App Manager reads only this manifest and never looks at favicons, so GlassTube gets the fallback icon today. A 16x16 entry first in favicon.ico made the launcher fall back. Source: https://wearables.developer.meta.com/docs/develop/webapps/build/app-icons/ ; /troubleshoot/ (SVG favicons not supported, PNG larger than 52x52); glassnav commit d548afd
- **Install and sharing: the QR code must encode fb-viewapp://web_app_deep_link?appName=GlassTube&appUrl=https%3A%2F%2Fglasstube.vercel.app%2F%3Fpair%3D<code>, not a plain URL. Add <meta name="application-name" content="GlassTube"> for navigator.install().** (official) A plain-URL QR code is not recognised. Putting the pair code in appUrl also makes the pairing durable (see the pairing rule). Source: https://wearables.developer.meta.com/docs/develop/webapps/setup/ (Installing a Web App)
- **Keep <meta name="mrbd-web-app-capable" content="yes"> and the description. GlassTube's fixed 600x600 #stage is fine under Meta's custom-UI contract; still check that no element overflows 600 px wide, because the Simulator QA test flags it.** (official) The tag is required platform metadata, and a custom (non-toolkit) app's root may be exactly 600x600. Source: https://wearables.developer.meta.com/docs/develop/webapps/build/overview/ ; facebook/meta-wearables-webapp AGENTS.md (custom-UI opt-out); issue #28
- **Keep the crash bar registered before any other script, and add a '?swreset=1' escape hatch before ever adding a service worker. If you do add one, serve navigations network-first with no-cache, use cache-first only for hashed assets, and register with updateViaCache:'none'.** (official) The glasses have no reachable DevTools, so a bad cache or a silent crash cannot be fixed or seen otherwise. A cache-first shell would make the stale-build problem worse. Source: glassnav/index.html (error bar before scripts); meta-wearables-webapp game docs offline-caching.md (?swreset=1, network-first navigations)
- **Capture on-lens bugs with Display Recording: Meta AI app > Devices > Record Display, or the glasses settings pane > Display Recording.** (official) This is the only way to see what the lens actually showed when a push 'played' but nothing happened. Source: https://wearables.developer.meta.com/docs/develop/webapps/test/

### Lessons from the sibling glasses apps

IronMath (/Users/mike/Documents/IronMath/glasses/app.v11.js, commit 2a06d7b):
- Already solved stale builds. /api/hud stamps every response with its deployed version. On a mismatch the lens reloads with ?rv=<version>, once per version, so it can never loop. It also restarts polling on pageshow and visibilitychange.
- Input is one-dimensional on purpose: left/right moves along one strip of actions and pinch activates. Up/down only change view.
- GlassTube has no version check, no pageshow handler and no visibilitychange handler. This is the direct fix for live problem 2.

GlassNav (/Users/mike/Documents/glassnav):
- f845e40: the glasses lose browser storage between launches, which orphaned the phone. The pair code now falls back localStorage, then a 1-year cookie, then ?pair= in the launcher URL, which is the durable one.
- e33d8e2: the HUD starts listening at launch no matter what and renews a dead code. The phone only says delivered when the glasses polled recently (lastSeenSecs); before that it reported 'Sent' to a pairing nobody listened to.
- GlassTube keeps the pairing in localStorage only, so it still has the exact orphaned-pairing bug behind live problem 1.
- Other GlassNav lessons:
  - Walking screens are swipe-proof: a bump on the band does nothing, and only a pinch opens a menu (702955e).
  - Hints say 'pinch' and 'swipe left', never 'Enter' or 'Escape' (4282472).
  - The waveguide is sharpest in the centre, so the main block is centred with margin off the FOV edge (51d8209).
  - favicon.ico leading with a 16x16 entry made the launcher fall back; PNGs are cached for 1 h, so icons get a version bump (d548afd).
  - The crash bar is registered before every other script.
  - Splash: 1,400 ms, then a 700 ms fade.
  - Bounded retries: 3 attempts with an 8 s timeout each.

Cook (/Users/mike/Documents/Cook/glasses/app.js):
- The most tuned Neural Band input, all in one arbiter:
  - One physical gesture arrives as key + synthetic click + wrist event. Same gesture within 130 ms is a duplicate; a different gesture within 240 ms is a side effect.
  - A flick's wrist-settle reads as a select, so Enter is locked out for 320 ms after a swipe (520 ms for atomic clicks).
  - Enter e.repeat is the pinch still held, so it is ignored.
  - Hold 680 ms with a meter after 180 ms; taps under 45 ms are noise; double pinch within 550 ms; a press with no release by 2,100 ms is treated as released.
  - Up/down and wheel events are treated as wrist-tilt noise.
- Fixed-region grid with targeted textContent updates, never innerHTML per tick.
- Text fits with a ladder (54, 46, 40, 34, 30, 26 px), then trims at a word boundary.
- A version stamp shows on the lens and then fades.
- The lens refreshes on visibilitychange.
- GlassTube has none of the input timing guards: no post-swipe Enter lockout, no e.repeat check, no dedupe. In the player, a bare Down skips the video and a bare Left exits.

GlassFlow and GlassBoard (js/input.js, hud.js):
- One shared input resolver: e.key, then e.code, then keyCode, then Android keycodes. Same direction within 140 ms counts as one swipe, and unknown codes are never guessed (a guessed fallback made the HUD look dead).
- GlassFlow:
  - Text auto-fits to a 0.62x floor.
  - Polling is hot, warm or cold by idle time and stops entirely while document.hidden.
  - It echoes what the lens shows back to the phone (sawTs) so the phone displays a confirmed state.
  - A versioned service worker gives an offline shell, with /api never cached.
  - Baked room code FLOW01.
- GlassBoard bakes ?code=48CA9F into the launch URL so the pairing never drifts.
- GlassTube has no echo of what is actually playing, no idle backoff and no hidden handling.

Type sizes:
- Siblings use 20-28 px body text and 46-168 px hero text (GlassFlow hero 46 / step 30 / body 23; Cook 24 body / 54 step / 168 clock; GlassBoard 92 name / 36 lines; IronMath 104-164 numerals).
- GlassTube uses 14-18 px for most of its text.

Back:
- Every sibling still treats ArrowLeft as back, because they predate firmware v125.1.
- The official platform now delivers the middle-finger Back as popstate when history exists (5-entry cap). None of the siblings uses this yet. The community GlassTube (audiojoe4444) does, with a pushState guard.

### Unknowns

- Whether the glasses WebView sets document.hidden and fires visibilitychange when the display sleeps, the glasses are taken off, or another app opens, and whether setInterval polling keeps running then. GlassFlow assumes hidden when the screen is off, but no official page says so.
- Whether a playing <video> keeps the display awake or the display still dims and sleeps after inactivity (the Display Access docs say it sleeps), and whether navigator.wakeLock is supported.
- How Meta's host sets media autoplay (Android WebView setMediaPlaybackRequiresUserGesture). There is no Web Apps documentation on <video>, autoplay or HLS/MSE support.
- How long the runtime keeps a backgrounded page alive, and whether opening the app from the grid resumes the old page or reloads it. Mike observed days-old pages, but this is undocumented.
- Real throughput when the glasses use their own Wi-Fi rather than a link through the phone. The 500 Kbps / 150 ms figure is Meta's measurement profile, not a measured cap.
- Whether up/down swipes reach the page reliably on Mike's band, or arrive as wrist-tilt noise as Cook assumes.
- Mike's glasses firmware version. Firmware v125.1+ is needed for the history Back gesture, v127+ for the text composer, v129+ for the on-screen keyboard.
- Whether Mike's firmware already reads /.well-known/meta-wearables-manifest.json (App Manager) or still uses the legacy favicon/apple-touch-icon path.
- The exact obstructed edge regions on the device beyond the toolkit's 24 px top system-bar inset.
- Whether replaceState counts toward the 5-entry pushState cap, and what happens when pushState is called past the cap.
- Whether GlassTube's current Vercel cache headers (/ no-store, js/css max-age=0 must-revalidate) are honoured by the glasses' HTTP cache on Restart, or whether a stale bundle can survive Restart.
- Whether the Meta Ray-Ban Display Simulator's additive blend and brightness controls match real legibility outdoors at 30-5,000 nits.

## Audit summaries

### Reliability of the phone-to-glasses push and HUD self-update (3 critical, 3 high, 6 medium, 2 low)

The push path works when everything lines up, but nothing in it is confirmed from end to end. The phone shows "Playing on your glasses" as soon as the server accepts the push. The HUD acks (and the server deletes) the push before it decides whether to play it. Several confirmed paths make a push go nowhere without anyone seeing it: a single default-focused pinch on "New code" orphans the phone; pushes older than 10 minutes are consumed and skipped with nothing on screen; any "expired"-sounding error wipes the durable link; and the HUD's own keepalive marks the pair "Phone connected" with no phone at all (checked against production). There is also no self-update, and the build stamp has been frozen at "v1.25" since 2026-09-14, so even Diagnostics cannot show which code the glasses are running. The biggest opportunity is one closed loop on the existing /api/pair endpoint: the poll returns a build id (safe-moment reload), the HUD posts got/playing/pinch/failed/missed states, and the server records when the glasses last polled, so the phone can say what actually happened. Audit side effects: I created two throwaway pairs on production (E7AXH8, 453LPD) to check ack and touch behaviour, the same way scripts/selftest.mjs does. The harness also forwards /api/diag to production, so about 16 diag lines with origin 127.0.0.1 now appear in the Vercel logs.

### Navigation and interaction with the Neural Band (arrows + pinch, Left = back) (1 critical, 6 high, 5 medium, 2 low)

The basic model works: Up/Down move a single focus, pinch selects, Left goes back in lists, and Continue resumes in one pinch. Five things break it, all confirmed in the harness. Back always resets focus to the first row. A pinch on the default-focused button unlinks the phone. Two Search features can't be reached with the band. Two player swipes jump videos and lose your place. Loads you backed out of still change the screen seconds later. The most urgent fix is cheap: opening "From iPhone" puts focus on "New code", and one extra pinch swaps the paired link for a new one. That fits the live "Playing on your glasses but nothing happens" report. The biggest UX gain is a navigation stack that remembers focus, plus a reworked Search (reachable recent queries, suggestions after 2-3 letters, typing on the phone) and a player menu on Down in place of instant next-video. Typing a query today costs about 3-5 inputs per character (33 on average, 59 for "taylor swift"). Reordering the grid doesn't help (332 vs 339/340 inputs over 10 queries); typing 3 letters and picking a suggestion takes 12-17.

### Visual design and legibility on the additive display (1 critical, 7 high, 6 medium, 4 low)

The HUD copies YouTube's dark phone look: dark grey fills (#212121, #272727, #303030), a 5px pure-red focus bar, 12-14px secondary text, and white pills with black text. Most of that fails on see-through additive optics. Dim greys add almost no light, pure red is only about 21% as bright as white, and black text on a white pill shows up as a hole cut into a bright block. The worst problem is a CSS cascade bug. On every video row (search results, channel videos, Recents, Queue) it cancels the focus fill, so you cannot tell which video a pinch will play. I measured almost no brightness difference between focused and unfocused rows. A second selector bug turns every Channel and Playlist row into a red call-to-action pill. The biggest opportunity is one focus language plus a type floor: a 3px white ring, dimmed thumbnails on unfocused rows, nothing below 16px or weight 500, and red only for brand and progress. I prototyped this as an injected stylesheet with no repo edits (audit/visual/proto/proposal.css). It fixes focus visibility on home, lists, search and the player in the additive composites. Two UX traps also stand out because they relate to the live problems. On From iPhone, focus starts on "New code", so one extra pinch silently unlinks the phone. The home screen also never shows whether a phone is linked.

### Video player experience (player.js, player parts of app.js, styles.css, index.html #screen-player) (2 critical, 3 high, 6 medium, 2 low)

The video already uses the most space a 16:9 picture can at 600 wide (600x338, 56% of the screen). But it is pinned to the top, the text under it never hides, and the time and progress bar drawn over the picture are too small to read on the see-through display. The biggest defect is starting playback. player.js builds a new <video> for every video and unmutes it the moment muted autoplay starts. Chrome pauses a muted autoplay that gets unmuted without a gesture, and under the glasses WebView's default autoplay rule a new element can't play at all without one. So every push, and every next video in a queue, stops at "Enter to play". Then the 12s stall timer drops the working phone-file route while that prompt is still waiting, and the player ends on an endless "Loading..." with no error. That is a credible cause of "the phone says playing but nothing happens on the glasses". Separately, player.js reads window.GlassPrefs and window.GlassSound, which don't exist, so Speed, Sound Off, Audio only and Captions are all ignored during playback. The single biggest opportunity: keep one <video> element for the whole session, unlock it on the first pinch, never unmute without a gesture, and never drop a route while waiting for a pinch. In headless Chrome under the WebView rule, a reused, unlocked element played later videos with sound and no pinch, while a new element was refused. None of these fixes reach the glasses until the page reloads (known issue 2).

### Runtime performance, battery and robustness on the glasses' Android WebView (6 high, 2 medium, 4 low)

The HUD itself is light. Home has 143 elements and a 20-result search 288. JS heap stays at 1-2.6 MB. 15 player open/close cycles leaked nothing (nodes 360 to 365, listeners 36 to 37). No JS errors on any screen, no filters or blur, and per-tick script cost is about 0.25 ms even at 4x CPU throttle. The real problems are in the timing and network layer around it: every pairing poll is fire-and-forget (no timeout, no in-flight guard, no ordering check), it polls every 2 s forever, the page never updates itself, and a third-party font stylesheet can blank the whole app. Several of these map directly onto the three known live problems: missed pushes, a stale page that lives for days, and false "Enter to play" gates. Two confirmed bugs stand out. Player.js reads window.GlassPrefs and window.GlassSound, which are undefined, so Speed, Captions, Sound Off and the battery-saving "Audio only" never take effect. And the production proxy route takes 61-65 s to fail, so every video not pushed with a file wastes 12 s behind a misleading "Enter to play". The single biggest opportunity is to rebuild pollPair into a guarded, timed-out, visibility-aware loop that also carries a deployment id. That one change makes pushes reliable, shows the wearer when the phone link is dead, cuts idle traffic by about two thirds, and gives the glasses self-update.
