import crypto from 'crypto';

function key() {
  const secret = String(process.env.GLASSTUBE_AUTH_SECRET || process.env.GLASSTUBE_SUPABASE_KEY || '').trim();
  if (!secret) throw new Error('auth secret missing');
  return crypto.createHash('sha256').update(secret).digest();
}

export function seal(obj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const bin = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, bin]).toString('base64url');
}

export function openSeal(token) {
  const buf = Buffer.from(String(token || ''), 'base64url');
  if (buf.length < 29) throw new Error('bad session');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const bin = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  const json = Buffer.concat([decipher.update(bin), decipher.final()]).toString('utf8');
  return JSON.parse(json);
}
