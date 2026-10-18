// POST /.netlify/functions/admin-login  { code: "1234567890" }  ->  { token, role, expiresInHours }
// Wrong codes are rate-limited: 5 misses per device per 15 minutes, plus a site-wide cap.
import { getStore } from '@netlify/blobs';
import { createHash } from 'node:crypto';
import { json, roleForCode, makeSession, ROLES, SESSION_HOURS } from '../lib/admin-shared.mjs';

const PER_IP = { max: 5, windowMs: 15 * 60 * 1000 };
const GLOBAL = { max: 60, windowMs: 60 * 60 * 1000 };

async function tooMany(store, key, limit) {
  const rec = (await store.get(key, { type: 'json' })) || { n: 0, start: Date.now() };
  if (Date.now() - rec.start > limit.windowMs) return { blocked: false, rec: { n: 0, start: Date.now() } };
  return { blocked: rec.n >= limit.max, rec, retryMin: Math.ceil((rec.start + limit.windowMs - Date.now()) / 60000) };
}

export default async (req, context) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let code = '';
  try {
    code = String((await req.json()).code || '').replace(/\D/g, '');
  } catch {
    return json({ error: 'Bad request' }, 400);
  }

  const store = getStore('admin-login-attempts');
  const ip = context?.ip || req.headers.get('x-nf-client-connection-ip') || 'unknown';
  const ipKey = 'ip-' + createHash('sha256').update(ip).digest('hex').slice(0, 32);

  const [perIp, global] = await Promise.all([tooMany(store, ipKey, PER_IP), tooMany(store, 'global', GLOBAL)]);
  if (perIp.blocked || global.blocked) {
    const mins = perIp.blocked ? perIp.retryMin : global.retryMin;
    return json({ error: `Too many wrong codes. Try again in about ${mins} minute${mins === 1 ? '' : 's'}.` }, 429);
  }

  let role = null;
  try {
    role = roleForCode(code);
  } catch (e) {
    console.error(e);
    return json({ error: 'The admin panel is not set up yet (missing settings on Netlify).' }, 500);
  }

  if (!role) {
    await Promise.all([
      store.setJSON(ipKey, { n: perIp.rec.n + 1, start: perIp.rec.start }),
      store.setJSON('global', { n: global.rec.n + 1, start: global.rec.start }),
    ]);
    const left = PER_IP.max - (perIp.rec.n + 1);
    return json({ error: left > 0 ? `That code didn't work. ${left} tr${left === 1 ? 'y' : 'ies'} left.` : 'Too many wrong codes. Try again in 15 minutes.' }, 401);
  }

  await store.delete(ipKey);
  return json({ token: makeSession(role), role, roleLabel: ROLES[role].label, expiresInHours: SESSION_HOURS });
};
