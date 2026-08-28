import { json } from '../_rpc.js';
import { googleConfigured, authUrl, makeState } from './_google.js';

export default async function handler(req, res) {
  if (!googleConfigured()) {
    return json(res, 200, { ok: false, error: 'Google login is not configured on the server.' });
  }
  const n = String((req.query && req.query.n) || 'web');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Location', authUrl(makeState(n)));
  return res.status(302).end();
}
