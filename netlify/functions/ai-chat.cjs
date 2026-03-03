/**
 * Netlify Function: AI chat for advisor.
 *
 * Provider selection:
 * - AI_PROVIDER=gemini|openai (optional, default: gemini)
 *
 * Gemini (default):
 * - GEMINI_API_KEY (required)
 * - GEMINI_MODEL (optional, default: gemini-2.5-flash)
 *
 * Prompt tuning:
 * - ADVISOR_STYLE (optional) appended to system instructions
 *
 * OpenAI (legacy fallback):
 * - OPENAI_API_KEY (required when AI_PROVIDER=openai)
 * - OPENAI_MODEL (optional, default: gpt-4o-mini)
 */

const AI_PROVIDER = (process.env.AI_PROVIDER || 'gemini').trim().toLowerCase();
const DEFAULT_OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const DEFAULT_GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const ADVISOR_STYLE = String(process.env.ADVISOR_STYLE || '').trim();

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

let PLACES_CACHE = {
  at: 0,
  built_at: '',
  items: null,
  index: null
};

const STOP_WORDS = new Set([
  'a',
  'i',
  'ne',
  'ze',
  'se',
  'si',
  'ja',
  'ty',
  'on',
  'ona',
  'to',
  'ten',
  'ta',
  'tohle',
  'tahle',
  'toto',
  'mi',
  'me',
  'mne',
  'muj',
  'moje',
  'moji',
  'nas',
  'v',
  've',
  'na',
  'do',
  'od',
  'pro',
  'po',
  'u',
  'z',
  'za',
  'k',
  'ke',
  'bez',
  'o',
  'co',
  'jak',
  'kde',
  'kdy',
  'kolik',
  'proc',
  'proto',
  'chci',
  'chtel',
  'chtela',
  'hledam',
  'hledat',
  'potrebuju',
  'potrebuji',
  'zajima',
  'zajimalo',
  'porad',
  'jen',
  'taky',
  'asi',
  'jako',
  'aby',
  'bych',
  'by',
  'byt',
  'bydleni',
  'ziti',
  // Jobs-specific generic terms we don't want to treat as a "role" token.
  'prace',
  'praci',
  'pozice',
  'nabidka',
  'nabidky',
  'zamestnani',
  'brigada',
  'brigadu',
  'uvazek',
  'plny',
  'castecny'
]);

function normalizeIntent(raw) {
  const v = String(raw || '').trim().toLowerCase();
  return ['jobs', 'edu', 'courses', 'general'].includes(v) ? v : '';
}

function inferIntentFromText(raw) {
  const t = normalizeText(raw);
  if (!t) return '';

  // Order matters: courses/edu keywords can overlap with general career questions.
  if (/(\bkurz\b|rekvalifik|certifik|osvedcen|skolen)/i.test(t)) return 'courses';
  if (/(\bskol\b|\bobor\b|maturit|nastavb|\bvos\b|\bvs\b|vysok|univerzit|fakult|prihlask|ucen|vyuc|stud)/i.test(t)) return 'edu';
  if (/(\bprace\b|zamestnan|\bmzda\b|\bpozic\b|nabidk|brigad|uvazek|pohovor|zivotopis|cv\b)/i.test(t)) return 'jobs';
  return '';
}

function extractProgramCodeFromText(raw) {
  const s = String(raw || '');
  const m = s.match(/\b\d{2}\s*[-–]\s*\d{2}\s*[-–]\s*[A-Za-z]\s*\/\s*\d{2}\b/);
  if (!m) return '';
  return String(m[0] || '').replace(/\s+/g, '').replace(/–/g, '-');
}

function normalizeSearchForAuto(searchRaw, { intent, lastUserMsg }) {
  const search = searchRaw && typeof searchRaw === 'object' ? { ...searchRaw } : {};
  const q = String(search.q || '').trim();

  if (!q && intent && intent !== 'general') {
    const txt = String(lastUserMsg || '').trim();
    if (txt) search.q = txt.slice(0, 180);
  }

  // Help education intent: if user pasted program code, store it.
  if (intent === 'edu') {
    const code = String(search.code || '').trim();
    if (!code) {
      const extracted = extractProgramCodeFromText(lastUserMsg);
      if (extracted) search.code = extracted;
    }
  }
  return search;
}

