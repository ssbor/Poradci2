/**
 * Netlify Function: AI chat for job search.
 *
 * Env vars:
 * - OPENAI_API_KEY (required)
 * - OPENAI_MODEL (optional, default: gpt-4o-mini)
 */

const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

let OFFERS_CACHE = {
  at: 0,
  built_at: '',
  offers: null
};

function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}+/gu, '')
    .replace(/[^a-z0-9\s,.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokensFromQuery(q) {
  const t = normalizeText(q)
    .split(/[\s,]+/g)
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((x) => x.length >= 2);
  return Array.from(new Set(t)).slice(0, 12);
}

function comparableDateKey(raw) {
  const s = String(raw || '').trim();
  if (!s) return 0;
  const d = new Date(s);
  const n = d.getTime();
  return Number.isFinite(n) ? n : 0;
}

function offerText(o) {
  return normalizeText(
    [
      o?.profese,
      o?.zamestnavatel,
      o?.obec,
      o?.okres,
      o?.lokalita,
      o?.kraj_nazev,
      o?.cz_isco,
      o?.cz_isco_code
    ]
      .filter(Boolean)
      .join(' | ')
  );
}

function offerDetailUrl(o) {
  const direct = String(o?.url_adresa ?? o?.urlAdresa ?? o?.url ?? o?.detail_url ?? '').trim();
  if (/^https?:\/\//i.test(direct)) return direct;
  const pidRaw = o?.portal_id ?? o?.portalId;
  const pid = pidRaw == null ? '' : String(pidRaw).trim();
  if (pid) return `https://www.uradprace.cz/volna-mista-v-cr#/volna-mista-detail/${encodeURIComponent(pid)}`;
  return '';
}

function mzdaText(o) {
  const a = o?.mzda_od != null ? Number(o.mzda_od) : null;
  const b = o?.mzda_do != null ? Number(o.mzda_do) : null;
  if (Number.isFinite(a) && Number.isFinite(b) && a && b) return `${Math.round(a)}–${Math.round(b)} Kč`;
  if (Number.isFinite(a) && a) return `od ${Math.round(a)} Kč`;
  if (Number.isFinite(b) && b) return `do ${Math.round(b)} Kč`;
  return '';
}

async function loadOffersFromSite(event) {
  const now = Date.now();
  if (OFFERS_CACHE.offers && now - OFFERS_CACHE.at < 10 * 60 * 1000) return OFFERS_CACHE;

  const proto = String(event?.headers?.['x-forwarded-proto'] || 'https');
  const host = String(event?.headers?.host || '').trim();
  if (!host) return OFFERS_CACHE;
  const base = `${proto}://${host}`;

  const resp = await fetch(`${base}/data/all_min.json`, {
    headers: { 'cache-control': 'no-cache' }
  });
  if (!resp.ok) return OFFERS_CACHE;
  const data = await resp.json();
  const offers = Array.isArray(data?.offers) ? data.offers : [];
  OFFERS_CACHE = {
    at: now,
    built_at: String(data?.built_at || ''),
    offers
  };
  return OFFERS_CACHE;
}

function recommendOffers(offers, search) {
  const q = String(search?.q || '').trim();
  const kraj = String(search?.kraj || '').trim();
  const minMzda = search?.minMzda != null ? Number(search.minMzda) : 0;
  const tokens = tokensFromQuery(q);

  const out = [];
  for (const o of offers) {
    if (kraj && String(o?.kraj || '').trim() !== kraj) continue;

    if (minMzda) {
      const a = o?.mzda_od != null ? Number(o.mzda_od) : null;
      const b = o?.mzda_do != null ? Number(o.mzda_do) : null;
      const ok = (Number.isFinite(a) && a >= minMzda) || (Number.isFinite(b) && b >= minMzda);
      if (!ok) continue;
    }

    const txt = offerText(o);
    let score = 0;
    for (const t of tokens) {
      if (txt.includes(t)) score += 6;
    }

    const title = normalizeText(o?.profese || '');
    for (const t of tokens) {
      if (title && title.includes(t)) score += 6;
    }

    const a = o?.mzda_od != null ? Number(o.mzda_od) : null;
    if (Number.isFinite(a) && a) score += 2;

    if (comparableDateKey(o?.datum_zmeny || o?.datum_vlozeni)) score += 1;

    if (score <= 0) continue;
    out.push({ o, score });
  }

  out.sort((x, y) => y.score - x.score || comparableDateKey(y.o?.datum_zmeny) - comparableDateKey(x.o?.datum_zmeny));
  return out.slice(0, 5).map(({ o }) => ({
    profese: String(o?.profese || ''),
    zamestnavatel: String(o?.zamestnavatel || ''),
    obec: String(o?.obec || ''),
    lokalita: String(o?.lokalita || ''),
    kraj: String(o?.kraj || ''),
    mzda_od: o?.mzda_od ?? null,
    mzda_do: o?.mzda_do ?? null,
    mzda_text: mzdaText(o),
    portal_id: o?.portal_id ?? null,
    url_adresa: offerDetailUrl(o)
  }));
}

function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders
    },
    body: JSON.stringify(body)
  };
}

