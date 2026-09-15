import { json } from './_rpc.js';
import { parseYouTube, resolveHandle, channelFeed, channelPage, keepPlayable } from './_yt.js';
import { searchYouTube } from './_search.js';

/* Two jobs behind one function because the Hobby plan only allows twelve of
   them: /api/feed?channel=... lists a channel, /api/search?q=... (rewritten
   here) searches. Both are the no-sign-in paths the glasses use. */
export default async function handler(req, res) {
  const q = req.query || {};
  const term = String(q.q || q.search || '').trim();
  const wantsSearch = String(q.mode || '') === 'search' ||
    (!!term && !q.channel && !q.handle && !q.url);
  if (wantsSearch) {
    try {
      return json(res, 200, await searchYouTube(term, q.limit));
    } catch (e) {
      return json(res, 200, { ok: false, error: String((e && e.message) || e) });
    }
  }
  const raw = String(q.url || q.handle || q.channel || '').trim();
  if (!raw) return json(res, 200, { ok: false, error: 'channel required' });

  const parsed = parseYouTube(raw);
  if (!parsed) {
    return json(res, 200, { ok: false, error: 'That does not look like a YouTube channel.' });
  }
  if (parsed.kind === 'video') {
    return json(res, 200, {
      ok: false,
      error: 'That is a video link. Use Send, or paste the channel page instead.',
    });
  }
  if (parsed.kind === 'playlist') {
    return json(res, 200, { ok: false, error: 'That is a playlist. Add it under Playlists.' });
  }

  try {
    const limit = Math.max(1, Math.min(Number(q.limit) || 6, 8));
    // via=page forces the second route. The Atom feed is the one that goes
    // down, so the fallback needs to be testable on its own rather than only
    // when YouTube happens to be misbehaving.
    if (String(q.via || '') === 'page') {
      const ref = parsed.kind === 'handle' ? parsed.handle : parsed.id;
      const page = await channelPage(ref, limit);
      return json(res, 200, {
        ok: !!page.videos.length,
        via: 'page',
        id: page.id || parsed.id || '',
        name: String(page.channel || 'Channel').slice(0, 80),
        url: page.id ? ('https://www.youtube.com/channel/' + page.id) : '',
        videos: page.videos,
        error: page.videos.length ? undefined : 'Channel page had no videos.',
      });
    }
    let id = parsed.id;
    if (parsed.kind === 'handle') {
      id = await resolveHandle(parsed.handle);
      if (!id) {
        // resolveHandle scrapes the profile page; when that is rate limited the
        // videos page usually is not, and it answers with the id and the list
        // in one request.
        const page = await channelPage(parsed.handle, limit);
        if (!page.id && !page.videos.length) {
          return json(res, 200, { ok: false, error: 'Could not find that @name.' });
        }
        const found = await keepPlayable(page.videos);
        return json(res, 200, {
          ok: true,
          id: page.id,
          name: String(page.channel || parsed.handle).slice(0, 80),
          url: page.id ? ('https://www.youtube.com/channel/' + page.id) : '',
          videos: found,
        });
      }
    }
    const feed = await channelFeed(id, limit);
    const videos = await keepPlayable(feed.videos || []);
    return json(res, 200, {
      ok: true,
      id,
      name: String(feed.channel || parsed.handle || 'Channel').slice(0, 80),
      url: 'https://www.youtube.com/channel/' + id,
      videos,
    });
  } catch (e) {
    return json(res, 200, { ok: false, error: String((e && e.message) || e) });
  }
}
