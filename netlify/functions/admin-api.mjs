// Admin panel API. Every request needs a session token from admin-login.
//
// GET  ?action=me                      -> { role }
// GET  ?action=topics                  -> [{ slug, title }]
// GET  ?action=get&path=...[&raw=1]    -> { kind, sha, data?, body?, content? }
// GET  ?action=tree                    -> [path]           (developer only)
// POST { action: 'save', path, sha, kind, data?, body?, content?, note? }  -> { sha, commitUrl }
import YAML from 'yaml';
import { json, readSession, canEdit, readFile, writeFile, gh, BRANCH, ROLES } from '../lib/admin-shared.mjs';

const TOPIC_DIR = 'src/content/topics';
const ICONS = ['weight', 'gauge', 'candy', 'apple', 'hand-heart', 'droplet', 'brain', 'heart-pulse', 'egg'];
const TOPIC_KEYS = ['title', 'order', 'icon', 'hook', 'description', 'quickFacts', 'signsTitle', 'signs', 'signsNote', 'actions', 'doctorTitle', 'doctor', 'emergency', 'bonus', 'links', 'related'];

// ---- parsing / serializing -----------------------------------------------------

function splitFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) throw new Error('This file is missing its --- frontmatter --- block.');
  return { data: YAML.parse(m[1]) || {}, body: m[2].replace(/^\s*\n/, '') };
}

function joinFrontmatter(data, body) {
  return `---\n${YAML.stringify(data, { lineWidth: 0 })}---\n\n${String(body || '').trim()}\n`;
}

function kindFor(path) {
  if (path.startsWith(`${TOPIC_DIR}/`) && path.endsWith('.md')) return 'topic';
  if (path.endsWith('.json')) return 'json';
  return 'text';
}

// ---- validation (mirrors src/content.config.ts so a save can't break the build) ---------

const isUrl = (s) => { try { return /^https?:$/.test(new URL(s).protocol); } catch { return false; } };
const str = (v) => typeof v === 'string' && v.trim().length > 0;
const strList = (v) => Array.isArray(v) && v.every(str);
const clean = (v) => (typeof v === 'string' ? v.trim() : v);
const cleanList = (v) => (Array.isArray(v) ? v.map(clean).filter(Boolean) : []);

function validateTopic(d, slugs) {
  const errors = [];
  const out = {};
  for (const k of Object.keys(d)) if (!TOPIC_KEYS.includes(k)) delete d[k];

  out.title = clean(d.title); if (!str(out.title)) errors.push('Title is required.');
  out.order = Number(d.order); if (!Number.isFinite(out.order)) errors.push('Order must be a number.');
  out.icon = d.icon; if (!ICONS.includes(out.icon)) errors.push('Pick an icon.');
  out.hook = clean(d.hook); if (!str(out.hook)) errors.push('The one-line hook is required.');
  out.description = clean(d.description); if (!str(out.description)) errors.push('Description is required.');
  out.quickFacts = cleanList(d.quickFacts); if (out.quickFacts.length < 2) errors.push('Add at least 2 quick facts.');
  if (str(d.signsTitle)) out.signsTitle = clean(d.signsTitle);
  out.signs = cleanList(d.signs); if (out.signs.length < 1) errors.push('Add at least 1 item under signs.');
  if (str(d.signsNote)) out.signsNote = clean(d.signsNote);
  out.actions = cleanList(d.actions); if (out.actions.length < 3 || out.actions.length > 5) errors.push('"What you can do today" needs 3 to 5 tips.');
  if (str(d.doctorTitle)) out.doctorTitle = clean(d.doctorTitle);
  out.doctor = cleanList(d.doctor); if (out.doctor.length < 1) errors.push('Add at least 1 item under "When to see a doctor".');
  if (str(d.emergency)) out.emergency = clean(d.emergency);
  if (d.bonus && str(d.bonus.title)) {
    out.bonus = {
      ...(str(d.bonus.tag) ? { tag: clean(d.bonus.tag) } : {}),
      title: clean(d.bonus.title),
      ...(str(d.bonus.intro) ? { intro: clean(d.bonus.intro) } : {}),
      items: cleanList(d.bonus.items),
    };
    if (!out.bonus.items.length) errors.push('The bonus box needs at least 1 item (or clear its title to remove it).');
  }
  out.links = (Array.isArray(d.links) ? d.links : [])
    .map((l) => ({ title: clean(l.title), org: clean(l.org), url: clean(l.url), ...(str(l.note) ? { note: clean(l.note) } : {}) }))
    .filter((l) => l.title || l.url);
  if (out.links.length < 3 || out.links.length > 6) errors.push('Helpful links: use 3 to 6 links.');
  out.links.forEach((l, i) => {
    if (!str(l.title) || !str(l.org)) errors.push(`Link ${i + 1} needs a title and an organization.`);
    if (!isUrl(l.url)) errors.push(`Link ${i + 1} needs a full web address starting with https://`);
  });
  out.related = cleanList(d.related).filter((s) => slugs.includes(s));
  return { errors, data: out };
}