function safeParseJson(str) {
  try {
    return { ok: true, value: JSON.parse(str) };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

function clampMessages(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const m of arr.slice(-20)) {
    const role = String(m?.role || '').trim();
    const content = String(m?.content || '').trim();
    if (!content) continue;
    if (role !== 'user' && role !== 'assistant' && role !== 'system') continue;
    out.push({ role, content });
  }
  return out;
}

exports.handler = async function handler(event) {
  // CORS / preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' }, { 'access-control-allow-origin': '*' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return json(
      501,
      {
        error: 'AI is not configured (missing OPENAI_API_KEY).',
        hint:
          'Set OPENAI_API_KEY in Netlify Site settings → Build & deploy → Environment variables.'
      },
      { 'access-control-allow-origin': '*' }
    );
  }

  const parsed = safeParseJson(event.body || '{}');
  if (!parsed.ok) {
    return json(400, { error: 'Invalid JSON body.' }, { 'access-control-allow-origin': '*' });
  }

  const body = parsed.value || {};
  const mode = String(body?.mode || 'jobs').trim();
  const context = body?.context && typeof body.context === 'object' ? body.context : {};
  const messages = clampMessages(body?.messages);

  const system = {
    role: 'system',
    content:
      'Jsi kariérový poradce a asistent pro vyhledávání práce v ČR. ' +
      'Cíl: z textu uživatele vytěžit informace o vzdělání, zkušenostech, dovednostech a preferencích a převést je na parametry vyhledávání práce. ' +
      'Vždy se snaž 1–2 doplňujícími otázkami upřesnit: lokalitu (město/kraj), dojezd, očekávanou mzdu, typ úvazku a relevantní praxi. ' +
      'Nepřepínej stránku ani neříkej, že se má uživatel někam prokliknout; jen konverzuj. ' +
      'Vždy odpovídej ČESKY. ' +
      'V odpovědi vrať POUZE JSON objekt (bez markdownu). ' +
      'Drž se schématu: ' +
      '{"reply":string,"profile":{...},"search":{...},"follow_up":string|null}. ' +
      'Pole search: {"q":string,"kraj":string|null,"place":string|null,"minMzda":number|null,"dojezdKm":number|null}. ' +
      'kraj používej jako kód NUTS3 (např. CZ032) nebo null. ' +
      'Pokud si nejsi jistý lokalitou, nech place/kraj null a zeptej se ve follow_up.'
  };

  const ctxMsg = {
    role: 'system',
    content: `Kontext stránky: ${JSON.stringify(
      {
        mode,
        page: String(context?.page || ''),
        built_at: String(context?.built_at || ''),
        note: 'Parametry hledání se použijí na stránce prace.html.'
      },
      null,
      0
    )}`
  };

  const reqMessages = [system, ctxMsg, ...messages];

  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: reqMessages
      })
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      return json(
        502,
        {
          error: 'Upstream AI error.',
          status: resp.status,
          details: text.slice(0, 2000)
        },
        { 'access-control-allow-origin': '*' }
      );
    }

    const data = await resp.json();
    const content =
      data?.choices?.[0]?.message?.content ||
      data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments ||
      '';

    const outParsed = safeParseJson(content);
    if (!outParsed.ok) {
      return json(
        502,
        { error: 'AI returned non-JSON output.', context: content.slice(0, 500) },
        { 'access-control-allow-origin': '*' }
      );
    }

    const out = outParsed.value || {};
    let recommendations = [];
    try {
      const cache = await loadOffersFromSite(event);
      const offers = Array.isArray(cache?.offers) ? cache.offers : [];
      if (offers.length && out?.search) recommendations = recommendOffers(offers, out.search);
    } catch {
      // ignore recommendations errors
    }

    return json(200, { ...out, recommendations }, { 'access-control-allow-origin': '*' });
  } catch (e) {
    return json(500, { error: 'Server error.', details: String(e?.message || e) }, { 'access-control-allow-origin': '*' });
  }
};
