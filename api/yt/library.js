import { loadSession, publicMe, withSession, needAuth } from '../auth/_google.js';
import { json } from '../_rpc.js';
import { yt, ytPages, playlistVideos } from './_client.js';

export default async function handler(req, res) {
  try {
    const { sess, token, rotated } = await loadSession(req);
    if (!sess) return needAuth(res);

    const meCh = await yt(sess, 'channels', { part: 'contentDetails,snippet', mine: 'true' });
    const mine = (meCh.items && meCh.items[0]) || {};
    const related = (mine.contentDetails && mine.contentDetails.relatedPlaylists) || {};
    const likesId = related.likes || '';
    const watchLaterId = related.watchLater || '';
    const uploadsId = related.uploads || '';

    const [subs, lists, likes, watchLater, uploads] = await Promise.all([
      ytPages(sess, 'subscriptions', { part: 'snippet', mine: 'true', order: 'alphabetical' }, 150),
      ytPages(sess, 'playlists', { part: 'snippet,contentDetails', mine: 'true' }, 100),
      likesId ? playlistVideos(sess, likesId, 20).catch(e => ({ error: String(e.message || e) })) : Promise.resolve([]),
      watchLaterId ? playlistVideos(sess, watchLaterId, 20).catch(e => ({ error: String(e.message || e) })) : Promise.resolve({ error: 'Watch Later is not available through YouTube\'s API.' }),
      uploadsId ? playlistVideos(sess, uploadsId, 20).catch(e => ({ error: String(e.message || e) })) : Promise.resolve([]),
    ]);

    const likesErr = likes && likes.error;
    const wlErr = watchLater && watchLater.error;
    const uploadsErr = uploads && uploads.error;

    return withSession(res, {
      ok: true,
      me: publicMe(sess),
      likesId,
      watchLaterId,
      uploadsId,
      likes: Array.isArray(likes) ? likes : [],
      likesError: likesErr || '',
      watchLater: Array.isArray(watchLater) ? watchLater : [],
      watchLaterError: wlErr || '',
      uploads: Array.isArray(uploads) ? uploads : [],
      uploadsError: uploadsErr || '',
      playlists: lists.map(p => ({
        id: p.id,
        name: String((p.snippet && p.snippet.title) || 'Playlist').slice(0, 80),
        count: Number((p.contentDetails && p.contentDetails.itemCount) || 0),
      })).filter(p => p.id),
      subscriptions: subs.map(s => {
        const sn = s.snippet || {};
        const id = (sn.resourceId && sn.resourceId.channelId) || '';
        const thumbs = sn.thumbnails || {};
        return {
          id,
          name: String(sn.title || 'Channel').slice(0, 80),
          thumb: (thumbs.medium && thumbs.medium.url) || (thumbs.default && thumbs.default.url) || '',
          url: id ? ('https://www.youtube.com/channel/' + id) : '',
        };
      }).filter(s => s.id),
    }, token, rotated);
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (/invalid|expired|unauth|revoked/i.test(msg)) return needAuth(res);
    return json(res, 200, { ok: false, error: msg });
  }
}
