import { json } from '../_rpc.js';
import { openSeal, seal } from './_crypto.js';

export const YT_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
const SCOPES = ['openid', 'email', 'profile', YT_SCOPE].join(' ');

export function origin() {
  return String(process.env.GLASSTUBE_ORIGIN || 'https://glasstube.vercel.app').replace(/\/$/, '');
}

export function redirectUri() {
  return origin() + '/api/auth/callback';
}

export function googleConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function authUrl(state) {
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID);
  u.searchParams.set('redirect_uri', redirectUri());
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', SCOPES);
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  u.searchParams.set('state', state);
  return u.toString();
}

export async function exchangeCode(code) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    }),
  });
  const d = await r.json();
  if (!r.ok || !d.access_token) {
    throw new Error((d && d.error_description) || (d && d.error) || 'Google token exchange failed');
  }
  return d;
}

export async function refreshAccess(refreshToken) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  });
  const d = await r.json();
  if (!r.ok || !d.access_token) {
    throw new Error((d && d.error_description) || (d && d.error) || 'Google refresh failed');
  }
  return d;
}

export async function userInfo(accessToken) {
  const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: 'Bearer ' + accessToken },
  });
  if (!r.ok) return {};
  return r.json();
}

export function makeState(n) {
  return seal({ n: n === 'ios' ? 'ios' : 'web', ts: Date.now() });
}

export function readState(raw) {
  const s = openSeal(raw);
  if (!s || !s.ts || (Date.now() - s.ts) > 15 * 60 * 1000) throw new Error('Login timed out. Try again.');
  return s;
}

export function packSession(tokens, profile) {
  return {
    rt: tokens.refresh_token,
    at: tokens.access_token,
    exp: Date.now() + ((Number(tokens.expires_in) || 3600) * 1000),
    sub: String(profile.sub || ''),
    email: String(profile.email || ''),
    name: String(profile.name || profile.email || 'YouTube'),
    picture: String(profile.picture || ''),
  };
}

export function publicMe(sess) {
  return {
    name: sess.name || '',
    email: sess.email || '',
    picture: sess.picture || '',
  };
}

export async function loadSession(req) {
  const h = String((req.headers && (req.headers.authorization || req.headers.Authorization)) || '');
  const q = String((req.query && req.query.s) || '');
  const token = (h.toLowerCase().indexOf('bearer ') === 0 ? h.slice(7) : '') || q;
  if (!token) return { sess: null, token: '' };
  let sess;
  try { sess = openSeal(token); } catch (e) { return { sess: null, token: '' }; }
  if (!sess || !sess.rt) return { sess: null, token: '' };
  if (Date.now() > (Number(sess.exp) || 0) - 60000) {
    const fresh = await refreshAccess(sess.rt);
    sess.at = fresh.access_token;
    sess.exp = Date.now() + ((Number(fresh.expires_in) || 3600) * 1000);
    return { sess, token: seal(sess), rotated: true };
  }
  return { sess, token, rotated: false };
}

export function withSession(res, body, token, rotated) {
  if (rotated && token) res.setHeader('X-GlassTube-Session', token);
  return json(res, 200, body);
}

export function needAuth(res) {
  return json(res, 200, { ok: false, auth: false, error: 'Sign in with Google first.' });
}