function hasAnySearch(search) {
  if (!search || typeof search !== 'object') return false;
  const q = String(search.q || '').trim();
  const kraj = String(search.kraj || '').trim();
  const krajId = String(search.krajId || '').trim();
  const place = String(search.place || '').trim();
  const code = String(search.code || '').trim();
  const minMzda = search.minMzda != null ? Number(search.minMzda) : 0;
  const dojezdKm = search.dojezdKm != null ? Number(search.dojezdKm) : 0;
  return (
    !!q ||
    !!code ||
    !!kraj ||
    !!krajId ||
    !!place ||
    (Number.isFinite(minMzda) && minMzda > 0) ||
    (Number.isFinite(dojezdKm) && dojezdKm > 0)
  );
}

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

  const filtered = t.filter((x) => !STOP_WORDS.has(x));
  return Array.from(new Set(filtered.length ? filtered : t)).slice(0, 12);
}

function placeNorm(s) {
  return normalizeText(s)
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function consonantKey(s) {
  const n = placeNorm(s);
  return n.replace(/[aeiouy]/g, '').replace(/\s+/g, '').trim();
}

function pickBetterPlace(a, b, { krajHint } = {}) {
  if (!a) return b;
  if (!b) return a;
  const ak = String(a?.kraj || '').trim();
  const bk = String(b?.kraj || '').trim();
  const hint = String(krajHint || '').trim();
  const aObec = String(a?.t || '') === 'obec' ? 1 : 0;
  const bObec = String(b?.t || '') === 'obec' ? 1 : 0;
  const aHint = hint && ak === hint ? 1 : 0;
  const bHint = hint && bk === hint ? 1 : 0;
  if (aHint !== bHint) return aHint > bHint ? a : b;
  if (aObec !== bObec) return aObec > bObec ? a : b;
  return String(a?.name || '').length <= String(b?.name || '').length ? a : b;
}

function buildPlacesIndex(items) {
  const byName = new Map();
  const bySk = new Map();

  for (const it of items || []) {
    const name = String(it?.name || '').trim();
    if (!name) continue;
    const nn = placeNorm(name);
    if (!nn) continue;
    const sk = consonantKey(nn);
    const rec = { ...it, __nn: nn, __sk: sk };

    const prevByName = byName.get(nn);
    byName.set(nn, pickBetterPlace(prevByName, rec));

    if (sk) {
      const arr = bySk.get(sk) || [];
      arr.push(rec);
      bySk.set(sk, arr);
    }
  }

  return { byName, bySk };
}

async function loadPlacesFromSite(event) {
  const now = Date.now();
  if (PLACES_CACHE.items && PLACES_CACHE.index && now - PLACES_CACHE.at < 60 * 60 * 1000) return PLACES_CACHE;

  const proto = String(event?.headers?.['x-forwarded-proto'] || 'https');
  const host = String(event?.headers?.host || '').trim();
  if (!host) return PLACES_CACHE;
  const base = `${proto}://${host}`;

  try {
    const resp = await fetch(`${base}/data/obce_suggest.json`, {
      headers: { 'cache-control': 'no-cache' }
    });
    if (!resp.ok) return PLACES_CACHE;
    const data = await resp.json();
    const items = Array.isArray(data?.items) ? data.items : [];
    const built_at = String(data?.built_at || '');
    PLACES_CACHE = {
      at: now,
      built_at,
      items,
      index: buildPlacesIndex(items)
    };
    return PLACES_CACHE;
  } catch {
    return PLACES_CACHE;
  }
}

function inferPlaceFromTextUsingIndex(rawText, index, { krajHint } = {}) {
  if (!index) return null;
  const txt = placeNorm(rawText);
  if (!txt) return null;

  const tokens = txt.split(' ').filter(Boolean);
  if (!tokens.length) return null;

  const seen = new Set();
  let best = null;
  let bestScore = 0;

  // Try 3-grams → 1-grams (multi-word places first).
  for (let i = 0; i < tokens.length; i++) {
    for (let len = 3; len >= 1; len--) {
      const phrase = tokens.slice(i, i + len).join(' ').trim();
      if (phrase.length < 2) continue;
      if (seen.has(phrase)) continue;
      seen.add(phrase);

      const nn = placeNorm(phrase);
      if (!nn) continue;

      const exact = index.byName.get(nn) || null;
      if (exact) {
        let score = 100;
        if (krajHint && String(exact?.kraj || '').trim() === String(krajHint || '').trim()) score += 4;
        if (String(exact?.t || '') === 'obec') score += 2;
        if (score > bestScore) {
          bestScore = score;
          best = exact;
        }
        continue;
      }

      const sk = consonantKey(nn);
      if (!sk || sk.length < 3) continue;
      const list = index.bySk.get(sk) || [];
      if (!list.length) continue;

      let picked = null;
      for (const it of list) {
        picked = pickBetterPlace(picked, it, { krajHint });
      }

      if (picked) {
        let score = 60;
        if (krajHint && String(picked?.kraj || '').trim() === String(krajHint || '').trim()) score += 4;
        if (String(picked?.t || '') === 'obec') score += 2;
        // Prefer longer phrases (more specific) when matched.
        score += Math.min(6, len);
        if (score > bestScore) {
          bestScore = score;
          best = picked;
        }
      }
    }
  }

  return best;
}

function deriveJobQueryExcludingPlace(rawText, placeName) {
  const txt = normalizeText(rawText);
  if (!txt) return '';

  const placeTokens = placeNorm(placeName).split(' ').filter(Boolean);
  const placeSk = new Set(placeTokens.map((t) => consonantKey(t)).filter(Boolean));

  const tokens = txt
    .split(/[\s,]+/g)
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((x) => x.length >= 2)
    .filter((x) => !STOP_WORDS.has(x));

  const kept = tokens.filter((t) => {
    const sk = consonantKey(t);
    return sk && !placeSk.has(sk);
  });

  return kept.slice(0, 8).join(' ').trim();
}

async function augmentJobsSearch(event, search, lastUserMsg) {
  const next = search && typeof search === 'object' ? { ...search } : {};
  const krajHint = String(next?.kraj || '').trim();

  let place = String(next?.place || '').trim();
  if (!place) {
    const cache = await loadPlacesFromSite(event);
    const idx = cache?.index || null;
    const inferred = inferPlaceFromTextUsingIndex(lastUserMsg, idx, { krajHint });
    if (inferred?.name) {
      place = String(inferred.name).trim();
      if (place) next.place = place;
    }
  }

  // Default distance: place-only filtering on prace.html needs km to do anything.
  if (place) {
    const km = next?.dojezdKm != null ? Number(next.dojezdKm) : 0;
    if (!Number.isFinite(km) || km <= 0) next.dojezdKm = 5;
  }

  // If query likely contains a location ("v Plzni"), remove it to avoid killing text matching.
  const q = String(next?.q || '').trim();
  if (place && q) {
    const derived = deriveJobQueryExcludingPlace(q, place);
    if (derived && derived.length >= 2) next.q = derived;
  }

  return next;
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

function expandJobTokens(tokens) {
  const t = Array.isArray(tokens) ? tokens.map((x) => String(x || '').trim()).filter(Boolean) : [];
  const out = [...t];
  const has = new Set(out);

  // Common shorthand users mention, but data may contain different wording.
  if (has.has('co2')) {
    for (const x of ['mig', 'mag']) {
      if (!has.has(x)) {
        has.add(x);
        out.push(x);
      }
    }
  }

  return Array.from(new Set(out)).slice(0, 16);
}

function offerMatchesPlace(o, placeNorm) {
  const p = String(placeNorm || '').trim();
  if (!p) return true;

  const obec = normalizeText(o?.obec || '');
  const okres = normalizeText(o?.okres || '');
  const lokalita = normalizeText(o?.lokalita || '');

  if (obec && (obec === p || obec.startsWith(p) || p.startsWith(obec) || obec.includes(p) || p.includes(obec))) return true;
  if (okres && (okres === p || okres.includes(p) || p.includes(okres))) return true;

  // Last resort: address string (can include the city).
  if (lokalita && p.length >= 3 && lokalita.includes(p)) return true;
  return false;
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

function resolveSchoolKrajId(schools, raw) {
  const v = String(raw || '').trim();
  if (!v) return '';

  // If already in the expected id format.
  if (/^Kraj\/[0-9]+$/i.test(v)) return v;

  const n = normalizeText(v);
  if (!n) return '';

  const map = new Map();
  for (const s of Array.isArray(schools) ? schools : []) {
    const id = String(s?.adresa?.krajId || '').trim();
    const name = String(s?.adresa?.kraj || '').trim();
    if (!id || !name) continue;
    map.set(normalizeText(name), id);
  }

  if (map.has(n)) return map.get(n) || '';

  // Fuzzy contains match for user inputs like "plzen".
  for (const [nameN, id] of map.entries()) {
    if (nameN.includes(n) || n.includes(nameN)) return id;
  }
  return '';
}

function recommendSchools(schools, search) {
  const qRaw = String(search?.q || '').trim();
  const q = normalizeText(qRaw);
  const tokens = tokensFromQuery(q);
  const krajId = String(search?.krajId || '').trim();
  const nuts3 = String(search?.nuts3 || '').trim() || (String(search?.kraj || '').trim().startsWith('CZ') ? String(search?.kraj || '').trim() : '');
  const codeLike = normalizeProgramCode(search?.code || '') || normalizeProgramCode(qRaw);

  if (!tokens.length && !codeLike) return [];

  const out = [];
  for (const s of schools) {
    if (krajId && String(s?.adresa?.krajId || '').trim() !== krajId) continue;
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

function countMatchingSchools(schools, search) {
  const qRaw = String(search?.q || '').trim();
  const q = normalizeText(qRaw);
  const tokens = tokensFromQuery(q);
  const codeQuery = normalizeProgramCode(search?.code || '') || normalizeProgramCode(qRaw);
  const krajId = String(search?.krajId || '').trim();

  if (!tokens.length && !codeQuery && !krajId) return 0;

  let n = 0;
  for (const s of Array.isArray(schools) ? schools : []) {
    if (krajId && String(s?.adresa?.krajId || '').trim() !== krajId) continue;

    const schoolTxt = normalizeText(
      [s?.nk, s?.name, s?.adresa?.obec, s?.adresa?.okres, s?.adresa?.kraj].filter(Boolean).join(' | ')
    );

    const schoolHit = tokens.length ? tokens.some((t) => schoolTxt.includes(t)) : false;

    let programHit = false;
    const programs = Array.isArray(s?.programs) ? s.programs : [];
    for (const p of programs) {
      if (codeQuery) {
        const pc = normalizeProgramCode(p?.code);
        if (pc && (pc === codeQuery || pc.includes(codeQuery) || codeQuery.includes(pc))) {
          programHit = true;
          break;
        }
      }
      if (!tokens.length) continue;
      const pTxt = normalizeText([p?.nk, p?.name, p?.code].filter(Boolean).join(' | '));
      for (const t of tokens) {
        if (pTxt.includes(t)) {
          programHit = true;
          break;
        }
      }
      if (programHit) break;
    }

    if (tokens.length || codeQuery) {
      if (schoolHit || programHit) n += 1;
    } else {
      // kraj-only filter: count school.
      if (krajId) n += 1;
    }
  }
  return n;
}

function recommendOffers(offers, search) {
  const q = String(search?.q || '').trim();
  const kraj = String(search?.kraj || '').trim();
  const place = String(search?.place || '').trim();
  const placeN = normalizeText(place);
  const minMzda = search?.minMzda != null ? Number(search.minMzda) : 0;
  const relaxed = Boolean(search?.__relaxed);

  const tokensBase = tokensFromQuery(q);
  const tokens = expandJobTokens(tokensBase);

  const out = [];
  for (const o of offers) {
    if (kraj && String(o?.kraj || '').trim() !== kraj) continue;

    // City-level filtering (server-side). Precise radius filtering happens in prace.html.
    if (placeN && !offerMatchesPlace(o, placeN)) continue;

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

    // If the user provided only location/wage filters, allow matches even without text tokens.
    if (!tokens.length) {
      score = Math.max(score, 1);
    }

    if (score <= 0) continue;
    out.push({ o, score });
  }

  out.sort((x, y) => y.score - x.score || comparableDateKey(y.o?.datum_zmeny) - comparableDateKey(x.o?.datum_zmeny));
  const top = out.slice(0, 5).map(({ o }) => ({
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

  // Fallback: if a too-specific query yields nothing but we do have a place filter,
  // show at least the newest offers in that place so results don't "disappear".
  if (!top.length && placeN && !relaxed && q) {
    const relaxedSearch = { ...(search || {}), q: '', __relaxed: true };
    return recommendOffers(offers, relaxedSearch);
  }

  return top;
}

function countMatchingOffers(offers, search) {
  const q = String(search?.q || '').trim();
  const kraj = String(search?.kraj || '').trim();
  const place = String(search?.place || '').trim();
  const placeN = normalizeText(place);
  const minMzda = search?.minMzda != null ? Number(search.minMzda) : 0;
  const tokens = expandJobTokens(tokensFromQuery(q));

  // If nothing to filter by, don't claim we found "everything".
  if (!tokens.length && !kraj && !minMzda && !placeN) return 0;

  let n = 0;
  for (const o of offers) {
    if (kraj && String(o?.kraj || '').trim() !== kraj) continue;

    if (placeN && !offerMatchesPlace(o, placeN)) continue;

    if (minMzda) {
      const a = o?.mzda_od != null ? Number(o.mzda_od) : null;
      const b = o?.mzda_do != null ? Number(o.mzda_do) : null;
      const ok = (Number.isFinite(a) && a >= minMzda) || (Number.isFinite(b) && b >= minMzda);
      if (!ok) continue;
    }

    // If the user did not provide a query, the filters above are enough.
    if (!tokens.length) {
      n += 1;
      continue;
    }

    const txt = offerText(o);
    const title = normalizeText(o?.profese || '');

    let score = 0;
    for (const t of tokens) {
      if (txt.includes(t)) score += 6;
      if (title && title.includes(t)) score += 6;
    }
    if (score > 0) n += 1;
  }

  // If text tokens were too strict but location/wage filters exist, allow place-only count.
  if (n === 0 && placeN && tokens.length && q) {
    return countMatchingOffers(offers, { ...(search || {}), q: '', __relaxed: true });
  }

  return n;
}

function buildJobsUrl(search) {
  const params = new URLSearchParams();
  const q = String(search?.q || '').trim();
  const kraj = String(search?.kraj || '').trim();
  const place = String(search?.place || '').trim();
  const minMzda = search?.minMzda != null ? Number(search.minMzda) : 0;
  const dojezdKmRaw = search?.dojezdKm != null ? Number(search.dojezdKm) : 0;
  const dojezdKm = dojezdKmRaw || (place ? 5 : 0);

  if (q) params.set('q', q);
  if (kraj) params.set('kraj', kraj);
  if (place) params.set('place', place);
  if (Number.isFinite(minMzda) && minMzda > 0) params.set('min', String(Math.round(minMzda)));
  if (Number.isFinite(dojezdKm) && dojezdKm > 0) params.set('km', String(Math.round(dojezdKm)));

  const qs = params.toString();
  return `prace.html${qs ? `?${qs}` : ''}#hledani`;
}

function buildEduUrl(search) {
  const params = new URLSearchParams();
  const q = String(search?.q || '').trim();
  const code = String(search?.code || '').trim();
  const krajId = String(search?.krajId || '').trim();
  const typ = String(search?.typSkoly || '').trim();
  const druh = String(search?.druhSkoly || '').trim();
  const stupen = String(search?.stupen || '').trim();
  const forma = String(search?.forma || '').trim();

  if (q) params.set('q', q);
  if (code) params.set('code', code);
  if (krajId) params.set('kraj', krajId);
  if (typ) params.set('typ', typ);
  if (druh) params.set('druh', druh);
  if (stupen) params.set('stupen', stupen);
  if (forma) params.set('forma', forma);

  const qs = params.toString();
  return `vzdelani.html${qs ? `?${qs}` : ''}#hledani`;
}

function buildCoursesUrl(search) {
  const q = String(search?.q || '').trim();
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  const qs = params.toString();
  return `kurzy.html${qs ? `?${qs}` : ''}`;
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

function clampString(s, maxLen) {
  const n = Number(maxLen || 0) || 0;
  const txt = String(s || '').trim();
  if (!n || n < 10) return txt;
  if (txt.length <= n) return txt;
  return txt.slice(0, Math.max(0, n - 1)).trimEnd() + '…';
}

function makeFallbackAiObject({ content, lastUserMsg }) {
  const raw = String(content || '').trim();
  const inferred = inferIntentFromText(lastUserMsg) || 'general';
  const reply = clampString(raw.replace(/\s+/g, ' ').trim() || 'Rozumím.', 650);
  const out = {
    reply,
    intent: inferred,
    profile: {},
    search: inferred !== 'general' ? { q: clampString(String(lastUserMsg || '').trim(), 180) } : null,
    follow_up: null
  };
  return out;
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
  const modeRaw = String(body?.mode || 'auto').trim();
  const mode = ['auto', 'all', 'jobs', 'edu', 'courses'].includes(modeRaw) ? modeRaw : 'auto';
  const context = body?.context && typeof body.context === 'object' ? body.context : {};
  const messages = clampMessages(body?.messages);

  const system = {
    role: 'system',
    content:
      'Jsi chytrý poradce pro web SŠ Bor. ' +
      'Režim je daný polem mode: auto (automaticky), all (vše), jobs (pracovní nabídky), edu (vzdělání/školy), courses (kurzy). ' +
      'Pokud je mode=auto, SÁM rozpoznej téma a nastav intent. Přitom pořád umíš odpovědět na jakýkoli dotaz (general Q&A). ' +
      'Chovej se jako SPECIALISTA podle zvoleného intent/módu: ' +
      '- jobs: když už máš aspoň něco k filtrování (profese/dovednost/město/kraj/mzda), nejdřív dej best-effort výsledky (a vyplň search), a teprve pak polož maximálně 1 doplňující otázku. Nečekej na všechny filtry. ' +
      '- edu: doptávej se na úroveň (výuční list/maturita/VOŠ/VŠ), obor, kraj/město, formu (denní/dálková/kombinovaná), a zda jde o nástavbu nebo změnu oboru. ' +
      '- courses: doptávej se na cíl (rekvalifikace vs doplnění), časové možnosti, rozpočet a lokalitu/online. ' +
      'U obecného Q&A buď užitečný: když se uživatel ptá na cenu dopravy / bydlení / život v lokalitě, dej rozumný hrubý odhad a postup výpočtu, ale jasně řekni, že nemáš přístup k aktuálním ceníkům a že přesnou cenu je potřeba ověřit. Doptávej se na chybějící údaje (odkud–kam, způsob dopravy, počet dní v týdnu, nájem vs spolubydlení, velikost bytu, město). ' +
      'Piš STRUČNĚ: reply má být krátký (ideálně 2–4 věty, max ~450 znaků), bez dlouhých odstavců. Nepiš seznamy nabídek/škol do reply – konkrétní výsledky patří do recommendations/edu_recommendations a do odkazů. V reply se soustřeď na poradenství; follow_up buď null, nebo jen 1 krátká otázka. ' +
      'Důležité: nepřepínej stránku ani nenařizuj proklik; jen konverzuj a doptávej se. ' +
      'Vždy odpovídej ČESKY. ' +
      'V odpovědi vrať POUZE JSON objekt (bez markdownu). ' +
      'Drž se schématu: ' +
        '{"reply":string,"intent":"jobs"|"edu"|"courses"|"general","profile":{...},"search":{"q":string,"kraj":string|null,"place":string|null,"minMzda":number|null,"dojezdKm":number|null,"code":string|null,"krajId":string|null},"follow_up":string|null}. ' +
        'Poznámky: ' +
        '- intent=general použij pro běžné dotazy, které nejsou o práci/školách/kurzech. ' +
        '- Pro školy můžeš dát do search.code kód oboru (např. 23-45-M/01) a do search.kraj (nebo krajId) kraj (stačí i název kraje); server si to převede. ' +
        '- V edu/courses použij search.q pro klíčová slova (obor/škola/kraj/forma), i když nejde o práci.' +
        (ADVISOR_STYLE ? `\n\nDOPLŇUJÍCÍ INSTRUKCE (ADVISOR_STYLE):\n${ADVISOR_STYLE}` : '')
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
          max_tokens: 900,
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
            maxOutputTokens: 900,
            responseMimeType: 'application/json'
          }
        })
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        let available_models = null;
        let available_models_text = '';
        try {
          if (resp.status === 404) {
            available_models = await listGeminiModels(geminiKey);
            if (Array.isArray(available_models) && available_models.length) {
              const names = available_models
                .filter((m) => Array.isArray(m?.methods) && m.methods.includes('generateContent'))
                .map((m) => String(m?.name || '').replace(/^models\//, '').trim())
                .filter(Boolean)
                .slice(0, 12);
              if (names.length) available_models_text = `Available Gemini models (generateContent): ${names.join(', ')}`;
            }
          }
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
                ? `Gemini model was not found or does not support generateContent. Set GEMINI_MODEL to a model that supports generateContent (see available_models).${available_models_text ? ` ${available_models_text}` : ''}`
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

    const lastUserMsg = [...messages].reverse().find((m) => m && m.role === 'user' && String(m.content || '').trim())?.content || '';

    const jsonText = stripJsonFromText(content);
    const outParsed = safeParseJson(jsonText);
    const out =
      outParsed.ok && outParsed.value && typeof outParsed.value === 'object' && !Array.isArray(outParsed.value)
        ? outParsed.value
        : makeFallbackAiObject({ content, lastUserMsg });

    // Enforce short UI-friendly text even if the model ignores instructions.
    out.reply = clampString(out?.reply || 'Rozumím.', 650);
    if (out.follow_up != null) out.follow_up = clampString(out?.follow_up || '', 350);

    const followUpTxt = String(out?.follow_up || '').trim();
    const outIntent = normalizeIntent(out?.intent);
    const inferredIntent = inferIntentFromText(lastUserMsg);
    const intentFromMode = mode === 'jobs' ? 'jobs' : mode === 'edu' ? 'edu' : mode === 'courses' ? 'courses' : '';
    const intent = mode === 'auto' ? (outIntent || inferredIntent || 'general') : outIntent || intentFromMode || '';

    let normalizedSearch = mode === 'auto' ? normalizeSearchForAuto(out?.search, { intent, lastUserMsg }) : (out?.search || null);
    if ((mode === 'jobs' || (mode === 'auto' && intent === 'jobs')) && normalizedSearch) {
      try {
        normalizedSearch = await augmentJobsSearch(event, normalizedSearch, lastUserMsg);
      } catch {
        // ignore place inference errors
      }
    }

    let recommendations = [];
    let edu_recommendations = [];
    let actions = [];
    let jobs_match_count = null;
    let jobs_url = null;
    let edu_match_count = null;
    let edu_url = null;

    // Normalize education region filter if AI used a human region name.
    let searchForEdu = normalizedSearch && typeof normalizedSearch === 'object' ? { ...normalizedSearch } : null;

    try {
      const cache = await loadOffersFromSite(event);
      const offers = Array.isArray(cache?.offers) ? cache.offers : [];
      const shouldComputeJobs =
        (mode === 'jobs' || mode === 'all') ||
        (mode === 'auto' && intent === 'jobs');

      if (shouldComputeJobs && offers.length && normalizedSearch) {
        jobs_match_count = countMatchingOffers(offers, normalizedSearch);
        if (jobs_match_count && jobs_match_count > 0) jobs_url = buildJobsUrl(normalizedSearch);
      }
      if ((mode === 'jobs' || (mode === 'auto' && intent === 'jobs')) && offers.length && normalizedSearch) {
        recommendations = recommendOffers(offers, normalizedSearch);
      }
    } catch {
      // ignore recommendations errors
    }

    try {
      const shouldComputeEdu = mode === 'edu' || (mode === 'auto' && intent === 'edu');
      if (shouldComputeEdu && normalizedSearch) {
        const cache = await loadSchoolsFromSite(event);
        const schools = Array.isArray(cache?.schools) ? cache.schools : [];
        if (schools.length) {
          const resolved = resolveSchoolKrajId(schools, normalizedSearch?.krajId || normalizedSearch?.kraj);
          if (resolved) {
            searchForEdu = { ...(searchForEdu || {}), krajId: resolved };
          }

          const baseSearch = searchForEdu || normalizedSearch;
          edu_match_count = countMatchingSchools(schools, baseSearch);
          if (edu_match_count && edu_match_count > 0) edu_url = buildEduUrl(baseSearch);
          edu_recommendations = recommendSchools(schools, baseSearch);
        }
      }
    } catch {
      // ignore edu recommendations errors
    }

    const anySearch = hasAnySearch(normalizedSearch || out?.search);

    // UX: actions/results should be available even if a follow-up question is asked.
    const okToShowActions = mode !== 'jobs' || anySearch;

    if (okToShowActions) {
      if (mode === 'auto') {
        if (intent === 'jobs') {
          const n = jobs_match_count != null && Number.isFinite(Number(jobs_match_count)) ? Number(jobs_match_count) : null;
          actions = [
            {
              label: n && n > 0 ? `Zobrazit nabídky (${n})` : 'Otevřít pracovní nabídky',
              url: jobs_url || 'prace.html#hledani'
            }
          ];
        } else if (intent === 'edu') {
          const n = edu_match_count != null && Number.isFinite(Number(edu_match_count)) ? Number(edu_match_count) : null;
          actions = [
            {
              label: n && n > 0 ? `Zobrazit školy (${n})` : 'Otevřít vzdělání',
              url: edu_url || 'vzdelani.html#hledani'
            }
          ];
        } else if (intent === 'courses') {
          actions = [{ label: 'Otevřít kurzy', url: buildCoursesUrl(out?.search || {}) }];
        } else {
          actions = [];
        }
      } else if (mode === 'edu') {
        const n = edu_match_count != null && Number.isFinite(Number(edu_match_count)) ? Number(edu_match_count) : null;
        actions = [{ label: n && n > 0 ? `Zobrazit školy (${n})` : 'Otevřít vzdělání', url: edu_url || 'vzdelani.html#hledani' }];
      } else if (mode === 'courses') {
        actions = [{ label: 'Otevřít kurzy', url: buildCoursesUrl(out?.search || {}) }];
      } else if (mode === 'jobs') {
        const n = jobs_match_count != null && Number.isFinite(Number(jobs_match_count)) ? Number(jobs_match_count) : null;
        actions = [
          {
            label: n && n > 0 ? `Zobrazit všechny nabídky (${n})` : 'Otevřít pracovní nabídky',
            url: jobs_url || 'prace.html#hledani'
          }
        ];
      } else {
        // all
        actions = [
          { label: 'Pracovní nabídky', url: jobs_url || 'prace.html#hledani' },
          { label: 'Vzdělání', url: edu_url || 'vzdelani.html#hledani' },
          { label: 'Kurzy', url: buildCoursesUrl(out?.search || {}) }
        ];
      }
    }

    return json(
      200,
      { ...out, mode, intent, search: normalizedSearch || out?.search || null, recommendations, edu_recommendations, actions, jobs_match_count, jobs_url, edu_match_count, edu_url },
      { 'access-control-allow-origin': '*' }
    );
  } catch (e) {
    return json(500, { error: 'Server error.', details: String(e?.message || e) }, { 'access-control-allow-origin': '*' });
  }
};
