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

nothing yet.

## Log

2026-08-31 Mac: created this mailbox so Mac Cursor and the other Cursor can talk via GitLab.
