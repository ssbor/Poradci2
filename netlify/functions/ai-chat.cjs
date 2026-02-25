/**
 * Netlify Function: AI chat for advisor.
 *
 * Provider selection:
 * - AI_PROVIDER=gemini|openai (optional, default: gemini)
 *
 * Gemini (default):
 * - GEMINI_API_KEY (required)
 * - GEMINI_MODEL (optional, default: gemini-1.5-flash)
 *
 * OpenAI (legacy fallback):
 * - OPENAI_API_KEY (required when AI_PROVIDER=openai)
 * - OPENAI_MODEL (optional, default: gpt-4o-mini)
 */

const AI_PROVIDER = (process.env.AI_PROVIDER || 'gemini').trim().toLowerCase();
const DEFAULT_OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const DEFAULT_GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

let OFFERS_CACHE = {
  at: 0,
  built_at: '',
  offers: null
};

let SCHOOLS_CACHE = {
  at: 0,
  built_at: '',
  schools: null
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

function normalizeProgramCode(s) {
  return String(s || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^0-9A-Z\/-]+/g, '');
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

async function loadSchoolsFromSite(event) {
  const now = Date.now();
  if (SCHOOLS_CACHE.schools && now - SCHOOLS_CACHE.at < 30 * 60 * 1000) return SCHOOLS_CACHE;

  const proto = String(event?.headers?.['x-forwarded-proto'] || 'https');
  const host = String(event?.headers?.host || '').trim();
  if (!host) return SCHOOLS_CACHE;
  const base = `${proto}://${host}`;

  const resp = await fetch(`${base}/data/skoly_index.json`, {
    headers: { 'cache-control': 'no-cache' }
  });
  if (!resp.ok) return SCHOOLS_CACHE;
  const data = await resp.json();
  const schools = Array.isArray(data?.schools) ? data.schools : [];
  SCHOOLS_CACHE = {
    at: now,
    built_at: String(data?.built_at || ''),
    schools
  };
  return SCHOOLS_CACHE;
}

function labelForma(id) {
  const s = String(id || '');
  const k = s.includes('/') ? s.split('/').pop() : s;
  const m = {
    prez: 'Prezenční',
    den: 'Denní',
    komb: 'Kombinované',
    dal: 'Dálkové',
    vec: 'Večerní',
    dist: 'Distanční',
    jina: 'Jiná'
  };
  return m[k] || k || '';
}

function labelStupen(id) {
  const s = String(id || '');
  const k = s.includes('/') ? s.split('/').pop() : s;
  const m = {
    vyucni: 'Výuční list',
    maturit: 'Maturita',
    bakal: 'Bakalář',
    magis: 'Magistr',
    doktor: 'Doktor'
  };
  return m[k] || k || '';
}

function recommendSchools(schools, search) {
  const qRaw = String(search?.q || '').trim();
  const q = normalizeText(qRaw);
  const tokens = tokensFromQuery(q);
  const nuts3 = String(search?.kraj || '').trim(); // we use NUTS3 here
  const codeLike = normalizeProgramCode(qRaw);

  if (!tokens.length && !codeLike) return [];

  const out = [];
  for (const s of schools) {
    if (nuts3 && String(s?.adresa?.nuts3 || '').trim() !== nuts3) continue;

    const schoolTxt = normalizeText([s?.nk, s?.name, s?.adresa?.obec, s?.adresa?.kraj, s?.adresa?.nuts3].filter(Boolean).join(' | '));

    let schoolScore = 0;
    for (const t of tokens) {
      if (schoolTxt.includes(t)) schoolScore += 3;
    }

    const programs = Array.isArray(s?.programs) ? s.programs : [];
    let best = null;
    for (const p of programs) {
      const pTxt = normalizeText([p?.nk, p?.name, p?.code, p?.forma, p?.stupen].filter(Boolean).join(' | '));
      let pScore = 0;
      for (const t of tokens) {
        if (pTxt.includes(t)) pScore += 8;
      }
      if (codeLike) {
        const pc = normalizeProgramCode(p?.code);
        if (pc && codeLike === pc) pScore += 30;
        else if (pc && codeLike.includes(pc)) pScore += 10;
        else if (pc && pc.includes(codeLike)) pScore += 12;
      }
      if (pScore <= 0) continue;
      if (!best || pScore > best.score) best = { p, score: pScore };
    }

    const total = schoolScore + (best ? best.score : 0);
    if (total <= 0) continue;
    out.push({ s, p: best?.p || null, score: total });
  }

  out.sort((a, b) => b.score - a.score);
  return out.slice(0, 5).map(({ s, p }) => ({
    school_id: String(s?.id || ''),
    school_name: String(s?.name || ''),
    obec: String(s?.adresa?.obec || ''),
    kraj: String(s?.adresa?.kraj || ''),
    nuts3: String(s?.adresa?.nuts3 || ''),
    url: String(s?.url || ''),
    program_name: String(p?.name || ''),
    program_code: String(p?.code || ''),
    delka: p?.delka ?? null,
    forma: labelForma(p?.forma),
    stupen: labelStupen(p?.stupen),
    ukonceni: String(p?.ukonceni || '')
  }));
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

function stripJsonFromText(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  // Handle ```json ... ``` fences
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const txt = fenced ? String(fenced[1] || '').trim() : s;
  // Try to extract the first JSON object if extra text leaked.
  const firstObj = txt.match(/\{[\s\S]*\}/);
  return (firstObj ? firstObj[0] : txt).trim();
}

async function listGeminiModels(geminiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(geminiKey)}`;
  const resp = await fetch(url, { method: 'GET' });
  if (!resp.ok) return null;
  const data = await resp.json().catch(() => null);
  const models = Array.isArray(data?.models) ? data.models : [];
  // Trim for safe UI display.
  return models.slice(0, 50).map((m) => ({
    name: String(m?.name || ''),
    displayName: String(m?.displayName || ''),
    methods: Array.isArray(m?.supportedGenerationMethods) ? m.supportedGenerationMethods : []
  }));
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

  const openAiKey = process.env.OPENAI_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  const provider = AI_PROVIDER === 'openai' ? 'openai' : 'gemini';

  if (provider === 'openai' && !openAiKey) {
    return json(
      501,
      {
        error: 'AI is not configured (missing OPENAI_API_KEY).',
        provider,
        model: DEFAULT_OPENAI_MODEL,
        hint: 'Set OPENAI_API_KEY in Netlify Site settings → Build & deploy → Environment variables.'
      },
      { 'access-control-allow-origin': '*' }
    );
  }

  if (provider === 'gemini' && !geminiKey) {
    return json(
      501,
      {
        error: 'AI is not configured (missing GEMINI_API_KEY).',
        provider,
        model: DEFAULT_GEMINI_MODEL,
        hint: 'Set GEMINI_API_KEY in Netlify Site settings → Build & deploy → Environment variables.'
      },
      { 'access-control-allow-origin': '*' }
    );
  }

  const parsed = safeParseJson(event.body || '{}');
  if (!parsed.ok) {
    return json(400, { error: 'Invalid JSON body.' }, { 'access-control-allow-origin': '*' });
  }

  const body = parsed.value || {};
  const modeRaw = String(body?.mode || 'all').trim();
  const mode = ['all', 'jobs', 'edu', 'courses'].includes(modeRaw) ? modeRaw : 'all';
  const context = body?.context && typeof body.context === 'object' ? body.context : {};
  const messages = clampMessages(body?.messages);

  const system = {
    role: 'system',
    content:
      'Jsi chytrý poradce pro web SŠ Bor. ' +
      'Režim je daný polem mode: all (vše), jobs (pracovní nabídky), edu (vzdělání/školy), courses (kurzy). ' +
      'Chovej se jako SPECIALISTA podle režimu: ' +
      '- jobs: doptávej se na lokalitu (město/kraj), dojezd, mzdu, úvazek, praxi, dovednosti. ' +
      '- edu: doptávej se na úroveň (výuční list/maturita/VOŠ/VŠ), obor, kraj/město, formu (denní/dálková/kombinovaná), a zda jde o nástavbu nebo změnu oboru. ' +
      '- courses: doptávej se na cíl (rekvalifikace vs doplnění), časové možnosti, rozpočet a lokalitu/online. ' +
      'Důležité: nepřepínej stránku ani nenařizuj proklik; jen konverzuj a doptávej se. ' +
      'Vždy odpovídej ČESKY. ' +
      'V odpovědi vrať POUZE JSON objekt (bez markdownu). ' +
      'Drž se schématu: ' +
      '{"reply":string,"profile":{...},"search":{"q":string,"kraj":string|null,"place":string|null,"minMzda":number|null,"dojezdKm":number|null},"follow_up":string|null}. ' +
      'V edu/courses můžeš použít search.q pro klíčová slova (obor/škola/kraj/forma), i když nejde o práci.'
  };

  const ctxMsg = {
    role: 'system',
    content: `Kontext stránky: ${JSON.stringify(
      {
        mode,
        page: String(context?.page || ''),
        built_at: String(context?.built_at || ''),
        note: 'search parametry se používají pro prace.html (jobs).'
      },
      null,
      0
    )}`
  };

  const reqMessages = [system, ctxMsg, ...messages];

  try {
    let content = '';

    if (provider === 'openai') {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${openAiKey}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: DEFAULT_OPENAI_MODEL,
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
            provider,
            model: DEFAULT_OPENAI_MODEL,
            details: text.slice(0, 2000)
          },
          { 'access-control-allow-origin': '*' }
        );
      }

      const data = await resp.json();
      content =
        data?.choices?.[0]?.message?.content ||
        data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments ||
        '';
    } else {
      // Gemini: use systemInstruction + contents, request JSON output.
      const geminiModel = DEFAULT_GEMINI_MODEL;
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        geminiModel
      )}:generateContent?key=${encodeURIComponent(geminiKey)}`;

      const systemText = String(system?.content || '') + '\n' + String(ctxMsg?.content || '');
      const contents = messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: String(m.content || '') }]
      }));

      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemText }] },
          contents,
          generationConfig: {
            temperature: 0.2,
            responseMimeType: 'application/json'
          }
        })
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        let available_models = null;
        try {
          if (resp.status === 404) available_models = await listGeminiModels(geminiKey);
        } catch {
          // ignore list models failure
        }
        return json(
          502,
          {
            error: 'Upstream AI error.',
            status: resp.status,
            provider,
            model: geminiModel,
            details: text.slice(0, 2000),
            hint:
              resp.status === 404
                ? 'Gemini model was not found or does not support generateContent. Set GEMINI_MODEL to one of the available model names that supports generateContent (see available_models).' 
                : undefined,
            available_models
          },
          { 'access-control-allow-origin': '*' }
        );
      }

      const data = await resp.json();
      const parts = data?.candidates?.[0]?.content?.parts;
      content = Array.isArray(parts) ? parts.map((p) => p?.text || '').join('') : '';
    }

    const jsonText = stripJsonFromText(content);
    const outParsed = safeParseJson(jsonText);
    if (!outParsed.ok) {
      return json(
        502,
        { error: 'AI returned non-JSON output.', context: String(content || '').slice(0, 500) },
        { 'access-control-allow-origin': '*' }
      );
    }

    const out = outParsed.value || {};
    let recommendations = [];
    let edu_recommendations = [];
    let actions = [];
    try {
      const cache = await loadOffersFromSite(event);
      const offers = Array.isArray(cache?.offers) ? cache.offers : [];
      if (mode === 'jobs' && offers.length && out?.search) recommendations = recommendOffers(offers, out.search);
    } catch {
      // ignore recommendations errors
    }

    try {
      if (mode === 'edu' && out?.search) {
        const cache = await loadSchoolsFromSite(event);
        const schools = Array.isArray(cache?.schools) ? cache.schools : [];
        if (schools.length) edu_recommendations = recommendSchools(schools, out.search);
      }
    } catch {
      // ignore edu recommendations errors
    }

    const followUpTxt = String(out?.follow_up || '').trim();
    const hasAnySearch =
      !!out?.search &&
      (String(out.search.q || '').trim() ||
        String(out.search.kraj || '').trim() ||
        String(out.search.place || '').trim() ||
        (out.search.minMzda != null && Number(out.search.minMzda) > 0) ||
        (out.search.dojezdKm != null && Number(out.search.dojezdKm) > 0));

    // UX: show redirect actions only once the assistant is not asking more questions.
    const okToShowActions = !followUpTxt && (mode !== 'jobs' || hasAnySearch);

    if (okToShowActions) {
      if (mode === 'edu') {
        actions = [{ label: 'Otevřít vzdělání', url: 'vzdelani.html' }];
      } else if (mode === 'courses') {
        actions = [{ label: 'Otevřít kurzy', url: 'kurzy.html' }];
      } else if (mode === 'jobs') {
        actions = [{ label: 'Otevřít pracovní nabídky', url: 'prace.html#hledani' }];
      } else {
        // all
        actions = [
          { label: 'Pracovní nabídky', url: 'prace.html#hledani' },
          { label: 'Vzdělání', url: 'vzdelani.html' },
          { label: 'Kurzy', url: 'kurzy.html' }
        ];
      }
    }

    return json(200, { ...out, mode, recommendations, edu_recommendations, actions }, { 'access-control-allow-origin': '*' });
  } catch (e) {
    return json(500, { error: 'Server error.', details: String(e?.message || e) }, { 'access-control-allow-origin': '*' });
  }
};