function validateEvents(d) {
  const errors = [];
  if (!d || !Array.isArray(d.events)) return { errors: ['Events list is missing.'] };
  const events = d.events.map((e, i) => {
    const ev = { title: clean(e.title), date: clean(e.date), time: clean(e.time) || '', location: clean(e.location) || '', description: clean(e.description) || '' };
    if (e.todo) ev.todo = true;
    if (!str(ev.title)) errors.push(`Event ${i + 1} needs a title.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ev.date || '') || Number.isNaN(Date.parse(ev.date))) errors.push(`Event ${i + 1} needs a valid date.`);
    return ev;
  });
  return { errors, data: { ...(d._howto ? { _howto: d._howto } : {}), events } };
}

function validateResources(d) {
  const errors = [];
  if (!d || !Array.isArray(d.groups)) return { errors: ['Resource groups are missing.'] };
  d.groups.forEach((g, gi) => {
    if (!str(g.title) || !str(g.id)) errors.push(`Group ${gi + 1} needs a title.`);
    (g.items || []).forEach((r, ri) => {
      if (!str(r.name)) errors.push(`"${g.title}" item ${ri + 1} needs a name.`);
      if (r.url && !isUrl(r.url)) errors.push(`"${r.name || 'Item ' + (ri + 1)}" has a web address that doesn't start with https://`);
      (r.phones || []).forEach((p) => { if (!/^\d{3,15}$/.test(String(p.tel || ''))) errors.push(`"${r.name}" has a phone number with letters or symbols in the dial-able part.`); });
    });
  });
  return { errors, data: d };
}

// ---- handler -----------------------------------------------------------------

export default async (req) => {
  const session = readSession(req);
  if (!session) return json({ error: 'Please sign in again.' }, 401);
  const { role } = session;

  try {
    if (req.method === 'GET') {
      const q = new URL(req.url).searchParams;
      const action = q.get('action');

      if (action === 'me') return json({ role, roleLabel: ROLES[role].label });

      if (action === 'topics') {
        const files = await gh(`/contents/${TOPIC_DIR}?ref=${BRANCH}`);
        const topics = await Promise.all(
          files.filter((f) => f.name.endsWith('.md')).map(async (f) => {
            const { data } = splitFrontmatter((await readFile(f.path)).content);
            return { slug: f.name.replace(/\.md$/, ''), path: f.path, title: data.title, order: data.order ?? 99 };
          })
        );
        return json(topics.sort((a, b) => a.order - b.order));
      }

      if (action === 'tree') {
        if (role !== 'developer') return json({ error: 'Developer only.' }, 403);
        const t = await gh(`/git/trees/${BRANCH}?recursive=1`);
        return json(t.tree.filter((n) => n.type === 'blob' && canEdit(role, n.path)).map((n) => n.path));
      }

      if (action === 'get') {
        const path = q.get('path');
        if (!canEdit(role, path)) return json({ error: "You don't have access to that file." }, 403);
        const f = await readFile(path);
        const kind = q.get('raw') === '1' ? 'text' : kindFor(path);
        if (kind === 'topic') return json({ kind, sha: f.sha, ...splitFrontmatter(f.content) });
        if (kind === 'json') return json({ kind, sha: f.sha, data: JSON.parse(f.content) });
        return json({ kind, sha: f.sha, content: f.content });
      }

      return json({ error: 'Unknown action' }, 400);
    }

    if (req.method === 'POST') {
      const b = await req.json();
      if (b.action !== 'save') return json({ error: 'Unknown action' }, 400);
      const { path } = b;
      if (!canEdit(role, path)) return json({ error: "You don't have access to that file." }, 403);
      if (!b.sha && role !== 'developer') return json({ error: 'Only the developer can create new files.' }, 403);

      let content;
      let errors = [];
      if (b.kind === 'topic') {
        const files = await gh(`/contents/${TOPIC_DIR}?ref=${BRANCH}`);
        const slugs = files.map((f) => f.name.replace(/\.md$/, ''));
        const v = validateTopic(b.data || {}, slugs);
        errors = v.errors;
        if (!str(b.body)) errors.push('The explainer text (Markdown) is empty.');
        content = joinFrontmatter(v.data, b.body);
      } else if (b.kind === 'json') {
        const v = path.endsWith('events.json') ? validateEvents(b.data) : path.endsWith('resources.json') ? validateResources(b.data) : { errors: [], data: b.data };
        errors = v.errors;
        content = JSON.stringify(v.data, null, 2) + '\n';
      } else {
        if (role !== 'developer') return json({ error: 'Developer only.' }, 403);
        content = String(b.content ?? '');
        if (path.endsWith('.json')) { try { JSON.parse(content); } catch (e) { errors.push(`That isn't valid JSON: ${e.message}`); } }
        if (kindFor(path) === 'topic') { try { splitFrontmatter(content); } catch (e) { errors.push(`Frontmatter problem: ${e.message}`); } }
      }
      if (errors.length) return json({ error: 'Please fix these first:', details: errors }, 422);

      const note = String(b.note || '').slice(0, 120).replace(/\s+/g, ' ').trim();
      const message = `Admin edit: ${path.split('/').pop()}${note ? ` (${note})` : ''}`;
      const saved = await writeFile(path, content, b.sha, message, role);
      return json(saved);
    }

    return json({ error: 'Method not allowed' }, 405);
  } catch (e) {
    console.error(e);
    if (e.status === 409 || /does not match/i.test(e.message)) {
      return json({ error: 'Someone else saved this file since you opened it. Reload it, then make your change again.' }, 409);
    }
    if (/ADMIN_GITHUB_TOKEN/.test(e.message)) return json({ error: 'Saving is not set up yet (the GitHub key is missing on Netlify).' }, 500);
    if (e.status === 401 || e.status === 403) return json({ error: 'GitHub refused the request. The GitHub key on Netlify may have expired.' }, 502);
    return json({ error: e.message || 'Something went wrong.' }, 500);
  }
};
