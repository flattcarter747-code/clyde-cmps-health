// Shared code for the admin panel functions (admin-login, admin-api).
//
// Security notes for future maintainers:
// - The access codes are NEVER stored in this repo. Netlify keeps only scrypt hashes of them
//   in environment variables (ADMIN_DEV_CODE_HASH, ADMIN_EDITOR_CODE_HASH, ADMIN_CODE_SALT).
//   To change a code, run:  node scripts/hash-admin-code.mjs <new 10-digit code>
// - Sessions are short-lived tokens signed with ADMIN_SESSION_SECRET.
// - Saving writes a commit to GitHub using ADMIN_GITHUB_TOKEN (a fine-grained token that can
//   only touch this one repo). Netlify then rebuilds the site.

import { createHmac, scryptSync, timingSafeEqual } from 'node:crypto';

export const REPO = 'flattcarter747-code/clyde-cmps-health';
export const BRANCH = 'main';
export const SESSION_HOURS = 8;

export const ROLES = {
  developer: { label: 'Developer' },
  editor: { label: 'Lead Student / Teacher' },
};

// ---- responses ---------------------------------------------------------------

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

export function env(name) {
  const v = process.env[name] ?? globalThis.Netlify?.env?.get(name);
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

// ---- codes -------------------------------------------------------------------

export function hashCode(code, salt) {
  return scryptSync(String(code), salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex');
}

function sameHex(a, b) {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Returns 'developer' | 'editor' | null */
export function roleForCode(code) {
  if (!/^\d{10}$/.test(String(code))) return null;
  const h = hashCode(code, env('ADMIN_CODE_SALT'));
  if (sameHex(h, env('ADMIN_DEV_CODE_HASH'))) return 'developer';
  if (sameHex(h, env('ADMIN_EDITOR_CODE_HASH'))) return 'editor';
  return null;
}

// ---- sessions ----------------------------------------------------------------

const b64 = (s) => Buffer.from(s).toString('base64url');
const sign = (data) => createHmac('sha256', env('ADMIN_SESSION_SECRET')).update(data).digest('base64url');

export function makeSession(role) {
  const payload = b64(JSON.stringify({ role, exp: Date.now() + SESSION_HOURS * 3600 * 1000 }));
  return `${payload}.${sign(payload)}`;
}

/** Returns { role } or null */
export function readSession(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!ROLES[data.role] || Date.now() > data.exp) return null;
    return { role: data.role };
  } catch {
    return null;
  }
}

// ---- permissions ---------------------------------------------------------------

const EDITOR_FILES = [
  /^src\/data\/events\.json$/,
  /^src\/data\/resources\.json$/,
  /^src\/content\/topics\/[a-z0-9-]+\.md$/,
];

const TEXT_EXT = /\.(md|mdx|json|astro|mjs|js|ts|css|html|txt|toml|svg|yml|yaml)$|^\.(gitignore|nvmrc)$|\/\.(gitignore|nvmrc)$/;

export function safePath(path) {
  return typeof path === 'string' && path.length < 300 && !path.startsWith('/') && !path.split('/').includes('..') && /^[\w./ -]+$/.test(path);
}

export function canEdit(role, path) {
  if (!safePath(path)) return false;
  if (role === 'developer') return TEXT_EXT.test(path) && !path.startsWith('node_modules/');
  if (role === 'editor') return EDITOR_FILES.some((re) => re.test(path));
  return false;
}

// ---- GitHub ------------------------------------------------------------------

export async function gh(path, init = {}) {
  const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env('ADMIN_GITHUB_TOKEN')}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'chshealthcare-admin',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
    signal: AbortSignal.timeout(15000),
  });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(body?.message || `GitHub error ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

export async function readFile(path) {
  const f = await gh(`/contents/${encodeURI(path)}?ref=${BRANCH}`);
  return { path, sha: f.sha, content: Buffer.from(f.content, 'base64').toString('utf8') };
}

export async function writeFile(path, content, sha, message, role) {
  const r = await gh(`/contents/${encodeURI(path)}`, {
    method: 'PUT',
    body: JSON.stringify({
      message,
      content: Buffer.from(content, 'utf8').toString('base64'),
      sha: sha || undefined,
      branch: BRANCH,
      author: { name: `CmPS Admin (${ROLES[role].label})`, email: 'admin@chshealthcare.org' },
    }),
  });
  return { sha: r.content.sha, commitUrl: r.commit.html_url };
}
