// Netlify Function: GET /.netlify/functions/health-topic?topic=blood-pressure&lang=en
//
// Pulls live content from two free U.S. government APIs (no API keys needed):
//   A) MyHealthfinder v4 (health.gov)       -> one full topic
//   B) MedlinePlus Health Topics (NLM)     -> up to 5 search results
// Returns { topic, lang, healthfinder, medlineplus, errors }.
// If an API fails, its field is null / [] and the page falls back to our own content.

import topicMap from '../../src/data/topicMap.json' with { type: 'json' };

const HF_BASE = 'https://odphp.health.gov/myhealthfinder/api/v4/';
const MEDLINE_BASE = 'https://wsearch.nlm.nih.gov/ws/query';
const TIMEOUT_MS = 8000;
const ONE_DAY = 60 * 60 * 24;

// ---- small helpers ---------------------------------------------------------

async function fetchWithTimeout(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'User-Agent': 'ClydeCmPS-HealthSite/1.0 (student project)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res;
}

function decodeEntities(str = '') {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
}

function stripTags(html = '') {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function truncate(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(' ')) + '…';
}

// Keep only simple, safe tags from MyHealthfinder HTML (no scripts, styles, or attributes except href).
function sanitizeHtml(html = '') {
  const allowed = new Set(['p', 'ul', 'ol', 'li', 'strong', 'em', 'b', 'i', 'h4', 'h5', 'a', 'br']);
  return html
    .replace(/<(script|style|iframe|object)[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/?([a-z0-9]+)([^>]*)>/gi, (match, tag, attrs) => {
      tag = tag.toLowerCase();
      if (!allowed.has(tag)) return '';
      if (match.startsWith('</')) return `</${tag}>`;
      if (tag === 'a') {
        const href = /href\s*=\s*"([^"]*)"/i.exec(attrs)?.[1] ?? '';
        if (!/^https?:\/\//i.test(href)) return '<a>';
        return `<a href="${href}" target="_blank" rel="noopener noreferrer">`;
      }
      return `<${tag}>`;
    })
    .replace(/<a>([\s\S]*?)<\/a>/g, '$1');
}

// ---- A) MyHealthfinder ------------------------------------------------------

async function getHealthfinder(topicId, lang) {
  if (!topicId) return null; // no matching topic; that's okay
  const url = `${HF_BASE}topicsearch.json?TopicId=${topicId}${lang === 'es' ? '&Lang=es' : ''}`;
  const data = await (await fetchWithTimeout(url)).json();
  const r = data?.Result;
  if (!r || r.Error === 'True') throw new Error('MyHealthfinder returned an error');
  const item = r.Resources?.Resource?.[0];
  if (!item) throw new Error('MyHealthfinder returned no topic');

  // Only "The Basics" sections — short enough to read on a phone.
  const all = item.Sections?.section ?? [];
  const basics = all.filter((s) => /^(The Basics|Lo básico)/i.test(s.Title));
  const sections = (basics.length ? basics : all)
    .slice(0, 2)
    .map((s) => ({
      title: s.Title.replace(/^(The Basics|Lo básico):\s*/i, ''),
      html: sanitizeHtml(s.Content),
    }));

  return {
    id: item.Id,
    title: item.Title,
    image: item.ImageUrl || null,
    imageAlt: item.ImageAlt || '',
    url: item.AccessibleVersion,
    lastUpdate: item.LastUpdate ? new Date(Number(item.LastUpdate) * 1000).toISOString() : null,
    sections,
    source: 'MyHealthfinder, U.S. Department of Health and Human Services (health.gov)',
  };
}

// ---- B) MedlinePlus ---------------------------------------------------------

function parseMedlineXml(xml) {
  const docs = [];
  const docRe = /<document[^>]*\burl="([^"]+)"[^>]*>([\s\S]*?)<\/document>/g;
  let m;
  while ((m = docRe.exec(xml))) {
    const [, url, body] = m;
    const field = (name) => {
      const f = new RegExp(`<content name="${name}">([\\s\\S]*?)</content>`).exec(body);
      return f ? stripTags(decodeEntities(f[1])) : '';
    };
    const summary = field('FullSummary') || field('snippet');
    docs.push({
      title: field('title'),
      url: decodeEntities(url),
      summary: truncate(summary, 280),
    });
  }
  return docs;
}

async function getMedline(term, lang) {
  if (!term) return [];
  const db = lang === 'es' ? 'healthTopicsSpanish' : 'healthTopics';
  const url = `${MEDLINE_BASE}?db=${db}&term=${encodeURIComponent(term)}&retmax=5`;
  const xml = await (await fetchWithTimeout(url)).text();
  return parseMedlineXml(xml).filter((d) => d.title && d.url);
}

// ---- handler -----------------------------------------------------------------

function json(body, status, cacheSeconds) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  if (cacheSeconds > 0) {
    // Browser keeps it 1 hour; Netlify's CDN keeps it 24 hours (protects the API rate limits).
    headers['Cache-Control'] = 'public, max-age=3600';
    headers['Netlify-CDN-Cache-Control'] = `public, s-maxage=${cacheSeconds}, stale-while-revalidate=${ONE_DAY}`;
    headers['Netlify-Vary'] = 'query=topic|lang';
  } else {
    headers['Cache-Control'] = 'no-store';
  }
  return new Response(JSON.stringify(body), { status, headers });
}

export default async (req) => {
  const params = new URL(req.url).searchParams;
  const topic = (params.get('topic') || '').toLowerCase();
  const lang = params.get('lang') === 'es' ? 'es' : 'en';

  const entry = topicMap[topic];
  if (!entry || topic.startsWith('_')) {
    return json({ error: `Unknown topic "${topic}"` }, 404, 0);
  }

  const [hf, ml] = await Promise.allSettled([
    getHealthfinder(entry.healthfinderId, lang),
    getMedline(lang === 'es' ? entry.medlineTermEs : entry.medlineTerm, lang),
  ]);

  const errors = [];
  if (hf.status === 'rejected') errors.push({ source: 'healthfinder', message: String(hf.reason?.message ?? hf.reason) });
  if (ml.status === 'rejected') errors.push({ source: 'medlineplus', message: String(ml.reason?.message ?? ml.reason) });

  const body = {
    topic,
    lang,
    healthfinder: hf.status === 'fulfilled' ? hf.value : null,
    medlineplus: ml.status === 'fulfilled' ? ml.value : [],
    errors,
    fetchedAt: new Date().toISOString(),
  };

  // Only cache for a full day when everything worked; cache failures briefly so we retry soon.
  return json(body, 200, errors.length ? 300 : ONE_DAY);
};
