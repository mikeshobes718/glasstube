export function rpcConfigured() {
  return !!(process.env.GLASSTUBE_SUPABASE_URL && process.env.GLASSTUBE_SUPABASE_KEY);
}

export async function rpc(name, args) {
  const base = (process.env.GLASSTUBE_SUPABASE_URL || '').trim().replace(/\/$/, '');
  const key = (process.env.GLASSTUBE_SUPABASE_KEY || '').trim();
  if (!base || !key) throw new Error('pairing backend not configured');
  const r = await fetch(base + '/rest/v1/rpc/' + name, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args || {}),
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
  if (!r.ok) {
    const msg = (data && (data.message || data.hint)) || ('rpc HTTP ' + r.status);
    throw new Error(msg);
  }
  return data;
}

export function readBody(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  if (typeof req.body === 'string') {
    try { return Promise.resolve(JSON.parse(req.body)); } catch (e) { /* stream it */ }
  }
  return new Promise(resolve => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 200000) s = s.slice(0, 200000); });
    req.on('end', () => { try { resolve(JSON.parse(s)); } catch (e) { resolve(null); } });
    req.on('error', () => resolve(null));
  });
}

export function noStore(res) {
  res.setHeader('Cache-Control', 'no-store');
}

export function json(res, status, body) {
  noStore(res);
  res.status(status).json(body);
}
