import { origin, exchangeCode, userInfo, packSession, readState } from './_google.js';
import { seal } from './_crypto.js';

function bounce(res, url) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Location', url);
  return res.status(302).end();
}

function fail(res, n, err) {
  const msg = encodeURIComponent(String(err || 'Google login failed'));
  if (n === 'ios') return bounce(res, 'glasstube://oauth?err=' + msg);
  return bounce(res, origin() + '/phone?autherr=' + msg);
}

export default async function handler(req, res) {
  const q = req.query || {};
  const err = String(q.error || '');
  let n = 'web';
  try {
    if (q.state) n = readState(String(q.state)).n;
  } catch (e) {
    return fail(res, n, e.message || e);
  }
  if (err) return fail(res, n, q.error_description || err);
  const code = String(q.code || '');
  if (!code) return fail(res, n, 'Google did not return a login code.');

  try {
    const tokens = await exchangeCode(code);
    if (!tokens.refresh_token) {
      return fail(res, n, 'Google did not give a refresh token. Sign in again and allow access.');
    }
    const profile = await userInfo(tokens.access_token);
    const blob = seal(packSession(tokens, profile));
    if (n === 'ios') return bounce(res, 'glasstube://oauth?s=' + encodeURIComponent(blob));
    return bounce(res, origin() + '/phone?s=' + encodeURIComponent(blob));
  } catch (e) {
    return fail(res, n, e.message || e);
  }
}
