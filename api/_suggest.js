/* Search suggestions for the glasses' search screen (/api/suggest, rewritten
   onto /api/feed?mode=suggest so it costs no extra serverless function).

   Typing on the band's letter grid costs about four inputs per letter, so two
   letters plus one Up and a pinch on a suggestion is the cheap way to search.
   YouTube's own suggest service answers either JSONP
   (window.google.ac.h([...])) or a bare array, depending on the client, and
   each hit is either a string or [string, ...]. Any failure answers
   { ok: false } quickly and the HUD silently keeps showing recent searches. */
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';
const SUGGEST_URL = 'https://suggestqueries-clients6.youtube.com/complete/search?client=youtube&ds=yt&q=';
const TIMEOUT_MS = 3000;
const MAX_SUGGESTIONS = 6;
const MAX_QUERY = 100;

const cache = new Map();
const CACHE_MS = 10 * 60 * 1000;
const CACHE_MAX = 300;

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/* Returns the suggestion strings, or null when the text is not a suggest
   response at all. Exported for the unit check in scripts/. */
export function parseSuggest(text) {
  let s = String(text || '').trim();
  if (!s) return null;
  // XSSI guard some Google endpoints prepend.
  s = s.replace(/^\)\]\}'?\s*/, '');
  if (s[0] !== '[') {
    const a = s.indexOf('(');
    const b = s.lastIndexOf(')');
    if (a < 0 || b <= a) return null;
    s = s.slice(a + 1, b).trim();
  }
  let data;
  try { data = JSON.parse(s); } catch (e) { return null; }
  if (!Array.isArray(data) || !Array.isArray(data[1])) return null;
  const seen = new Set();
  const out = [];
  for (const hit of data[1]) {
    const raw = Array.isArray(hit) ? hit[0] : hit;
    if (typeof raw !== 'string') continue;
    const t = decodeEntities(raw).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t.slice(0, 80));
    if (out.length >= MAX_SUGGESTIONS) break;
  }
  return out;
}

function charsetOf(type) {
  const m = String(type || '').match(/charset=([^;]+)/i);
  return m ? m[1].trim().replace(/^["']|["']$/g, '').toLowerCase() : 'utf-8';
}

async function fetchSuggest(q) {
  const r = await fetch(SUGGEST_URL + encodeURIComponent(q), {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) throw new Error('suggest HTTP ' + r.status);
  const buf = await r.arrayBuffer();
  let text;
  try { text = new TextDecoder(charsetOf(r.headers.get('content-type'))).decode(buf); }
  catch (e) { text = new TextDecoder('utf-8').decode(buf); }
  const list = parseSuggest(text);
  if (!list) throw new Error('suggest: unreadable answer');
  return list;
}

export async function suggestYouTube(term) {
  const q = String(term || '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY);
  if (!q) return { ok: true, q: '', suggestions: [] };
  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return { ok: true, q, suggestions: hit.list };
  let timer;
  try {
    // The fetch has its own abort signal; the race is the belt to its braces,
    // so a stuck DNS lookup or body read can never hold the function open.
    const list = await Promise.race([
      fetchSuggest(key),
      new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('suggest timed out')), TIMEOUT_MS + 200);
      }),
    ]);
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, { at: Date.now(), list });
    return { ok: true, q, suggestions: list };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).slice(0, 120) };
  } finally {
    clearTimeout(timer);
  }
}
