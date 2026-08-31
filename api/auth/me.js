import { loadSession, publicMe, withSession, needAuth } from './_google.js';

export default async function handler(req, res) {
  try {
    const { sess, token, rotated } = await loadSession(req);
    if (!sess) {
      console.log('[glasstube-me]', JSON.stringify({ ok: false }));
      return needAuth(res);
    }
    console.log('[glasstube-me]', JSON.stringify({ ok: true, email: sess.email || '' }));
    return withSession(res, { ok: true, me: publicMe(sess) }, token, rotated);
  } catch (e) {
    return needAuth(res);
  }
}
