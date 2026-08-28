import { loadSession, publicMe, withSession, needAuth } from './_google.js';

export default async function handler(req, res) {
  try {
    const { sess, token, rotated } = await loadSession(req);
    if (!sess) return needAuth(res);
    return withSession(res, { ok: true, me: publicMe(sess) }, token, rotated);
  } catch (e) {
    return needAuth(res);
  }
}
