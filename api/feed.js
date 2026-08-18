import { json } from './_rpc.js';
import { channelFeed } from './_yt.js';

export default async function handler(req, res) {
  const channel = String((req.query && req.query.channel) || '').trim();
  if (!/^UC[a-zA-Z0-9_-]{20,}$/.test(channel)) {
    return json(res, 200, { ok: false, error: 'channel id required' });
  }
  try {
    const feed = await channelFeed(channel, 6);
    return json(res, 200, { ok: true, channel: feed.channel, videos: feed.videos });
  } catch (e) {
    return json(res, 200, { ok: false, error: String((e && e.message) || e) });
  }
}
