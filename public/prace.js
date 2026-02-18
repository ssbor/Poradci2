(function () {
  'use strict';

  // NUTS3 codes for CZ regions (kraje)
  const CZ_REGIONS = [
    { code: 'CZ010', name: 'Hlavní město Praha' },
    { code: 'CZ020', name: 'Středočeský kraj' },
    { code: 'CZ031', name: 'Jihočeský kraj' },
    { code: 'CZ032', name: 'Plzeňský kraj' },
    { code: 'CZ041', name: 'Karlovarský kraj' },
    { code: 'CZ042', name: 'Ústecký kraj' },
    { code: 'CZ051', name: 'Liberecký kraj' },
    { code: 'CZ052', name: 'Královéhradecký kraj' },
    { code: 'CZ053', name: 'Pardubický kraj' },
    { code: 'CZ063', name: 'Kraj Vysočina' },
    { code: 'CZ064', name: 'Jihomoravský kraj' },
    { code: 'CZ071', name: 'Olomoucký kraj' },
    { code: 'CZ072', name: 'Zlínský kraj' },
    { code: 'CZ080', name: 'Moravskoslezský kraj' }
  ];

  const CZ_REGION_NAME_BY_CODE = Object.fromEntries(CZ_REGIONS.map((r) => [r.code, r.name]));

  // Short-but-readable labels for UI (so it's understandable at a glance).
  const CZ_REGION_SHORT_BY_CODE = {
    CZ010: 'Praha',
    CZ020: 'Středočeský',
    CZ031: 'Jihočeský',
    CZ032: 'Plzeňský',
    CZ041: 'Karlovarský',
    CZ042: 'Ústecký',
    CZ051: 'Liberecký',
    CZ052: 'Královéhradecký',
    CZ053: 'Pardubický',
    CZ063: 'Vysočina',
    CZ064: 'Jihomoravský',
    CZ071: 'Olomoucký',
    CZ072: 'Zlínský',
    CZ080: 'Moravskoslezský'
  };

  function normalizeKey(s) {
    return String(s || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]+/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ');
  }

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function prefixLenForToken(t) {
    const s = String(t || '').trim();
    if (!s) return 0;
    if (s.length <= 4) return s.length;
    return Math.max(4, Math.min(6, Math.floor(s.length * 0.65)));
  }

  function prefixTokenMatch(hay, token) {
    const t = String(token || '').trim();
    if (!t) return true;

    const prefixLen = prefixLenForToken(t);
    if (prefixLen < 4) return false;
    const tp = t.slice(0, prefixLen);

    const words = String(hay || '').split(/\s+/g).filter(Boolean);
    for (const w of words) {
      if (w.length < prefixLen) continue;
      if (w.startsWith(tp)) return true;
    }
    return false;
  }

  function wholeWordInText(text, token) {
    const t = String(token || '').trim();
    if (!t) return true;
    const hay = String(text || '');
    const re = new RegExp(`(^|\\s)${escapeRegExp(t)}(\\s|$)`);
    return re.test(hay);
  }

  function tokenInText(text, token) {
    const t = String(token || '').trim();
    if (!t) return true;
    const hay = String(text || '');

    // Very short tokens: require whole word to avoid noise.
    if (t.length <= 2) {
      return wholeWordInText(hay, t);
    }

    // Short tokens: match only at the start of a word (so "bor" doesn't match "odborna").
    if (t.length <= 4) {
      const re = new RegExp(`(^|\\s)${escapeRegExp(t)}`);
      return re.test(hay);
    }

    if (hay.includes(t)) return true;
    return prefixTokenMatch(hay, t);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  async function fetchJSON(url) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  function $(sel, root = document) {
    return root.querySelector(sel);
  }

  function shortId(id) {
    const s = String(id || '');
    const i = s.lastIndexOf('/');
    return i >= 0 ? s.slice(i + 1) : s;
  }

  function humanizeEnumId(id, mapObj) {
    const raw = String(id || '').trim();
    if (!raw) return '';
    const key = shortId(raw).toLowerCase();
    if (mapObj && Object.prototype.hasOwnProperty.call(mapObj, key)) return mapObj[key];
    // fallback: drop prefix and make it a bit nicer
    return shortId(raw)
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (m) => m.toUpperCase());
  }

  const UVAZEK_LABELS = {
    plny: 'Plný úvazek',
    zkraceny: 'Zkrácený úvazek',
    dpp: 'DPP',
    dpc: 'DPČ',
    dohoda_o_provedeni_prace: 'DPP',
    dohoda_o_pracovni_cinnosti: 'DPČ',
    sluzebni_pomer: 'Služební poměr',
    sezoni: 'Sezónní práce'
  };

  const SMENNOST_LABELS = {
    jednosm: 'Jednosměnný',
    dvousm: 'Dvousměnný',
    trism: 'Třísměnný',
    nepretrz: 'Nepřetržitý',
    pruzna: 'Pružná pracovní doba',
    turnus: 'Turnusový'
  };

  function humanizeVzdelaniId(id) {
    const raw = String(id || '').trim();
    if (!raw) return '';
    const k = shortId(raw).toLowerCase();
    if (k.includes('bez')) return 'Bez vzdělání';
    if (k.includes('zakl')) return 'Základní';
    if (k.includes('nizsi') || k.includes('niž')) return 'Nižší střední';
    if (k.includes('vyuc')) return 'Vyučení / střední odborné';
    if (k.includes('matur')) return 'Střední s maturitou';
    if (k.includes('stred')) return 'Střední';
    if (k.includes('vyssi') || k.includes('vo') || k.includes('odbor')) return 'Vyšší odborné';
    if (k.includes('bakal')) return 'Vysokoškolské (Bc.)';
    if (k.includes('magist') || k.includes('ing')) return 'Vysokoškolské (Mgr./Ing.)';
    if (k.includes('doktor') || k.includes('phd')) return 'Vysokoškolské (Ph.D.)';
    return shortId(raw).replace(/([a-z])([A-Z])/g, '$1 $2');
  }

  const TYP_MZDY_LABELS = {
    mesic: 'Měsíční',
    hod: 'Hodinová',
    hodin: 'Hodinová',
    ukol: 'Úkolová',
    podil: 'Podílová'
  };

  function escapeHtmlWithBreaks(s) {
    const txt = String(s || '').trim();
    if (!txt) return '';
    return escapeHtml(txt).replace(/\r\n|\r|\n/g, '<br>');
  }

  let OFFER_MODAL = null;

  function offerDetailUrl(offer) {
    const direct = String(
      offer?.url_adresa ?? offer?.urlAdresa ?? offer?.url ?? offer?.detail_url ?? ''
    ).trim();
    if (/^https?:\/\//i.test(direct)) return direct;

    const pidRaw = offer?.portal_id ?? offer?.portalId;
    const pid = pidRaw == null ? '' : String(pidRaw).trim();
    if (pid) {
      return `https://www.uradprace.cz/volna-mista-v-cr#/volna-mista-detail/${encodeURIComponent(pid)}`;
    }

    const idLike = String(offer?.offer_id ?? offer?.id ?? '').trim();
    const idShort = shortId(idLike);
    if (/^\d+$/.test(idShort)) {
      return `https://www.uradprace.cz/volna-mista-v-cr#/volna-mista-detail/${encodeURIComponent(idShort)}`;
    }

    return '';
  }

  function ensureOfferModal() {
    if (OFFER_MODAL) return OFFER_MODAL;

    const overlay = document.createElement('div');
    overlay.className = 'offer-modal-overlay';
    overlay.innerHTML = `
      <div class="offer-modal" role="dialog" aria-modal="true" aria-labelledby="offer-modal-title">
        <div class="offer-modal__header">
          <div style="min-width:0">
            <div class="offer-modal__title" id="offer-modal-title"></div>
            <div class="offer-modal__subtitle" data-role="offer-modal-subtitle"></div>
          </div>
          <button class="btn btn--ghost offer-modal__close" type="button" data-action="offer-modal-close" aria-label="Zavřít">✕</button>
        </div>
        <div class="offer-modal__body" data-role="offer-modal-body"></div>
        <div class="offer-modal__actions">
          <a class="btn btn--primary" target="_blank" rel="noopener noreferrer" href="#" data-role="offer-modal-link">Otevřít na ÚP</a>
          <button class="btn btn--ghost" type="button" data-action="offer-modal-close">Zavřít</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    let scrollState = null;

    const lockScroll = () => {
      if (scrollState) return;
      const y = window.scrollY || window.pageYOffset || 0;
      const body = document.body;

      scrollState = {
        y,
        position: body.style.position,
        top: body.style.top,
        left: body.style.left,
        right: body.style.right,
        width: body.style.width,
        paddingRight: body.style.paddingRight
      };

      const scrollbarGap = window.innerWidth - document.documentElement.clientWidth;
      if (scrollbarGap > 0) body.style.paddingRight = `${scrollbarGap}px`;

      body.style.position = 'fixed';
      body.style.top = `-${y}px`;
      body.style.left = '0';
      body.style.right = '0';
      body.style.width = '100%';

      document.documentElement.classList.add('modal-open');
      body.classList.add('modal-open');
    };

    const unlockScroll = () => {
      if (!scrollState) return;
      const { y, position, top, left, right, width, paddingRight } = scrollState;
      const body = document.body;

      body.style.position = position;
      body.style.top = top;
      body.style.left = left;
      body.style.right = right;
      body.style.width = width;
      body.style.paddingRight = paddingRight;

      document.documentElement.classList.remove('modal-open');
      body.classList.remove('modal-open');

      scrollState = null;
      window.scrollTo(0, y);
    };

    const close = () => {
      overlay.classList.remove('is-open');
      unlockScroll();
    };

    overlay.addEventListener('click', (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t === overlay) return close();
      if (t.closest('[data-action=offer-modal-close]')) return close();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!overlay.classList.contains('is-open')) return;
      close();
    });

    OFFER_MODAL = {
      overlay,
      titleEl: overlay.querySelector('#offer-modal-title'),
      subtitleEl: overlay.querySelector('[data-role=offer-modal-subtitle]'),
      bodyEl: overlay.querySelector('[data-role=offer-modal-body]'),
      linkEl: overlay.querySelector('[data-role=offer-modal-link]'),
      lockScroll,
      unlockScroll
    };
    return OFFER_MODAL;
  }

  function openOfferModal(offer) {
    const m = ensureOfferModal();
    if (!m?.overlay || !m.titleEl || !m.bodyEl || !m.linkEl || !m.subtitleEl) return;

    const title = String(offer?.profese || '').trim() || 'Nabídka práce';
    const company = String(offer?.zamestnavatel || '').trim();
    const city = String(offer?.obec || '').trim();
    const okres = String(offer?.okres || '').trim();
    const krajCode = String(offer?.kraj || '').trim();
    const krajName = String(offer?.kraj_nazev || '').trim() || CZ_REGION_NAME_BY_CODE[krajCode] || '';

    const wage = offerWageText(offer);
    const mistoVykonuPrace = String(offer?.misto_vykonu_prace || offer?.lokalita || '').trim();
    const adresaKontaktu = String(offer?.kontakt_adresa || '').trim();
    const ico = String(offer?.zamestnavatel_ico || '').trim();
    const czIscoRaw = String(offer?.cz_isco || '').trim();
    const czIscoCode = String(offer?.cz_isco_code || '').trim() || shortId(czIscoRaw).replace(/\D/g, '');
    const portalId = offer?.portal_id != null ? String(offer.portal_id).trim() : '';
    const referencniCislo = String(offer?.referencni_cislo || '').trim();
    const urlAdresa = String(offer?.url_adresa || '').trim();

    const info = String(offer?.info || '').trim();
    const contactName = [String(offer?.kontakt_jmeno || '').trim(), String(offer?.kontakt_prijmeni || '').trim()]
      .filter(Boolean)
      .join(' ');
    const contactPhone = String(offer?.kontakt_telefon || '').trim();
    const contactEmail = String(offer?.kontakt_email || '').trim();
    const contactPlace = String(offer?.misto_kontaktu || '').trim();

    const benefits = Array.isArray(offer?.vyhody) ? offer.vyhody.filter((x) => String(x || '').trim()) : [];
    const uvazekIds = Array.isArray(offer?.uvazek_ids) ? offer.uvazek_ids.filter((x) => String(x || '').trim()) : [];
    const uvazekHuman = uvazekIds.map((id) => humanizeEnumId(id, UVAZEK_LABELS)).filter(Boolean);
    const educationId = String(offer?.vzdelani_id || '').trim();
    const educationHuman = humanizeVzdelaniId(educationId);
    const smennostId = String(offer?.smennost_id || '').trim();
    const smennostHuman = humanizeEnumId(smennostId, SMENNOST_LABELS);
    const typMzdyId = String(offer?.typ_mzdy_id || '').trim();
    const typMzdyHuman = humanizeEnumId(typMzdyId, TYP_MZDY_LABELS);
    const pocetMist = offer?.pocet_mist != null ? String(offer.pocet_mist) : '';
    const hodinyTydne = offer?.hodiny_tydne != null ? String(offer.hodiny_tydne) : '';
    const datumVlozeni = String(offer?.datum_vlozeni || '').trim();

    m.titleEl.textContent = title;
    m.subtitleEl.textContent = [company, city, krajName].filter(Boolean).join(' · ');

    const employerLine = [
      company,
      ico ? `IČO: ${ico}` : ''
    ].filter(Boolean).join(' · ');

    const rows = [
      ['Zaměstnavatel', employerLine],
      ['Místo výkonu práce', mistoVykonuPrace || [city, okres, krajName].filter(Boolean).join(', ')],
      ['Mzda', wage],
      ['Úvazek', uvazekHuman.join(', ')],
      ['Směnnost', smennostHuman],
      ['Požadované vzdělání', educationHuman],
      ['Typ mzdy', typMzdyHuman],
      ['Počet míst', pocetMist],
      ['Hodin týdně', hodinyTydne],
      ['Datum vložení', formatOfferDate(datumVlozeni)],
      ['CZ-ISCO', czIscoCode],
      ['ID nabídky (ÚP)', portalId],
      ['Referenční číslo', referencniCislo],
      ['URL v datech', urlAdresa]
    ];

    const contactHtml = [
      contactName ? `<div><b>${escapeHtml(contactName)}</b></div>` : '',
      adresaKontaktu ? `<div>Adresa: ${escapeHtml(adresaKontaktu)}</div>` : '',
      contactPhone ? `<div>Tel: <a href="tel:${escapeHtml(contactPhone)}">${escapeHtml(contactPhone)}</a></div>` : '',
      contactEmail ? `<div>E-mail: <a href="mailto:${escapeHtml(contactEmail)}">${escapeHtml(contactEmail)}</a></div>` : '',
      contactPlace ? `<div class="muted" style="margin-top:.25rem">${escapeHtml(contactPlace)}</div>` : ''
    ]
      .filter(Boolean)
      .join('');

    m.bodyEl.innerHTML = `
      <div class="offer-detail-grid">
        ${rows
          .filter(([, v]) => String(v || '').trim())
          .map(
            ([k, v]) => `
              <div class="offer-detail-grid__k">${escapeHtml(k)}</div>
              <div class="offer-detail-grid__v">${escapeHtml(String(v))}</div>
            `
          )
          .join('')}

        ${contactHtml
          ? `
            <div class="offer-detail-grid__k">Kontakt</div>
            <div class="offer-detail-grid__v">${contactHtml}</div>
          `
          : ''}

        ${benefits.length
          ? `
            <div class="offer-detail-grid__k">Výhody</div>
            <div class="offer-detail-grid__v">
              <ul class="offer-bullets">
                ${benefits.map((b) => `<li>${escapeHtml(String(b))}</li>`).join('')}
              </ul>
            </div>
          `
          : ''}
      </div>

      ${info
        ? `
          <div class="offer-info">
            <div class="offer-info__title">Upřesňující informace</div>
            <div class="offer-info__text">${escapeHtmlWithBreaks(info)}</div>
          </div>
        `
        : ''}
    `;

    const url = offerDetailUrl(offer);
    if (url) {
      m.linkEl.href = url;
      m.linkEl.style.display = '';
    } else {
      m.linkEl.removeAttribute('href');
      m.linkEl.style.display = 'none';
    }

    if (typeof m.lockScroll === 'function') m.lockScroll();
    m.overlay.classList.add('is-open');
  }

  function haversineKm(a, b) {
    const R = 6371;
    const toRad = (x) => (x * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  const BOR_BIAS = { lat: 49.7129, lon: 12.7756 };

  let OBCE_INDEX = null;
  let OBCE_INDEX_LOADING = null;

  async function ensureObceIndexLoaded() {
    if (OBCE_INDEX) return OBCE_INDEX;
    if (OBCE_INDEX_LOADING) return OBCE_INDEX_LOADING;
    OBCE_INDEX_LOADING = (async () => {
      try {
        const data = await fetchJSON('data/obce_centroids.json');
        if (data && typeof data === 'object' && data.byName) {
          OBCE_INDEX = data;
          return OBCE_INDEX;
        }
      } catch {
        // ignore
      }
      OBCE_INDEX = null;
      return null;
    })();
    return OBCE_INDEX_LOADING;
  }

  function pickClosestFromOptions(options, bias) {
    if (!Array.isArray(options) || options.length === 0) return null;
    const biasPoint = bias && Number.isFinite(bias.lat) && Number.isFinite(bias.lon) ? bias : null;
    let best = null;
    let bestScore = Infinity;
    for (const opt of options) {
      const lat = Number(opt?.lat);
      const lon = Number(opt?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const score = biasPoint ? haversineKm(biasPoint, { lat, lon }) : 0;
      if (score < bestScore) {
        bestScore = score;
        best = { lat, lon };
      }
    }
    return best;
  }

  async function lookupObecCoords(name, krajCode) {
    const idx = await ensureObceIndexLoaded();
    if (!idx) return null;

    const nn = normalizeKey(name);
    if (!nn) return null;

    const kc = String(krajCode || '').trim();
    const byNameKraj = idx.byNameKraj || {};
    const hit = kc ? byNameKraj[`${nn}|${kc}`] : null;
    const hitArr = Array.isArray(hit) ? hit : hit ? [hit] : null;
    if (kc && hitArr && hitArr.length) {
      const coords = pickClosestFromOptions(hitArr, BOR_BIAS);
      if (coords) return coords;
    }

    const options = idx.byName?.[nn];
    if (options) return pickClosestFromOptions(options, BOR_BIAS);
    return null;
  }

  async function lookupPlaceCoordsByKey(key) {
    const k = String(key || '').trim();
    if (!k) return null;
    const idx = await ensureObceIndexLoaded();
    const hit = idx?.byKey?.[k];
    const lat = Number(hit?.lat);
    const lon = Number(hit?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon };
  }

  const HOURLY_WAGE_MAX = 1000; // heuristic: values under this are treated as Kč/h
  const HOURS_PER_MONTH = (40 * 52) / 12; // ≈ 173.33

  function isFiniteNumber(n) {
    return typeof n === 'number' && Number.isFinite(n) && !Number.isNaN(n);
  }

  function looksHourlyWage(n) {
    return isFiniteNumber(n) && n > 0 && n <= HOURLY_WAGE_MAX;
  }

  function toMonthlyWage(n) {
    if (!isFiniteNumber(n)) return null;
    return looksHourlyWage(n) ? Math.round(n * HOURS_PER_MONTH) : n;
  }

  function offerWageIsHourly(offer) {
    const od = isFiniteNumber(offer?.mzda_od) ? offer.mzda_od : null;
    const doo = isFiniteNumber(offer?.mzda_do) ? offer.mzda_do : null;
    return looksHourlyWage(od) || looksHourlyWage(doo);
  }

  function offerMonthlyWagePoint(offer) {
    const od = isFiniteNumber(offer?.mzda_od) ? offer.mzda_od : null;
    const doo = isFiniteNumber(offer?.mzda_do) ? offer.mzda_do : null;

    const odM = od != null ? toMonthlyWage(od) : null;
    const doM = doo != null ? toMonthlyWage(doo) : null;

    if (odM != null && doM != null) return Math.round((odM + doM) / 2);
    return odM ?? doM ?? null;
  }

  function fmtInt(n) {
    if (n == null || Number.isNaN(n)) return '—';
    return Number(n).toLocaleString('cs-CZ');
  }

  function offerWageText(offer) {
    const od = isFiniteNumber(offer?.mzda_od) ? offer.mzda_od : null;
    const doo = isFiniteNumber(offer?.mzda_do) ? offer.mzda_do : null;

    const range = (od != null ? fmtInt(od) : '') + (doo != null ? '–' + fmtInt(doo) : '');
    if (!range) return '—';
    return offerWageIsHourly(offer) ? `${range}\u00A0Kč/h` : `${range}\u00A0Kč`;
  }

  function formatOfferDate(datum) {
    const s = String(datum || '').trim();
    if (!s) return '—';

    // Prefer stable parsing for YYYY-MM-DD
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const d = Number(m[3]);
      if (Number.isFinite(y) && Number.isFinite(mo) && Number.isFinite(d)) {
        const dt = new Date(y, mo - 1, d);
        return dt.toLocaleDateString('cs-CZ');
      }
    }

    const dt = new Date(s);
    if (!Number.isFinite(dt.getTime())) return '—';
    return dt.toLocaleDateString('cs-CZ');
  }

  // Focus/certifications by broad category (heuristic).
  const FOCUS_BY_CATEGORY = {
    auto: [
      { id: 'svarec', label: 'Svářečský průkaz' },
      { id: 'diagnostika', label: 'Diagnostika (OBD, elektro)' },
      { id: 'klima', label: 'Klimatizace (AC)' },
      { id: 'ridicC', label: 'Řidičák C / práce s užitkovými vozy' }
    ],
    agri: [
      { id: 'svarec', label: 'Svářečský průkaz' },
      { id: 'hydraulika', label: 'Hydraulika / pneumatika' },
      { id: 'servis', label: 'Servis v terénu' }
    ],
    kuchar: [
      { id: 'cukrar', label: 'Cukrářství / pečení' },
      { id: 'catering', label: 'Catering / eventy' },
      { id: 'barista', label: 'Káva / barista' }
    ],
    cisnik: [
      { id: 'catering', label: 'Catering / eventy' },
      { id: 'barista', label: 'Káva / barista' }
    ],
    barman: [
      { id: 'barista', label: 'Káva / barista' },
      { id: 'catering', label: 'Catering / eventy' }
    ],
    ridic: [{ id: 'ridicC', label: 'Řidičák C / profesní průkaz' }],
    svarec: [{ id: 'svarec', label: 'Svářečský průkaz' }],
    other: [{ id: 'svarec', label: 'Svářečský průkaz' }]
  };

  function categoryFromProgramName(programName) {
    const n = normalizeKey(programName);
    if (!n) return 'other';
    if (n.includes('motorovych vozidel') || n.includes('automechanik') || n.includes('kfz')) return 'auto';
    if (n.includes('zemedelsk') || n.includes('baumaschinen') || n.includes('landmaschinen')) return 'agri';
    if (n.includes('ridic') || n.includes('spedit') || n.includes('logist')) return 'ridic';
    if (n.includes('svarec') || n.includes('svare')) return 'svarec';
    if (n.includes('barman') || n.includes('barist')) return 'barman';
    if (n.includes('cisnik') || n.includes('servirk') || n.includes('hotel')) return 'cisnik';
    if (n.includes('kuchar') || n.includes('gastr')) return 'kuchar';
    return 'other';
  }

  function recommendedRoles({ category, focusId }) {
    const base = {
      auto: [
        { title: 'Automechanik', note: 'Servis osobních i užitkových vozů' },
        { title: 'Mechanik opravář motorových vozidel', note: 'Diagnostika a opravy' },
        { title: 'KFZ-Mechatroniker', note: 'Zahraničí / německé názvy' }
      ],
      agri: [
        { title: 'Opravář zemědělských strojů', note: 'Servis traktorů a techniky' },
        { title: 'Mechanik zemědělské techniky', note: 'Záruční i pozáruční servis' },
        { title: 'Land-/Baumaschinenmechatroniker', note: 'Zahraničí / německé názvy' }
      ],
      kuchar: [
        { title: 'Kuchař', note: 'Teplá/studená kuchyně' },
        { title: 'Pomocný kuchař', note: 'Základní příprava a výdej' },
        { title: 'Koch', note: 'Zahraničí / německé názvy' }
      ],
      cisnik: [
        { title: 'Číšník', note: 'Obsluha, hotel, restaurace' },
        { title: 'Servírka', note: 'Obsluha, hotel, restaurace' },
        { title: 'Kellner', note: 'Zahraničí / německé názvy' }
      ],
      barman: [
        { title: 'Barman', note: 'Bar, míchané nápoje' },
        { title: 'Barista', note: 'Káva a obsluha' }
      ],
      ridic: [
        { title: 'Řidič', note: 'Rozvoz, doprava, logistika' },
        { title: 'Řidič nákladního vozidla', note: 'Kamion / náklad' }
      ],
      svarec: [
        { title: 'Svářeč', note: 'MIG/MAG, TIG apod.' },
        { title: 'Zámečník', note: 'Dílna / výroba' }
      ],
      other: [{ title: 'Pracovník v oboru', note: 'Upřesni obor nebo pozici' }]
    };

    const extraByFocus = {
      svarec: [
        { title: 'Svářeč', note: 'Doplněk k technickým oborům' },
        { title: 'Zámečník', note: 'Dílna / výroba' }
      ],
      diagnostika: [{ title: 'Autoelektrikář', note: 'Elektro a diagnostika' }],
      klima: [{ title: 'Servis klimatizací', note: 'AC systémy' }],
      ridicC: [{ title: 'Mechanik (užitkové vozy)', note: 'Kombinace řízení + servis' }],
      hydraulika: [{ title: 'Servisní technik hydrauliky', note: 'Pumpy, hadice, okruhy' }],
      servis: [{ title: 'Servisní technik (výjezdy)', note: 'Práce v terénu' }],
      cukrar: [{ title: 'Cukrář', note: 'Pečení, dezerty' }],
      catering: [{ title: 'Kuchař (catering)', note: 'Akce a eventy' }],
      barista: [{ title: 'Barista', note: 'Káva, obsluha' }]
    };

    const out = [...(base[category] || base.other)];
    if (focusId && extraByFocus[focusId]) out.push(...extraByFocus[focusId]);

    // De-dup by title
    const seen = new Set();
    return out.filter((r) => {
      const k = normalizeKey(r.title);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  function jobToText(job) {
    return normalizeKey([
      job.profese,
      job.zamestnavatel,
      job.lokalita,
      job.obec,
      job.okres,
      job.kraj_nazev,
      job.kraj,
      job.cz_isco
    ].filter(Boolean).join(' '));
  }

  const FOCUS_KEYWORDS = {
    svarec: ['svarec', 'svare', 'welding', 'tig', 'mig', 'mag'],
    diagnostika: ['diagnost', 'mechatron', 'autoelektr', 'elektr', 'technolog'],
    klima: ['klimatiz', 'chlad', 'chlaz', 'chladar'],
    ridicC: ['ridic', 'naklad', 'kamion', 'tahac', 'souprava', 'logistik'],
    hydraulika: ['hydraul', 'pneumat'],
    servis: ['servis', 'technik', 'montaz', 'udrzb', 'oprava'],
    cukrar: ['cukrar', 'pekar', 'pekarst', 'peciv', 'dort', 'dezert'],
    catering: ['catering', 'event', 'banket', 'raut', 'svateb'],
    barista: ['barista', 'kava', 'kavar', 'coffee']
  };

  function focusMatchesOffer(offer, focusId) {
    const id = String(focusId || '').trim();
    if (!id) return true;

    const kws = FOCUS_KEYWORDS[id];
    if (!kws || !kws.length) return true;

    const text = jobToText(offer);
    return kws.some((kw) => tokenInText(text, normalizeKey(kw)));
  }

  function matchesAllTokens(text, queryRaw) {
    const q = normalizeKey(queryRaw);
    if (!q) return true;
    const tokens = q.split(' ').filter(Boolean);
    return tokens.every((t) => tokenInText(text, t));
  }

  async function loadMpsvOffers() {
    let cats = null;
    try {
      cats = await fetchJSON('data/categories.json');
    } catch {
      cats = null;
    }

    const categories = Array.isArray(cats?.categories) ? cats.categories : [];
    const tags = categories
      .map((c) => ({ tag: String(c?.tag || '').trim(), label: String(c?.label || '').trim() }))
      .filter((x) => x.tag);

    // Fallback if categories.json fails
    const tagList = tags.length
      ? tags
      : [
          { tag: 'auto', label: 'Auto' },
          { tag: 'agri', label: 'Agri' },
          { tag: 'kuchar', label: 'Kuchař' },
          { tag: 'cisnik', label: 'Číšník / servírka' },
          { tag: 'barman', label: 'Barman' },
          { tag: 'ridic', label: 'Řidič' },
          { tag: 'svarec', label: 'Svářeč' }
        ];

    const results = await Promise.allSettled(
      tagList.map(async ({ tag, label }) => {
        const data = await fetchJSON(`data/${encodeURIComponent(tag)}.json`);
        const offers = Array.isArray(data?.offers) ? data.offers : [];
        return offers.map((o) => ({ ...o, __tag: tag, __tagLabel: label }));
      })
    );

    const all = [];
    for (const r of results) {
      if (r.status === 'fulfilled') all.push(...r.value);
    }
    return { offers: all, tags: tagList };
  }

  function renderReco(recoEl, roles) {
    if (!recoEl) return;
    if (!roles.length) {
      recoEl.innerHTML = '<div class="muted" style="margin-top:.6rem">Zvol školu/obor nebo napiš pozici do vyhledávání.</div>';
      return;
    }

    recoEl.innerHTML = roles
      .slice(0, 12)
      .map(
        (r) => `
        <div class="program-row">
          <div>
            <div><b>${escapeHtml(r.title)}</b></div>
            <div class="program-row__meta">${escapeHtml(r.note || '')}</div>
          </div>
          <div class="muted">&nbsp;</div>
          <div class="muted">&nbsp;</div>
        </div>
      `
      )
      .join('');
  }

  function renderJobs(outEl, jobs) {
    if (!outEl) return;

    const rows = jobs
      .map((j, idx) => {
        const title = String(j.profese || '').trim() || '—';
        const company = String(j.zamestnavatel || '').trim();
        const city = String(j.obec || j.lokalita || '').trim() || '—';
        const krajCode = String(j.kraj || '').trim();
        const krajShort = CZ_REGION_SHORT_BY_CODE[krajCode] || CZ_REGION_NAME_BY_CODE[krajCode] || '';
        const mz = offerWageText(j);
        const dt = formatOfferDate(j.datum);
        const canDetail = !!offerDetailUrl(j);

        return `
        <div class="program-row jobs-program-row">
          <div class="jobs-offer">
            <div class="jobs-offer__title"><b>${escapeHtml(title)}</b></div>
            ${company ? `<div class="jobs-offer__company">${escapeHtml(company)}</div>` : ''}
            <div class="jobs-offer__actions">
              ${canDetail
                ? `<button class="btn btn--ghost jobs-more" type="button" data-action="offer-detail" data-idx="${idx}">Více informací</button>`
                : `<span class="muted" style="font-size:.78rem">Detail není k dispozici</span>`}
            </div>
          </div>
          <div class="jobs-place">
            <span class="jobs-place__city">${escapeHtml(city)}</span>
            ${krajShort ? `<span class="jobs-place__kraj">${escapeHtml(krajShort)}</span>` : ''}
          </div>
          <div class="jobs-wage">${escapeHtml(mz)}</div>
          <div style="text-align:right">${escapeHtml(dt)}</div>
        </div>
      `;
      })
      .join('');

    outEl.innerHTML = `
      <div class="card" style="margin-top: 1rem">
        <div class="programs-head jobs-programs-head">
          <div class="programs-head__title">Nabídka</div>
          <div class="programs-head__col">Město a kraj</div>
          <div class="programs-head__col">Mzda</div>
          <div class="programs-head__col" style="text-align:right">Datum přidání</div>
        </div>
        <div class="programs-list">
          ${rows || '<div class="muted" style="margin-top:.6rem">Nic nenalezeno.</div>'}
        </div>
      </div>
    `;
  }

  function ensureJobsResultsUI(outEl) {
    if (!outEl) return null;

    const existing = outEl.querySelector('[data-role=jobs-results-wrap]');
    if (existing) {
      return {
        wrap: existing,
        listEl: existing.querySelector('[data-role=jobs-list]')
      };
    }

    const wrap = document.createElement('div');
    wrap.setAttribute('data-role', 'jobs-results-wrap');

    const makePager = (pos) => {
      const right =
        pos === 'top'
          ? `
        <div class="pager__right" style="align-items:flex-start">
          <div style="display:flex; flex-direction:column; align-items:flex-end; gap:.35rem">
            <div class="count-pill">Pozice: <b data-role="jobs-count">–</b></div>
            <div style="display:flex; align-items:center; gap:.5rem">
              <span class="pager__label">Na stránce</span>
              <select class="select" data-role="jobs-page-size" aria-label="Počet nabídek na stránce">
                <option value="10">10</option>
                <option value="20">20</option>
                <option value="30" selected>30</option>
                <option value="50">50</option>
                <option value="100">100</option>
                <option value="all">Vše</option>
              </select>
            </div>
          </div>
        </div>
      `
          : '';

      return `
        <div class="pager" data-role="jobs-pager" data-pos="${pos}">
          <div class="pager__left">
            <button class="btn btn--ghost" data-role="jobs-page-prev" type="button" aria-label="Předchozí stránka">←</button>
            <div class="pager__info" data-role="jobs-page-info">Stránka 1/1</div>
            <button class="btn btn--ghost" data-role="jobs-page-next" type="button" aria-label="Další stránka">→</button>
          </div>
          ${right}
        </div>
      `;
    };

    wrap.innerHTML = `
      ${makePager('top')}
      <div data-role="jobs-list"></div>
      ${makePager('bottom')}
    `;

    outEl.appendChild(wrap);

    return {
      wrap,
      listEl: wrap.querySelector('[data-role=jobs-list]')
    };
  }

  function scrollResultsToTop(outEl) {
    if (!outEl) return;

    // For paging, scroll to results (not all the way to the filter form).
    const pager = outEl.querySelector('[data-role=jobs-pager][data-pos=top]');
    const list = outEl.querySelector('[data-role=jobs-list]');
    const target = pager || list || outEl;

    const header = document.querySelector('.site-header');
    const headerH = header ? Math.ceil(header.getBoundingClientRect().height) : 0;
    const pad = 12;

    requestAnimationFrame(() => {
      const rect = target.getBoundingClientRect();
      const top = rect.top + window.scrollY - headerH - pad;
      const y = Math.max(0, Math.floor(top));
      try {
        window.scrollTo({ top: y, behavior: 'smooth' });
      } catch {
        window.scrollTo(0, y);
      }
    });
  }

  function populateSelect(sel, items, { emptyLabel = '—' } = {}) {
    if (!sel) return;
    const cur = String(sel.value || '');
    sel.innerHTML = '';
    const opt0 = document.createElement('option');
    opt0.value = '';
    opt0.textContent = emptyLabel;
    sel.appendChild(opt0);
    for (const it of items) {
      const opt = document.createElement('option');
      opt.value = it.value;
      opt.textContent = it.label;
      sel.appendChild(opt);
    }
    sel.value = cur;
  }

  function initSchoolSuggest({ inputEl, suggestEl, onPick }) {
    let items = [];
    let lastQ = '';

    const close = () => {
      if (suggestEl) suggestEl.innerHTML = '';
    };

    const render = (list) => {
      if (!suggestEl) return;
      if (!list.length) {
        suggestEl.innerHTML = '';
        return;
      }
      suggestEl.innerHTML = `
        <div class="jobs-suggest__box">
          ${list
            .slice(0, 10)
            .map(
              (s) => `
            <button type="button" class="jobs-suggest__item" data-id="${escapeHtml(String(s.id || ''))}">
              <div class="jobs-suggest__title">${escapeHtml(String(s.name || ''))}</div>
              <div class="jobs-suggest__meta">${escapeHtml(String(s.place || ''))}</div>
            </button>
          `
            )
            .join('')}
        </div>
      `;

      suggestEl.querySelectorAll('button[data-id]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-id');
          const picked = items.find((x) => String(x.id) === String(id));
          if (picked) onPick?.(picked);
          close();
        });
      });
    };

    inputEl?.addEventListener('input', () => {
      const q = String(inputEl.value || '').trim();
      if (q === lastQ) return;
      lastQ = q;
      if (q.length < 3) {
        close();
        return;
      }
      const nq = normalizeKey(q);
      const tokens = nq.split(' ').filter(Boolean);

      const scored = [];
      for (const s of items) {
        const hayName = normalizeKey(String(s?.name || ''));
        const hayPlace = normalizeKey(String(s?.place || ''));
        const hayOther = normalizeKey(String(s?.nk || '') + ' ' + String(s?.ak || ''));
        const hayAll = (hayName + ' ' + hayPlace + ' ' + hayOther).trim();

        if (!tokens.every((t) => tokenInText(hayAll, t))) continue;

        // Rank: prefer exact/whole-word matches in name/place.
        let score = 0;
        for (const t of tokens) {
          if (wholeWordInText(hayPlace, t)) score += 6;
          else if (wholeWordInText(hayName, t)) score += 5;
          else if (tokenInText(hayPlace, t)) score += 4;
          else if (tokenInText(hayName, t)) score += 3;
          else if (tokenInText(hayOther, t)) score += 1;
        }

        // Small bonus: contiguous phrase in name.
        if (tokens.length >= 2 && hayName.includes(tokens.join(' '))) score += 2;

        scored.push({ s, score });
      }

      scored.sort((a, b) => b.score - a.score || String(a.s?.name || '').localeCompare(String(b.s?.name || ''), 'cs'));
      render(scored.slice(0, 10).map((x) => x.s));
    });

    document.addEventListener('click', (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest('[data-role=jobs-school-suggest]')) return;
      if (t.closest('[data-role=jobs-school]')) return;
      close();
    });

    return {
      setItems(next) {
        items = next || [];
      },
      close
    };
  }

  function initPlaceSuggest({ inputEl, suggestEl, onPick, getKrajLabel }) {
    let items = [];
    let lastQ = '';

    let clickBound = false;

    const close = () => {
      if (suggestEl) suggestEl.innerHTML = '';
    };

    const render = (list) => {
      if (!suggestEl) return;
      if (!list.length) {
        suggestEl.innerHTML = '';
        return;
      }

      suggestEl.innerHTML = `
        <div class="jobs-suggest__box">
          ${list
            .slice(0, 10)
            .map(
              (s) => `
            <button type="button" class="jobs-suggest__item" data-id="${escapeHtml(String(s.key || ''))}">
              <div class="jobs-suggest__title">${escapeHtml(String(s.name || ''))}</div>
              <div class="jobs-suggest__meta">${escapeHtml(
                String(
                  [
                    s.parent ? `část: ${s.parent}` : '',
                    s.okresName,
                    getKrajLabel?.(s.kraj),
                    s.t && s.t !== 'obec' ? String(s.t).toUpperCase() : ''
                  ]
                    .filter(Boolean)
                    .join(' · ')
                )
              )}</div>
            </button>
          `
            )
            .join('')}
        </div>
      `;

      // Bind once: event delegation (more reliable than per-button listeners).
      if (suggestEl && !clickBound) {
        clickBound = true;
        suggestEl.addEventListener('click', (e) => {
          const t = e.target;
          if (!(t instanceof Element)) return;
          const btn = t.closest('button[data-id]');
          if (!btn || !suggestEl.contains(btn)) return;
          e.preventDefault();
          e.stopPropagation();
          const id = btn.getAttribute('data-id');
          const picked = items.find((x) => String(x.key) === String(id));
          if (picked) onPick?.(picked);
          close();
        });
      }
    };

    inputEl?.addEventListener('input', () => {
      const q = String(inputEl.value || '').trim();
      if (q === lastQ) return;
      lastQ = q;
      if (q.length < 2) {
        close();
        return;
      }

      const nq = normalizeKey(q);
      const tokens = nq.split(' ').filter(Boolean);
      const exactKey = tokens.length === 1 ? tokens[0] : '';

      const scored = [];
      for (const s of items) {
        const hayName = normalizeKey(String(s?.name || ''));
        const hayOkres = normalizeKey(String(s?.okresName || ''));
        const hayKraj = normalizeKey(String(getKrajLabel?.(s?.kraj) || ''));
        const hayAll = (hayName + ' ' + hayOkres + ' ' + hayKraj).trim();

        if (!tokens.every((t) => tokenInText(hayAll, t))) continue;

        let score = 0;
        for (const t of tokens) {
          if (wholeWordInText(hayName, t)) score += 6;
          else if (tokenInText(hayName, t)) score += 4;
          else if (wholeWordInText(hayOkres, t)) score += 3;
          else if (tokenInText(hayOkres, t)) score += 2;
          else if (tokenInText(hayKraj, t)) score += 1;
        }

        // Strongly prefer exact-name matches for single-token queries (e.g. "Bor").
        if (exactKey && hayName === exactKey) score += 20;
        if (String(s?.t || '') === 'obec') score += 2;
        if (String(s?.t || '') === 'zsj') score -= 1;

        if (tokens.length >= 2 && hayName.includes(tokens.join(' '))) score += 2;
        scored.push({ s, score, hayName });
      }

      scored.sort(
        (a, b) =>
          b.score - a.score ||
          String(a.s?.name || '').length - String(b.s?.name || '').length ||
          String(a.s?.name || '').localeCompare(String(b.s?.name || ''), 'cs')
      );

      // If we have any exact-name hits for a single-token query, show only those.
      const exactHits = exactKey ? scored.filter((x) => x.hayName === exactKey) : [];
      const list = exactHits.length ? exactHits : scored;
      render(list.slice(0, 10).map((x) => x.s));
    });

    document.addEventListener('click', (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest('[data-role=jobs-place-suggest]')) return;
      if (t.closest('[data-role=jobs-place]')) return;
      close();
    });

    return {
      setItems(next) {
        items = next || [];
      },
      close
    };
  }

  function formatPickedPlaceLabel(picked, getKrajLabel) {
    const name = String(picked?.name || '').trim();
    if (!name) return '';
    const meta = [
      picked?.parent ? `část: ${String(picked.parent)}` : '',
      String(picked?.okresName || '').trim(),
      String(getKrajLabel?.(picked?.kraj) || '').trim()
    ]
      .filter(Boolean)
      .join(' · ');
    return meta ? `${name} (${meta})` : name;
  }

  async function init() {
    const form = document.querySelector('form[data-role=jobs-form]');
    if (!form) return;

    const schoolEl = $('input[data-role=jobs-school]', form);
    const schoolSuggestEl = $('[data-role=jobs-school-suggest]', form);
    const programEl = $('select[data-role=jobs-program]', form);
    const focusEl = $('select[data-role=jobs-focus]', form);

    const qEl = $('input[data-role=jobs-q]', form);
    const krajEl = $('select[data-role=jobs-kraj]', form);
    const placeEl = $('input[data-role=jobs-place]', form);
    const placeSuggestEl = $('[data-role=jobs-place-suggest]', form);
    const minEl = $('input[data-role=jobs-min]', form);
    const dojezdEl = $('input[data-role=jobs-dojezd]', form);

    const clearEl = $('[data-role=jobs-clear]', form);
    const statusEl = $('[data-role=jobs-status]', form);

    const recoEl = $('[data-role=jobs-reco]');
    const outEl = $('[data-role=jobs-results]');

    const ui = ensureJobsResultsUI(outEl);
    const listEl = ui?.listEl || outEl;

    const state = {
      page: 1,
      pageSize: 30
    };

    let lastResults = [];
    let lastPageJobs = [];

    const renderPage = ({ scrollTop = false } = {}) => {
      const hits = lastResults;

      const pageSizeRaw = state.pageSize;
      const size = pageSizeRaw === 'all' ? hits.length : Number(pageSizeRaw || 30);
      const safeSize = Number.isFinite(size) && size > 0 ? size : 30;
      const totalPages = Math.max(1, Math.ceil(hits.length / safeSize));
      state.page = Math.min(Math.max(1, Number(state.page || 1)), totalPages);

      const from = (state.page - 1) * safeSize;
      const to = from + safeSize;
      const pageHits = pageSizeRaw === 'all' ? hits : hits.slice(from, to);
      lastPageJobs = pageHits;

      // Update count pill (top pager)
      outEl
        ?.querySelectorAll('[data-role=jobs-count]')
        .forEach((el) => (el.textContent = String(hits.length)));

      renderJobs(listEl, pageHits);

      // Pager UI update
      outEl
        ?.querySelectorAll('[data-role=jobs-page-info]')
        .forEach((el) => (el.textContent = `Stránka ${state.page}/${Math.max(1, totalPages)}`));

      outEl
        ?.querySelectorAll('button[data-role=jobs-page-prev]')
        .forEach((btn) => (btn.disabled = state.page <= 1 || totalPages <= 1));
      outEl
        ?.querySelectorAll('button[data-role=jobs-page-next]')
        .forEach((btn) => (btn.disabled = state.page >= totalPages || totalPages <= 1));

      const desired = String(state.pageSize || '30');
      outEl?.querySelectorAll('select[data-role=jobs-page-size]').forEach((sel) => {
        if (String(sel.value) !== desired) sel.value = desired;
      });

      if (scrollTop) scrollResultsToTop(outEl);
    };

    // Pager handlers
    outEl?.addEventListener('click', (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;

      const detailBtn = t.closest('button[data-action=offer-detail]');
      if (detailBtn) {
        const idx = Number(detailBtn.getAttribute('data-idx'));
        const offer = Number.isFinite(idx) && idx >= 0 ? lastPageJobs[idx] : null;
        if (offer) openOfferModal(offer);
        return;
      }

      if (t.matches('button[data-role=jobs-page-prev]')) {
        state.page = Math.max(1, Number(state.page || 1) - 1);
        renderPage({ scrollTop: true });
        return;
      }
      if (t.matches('button[data-role=jobs-page-next]')) {
        state.page = Number(state.page || 1) + 1;
        renderPage({ scrollTop: true });
        return;
      }
    });

    outEl?.addEventListener('change', (e) => {
      const t = e.target;
      if (!(t instanceof HTMLSelectElement)) return;
      if (!t.matches('select[data-role=jobs-page-size]')) return;
      const val = String(t.value || '30');
      state.pageSize = val === 'all' ? 'all' : Number(val) || 30;
      state.page = 1;
      renderPage({ scrollTop: true });
    });

    let allJobs = [];
    let tagList = [];

    let selectedSchool = null;
    let selectedCategory = 'other';
    let selectedPlace = null;

    const sugg = initSchoolSuggest({
      inputEl: schoolEl,
      suggestEl: schoolSuggestEl,
      onPick(picked) {
        selectedSchool = picked;
        if (schoolEl) schoolEl.value = picked.name;

        const programs = (picked.programs || []).map((p) => ({
          value: String(p.code || p.name || ''),
          label: String(p.name || p.code || '—'),
          __name: String(p.name || '')
        }));

        populateSelect(programEl, programs, { emptyLabel: 'Vyber obor…' });
        selectedCategory = 'other';
        populateSelect(focusEl, (FOCUS_BY_CATEGORY.other || []).map((x) => ({ value: x.id, label: x.label })), {
          emptyLabel: 'Bez zaměření'
        });

        run();
      }
    });

    statusEl.textContent = 'Načítám databázi škol…';

    let schoolIndex = null;
    try {
      schoolIndex = await fetchJSON('data/skoly_index.json');
    } catch {
      statusEl.textContent = 'Nepodařilo se načíst data škol (doporučení oborů bude omezené).';
    }

    const schools = Array.isArray(schoolIndex?.schools) ? schoolIndex.schools : [];
    sugg.setItems(
      schools.map((s) => {
        const a = s?.adresa || {};
        const place = [a.obec, a.okres, a.kraj].filter(Boolean).join(' · ');
        return { ...s, place };
      })
    );

    if (statusEl.textContent.startsWith('Načítám')) statusEl.textContent = '';

    // Populate kraj select
    populateSelect(
      krajEl,
      CZ_REGIONS.map((r) => ({ value: r.code, label: r.name })),
      { emptyLabel: 'Všechny kraje' }
    );

    const placeSugg = initPlaceSuggest({
      inputEl: placeEl,
      suggestEl: placeSuggestEl,
      getKrajLabel: (code) => CZ_REGION_NAME_BY_CODE[String(code || '').trim()] || '',
      onPick(picked) {
        const display = formatPickedPlaceLabel(picked, (code) => CZ_REGION_NAME_BY_CODE[String(code || '').trim()] || '');
        selectedPlace = { ...picked, __display: display };
        if (placeEl) placeEl.value = display || picked.name;
        run();
      }
    });

    // Load MPSV offers (daily build)
    statusEl.textContent = 'Načítám volná místa (MPSV)…';
    try {
      const loaded = await loadMpsvOffers();
      allJobs = loaded.offers || [];
      tagList = loaded.tags || [];
      statusEl.textContent = '';
    } catch {
      statusEl.textContent = 'Nepodařilo se načíst volná místa (MPSV).';
      allJobs = [];
      tagList = [];
    }

    // Load place suggest list
    try {
      const suggest = await fetchJSON('data/obce_suggest.json');
      const items = Array.isArray(suggest?.items) ? suggest.items : [];
      placeSugg.setItems(items);
    } catch {
      // ignore
    }

    function updateCategoryAndFocus() {
      const selected = String(programEl?.value || '');
      const programName =
        (selectedSchool?.programs || []).find((p) => String(p.code || p.name || '') === selected)?.name || '';
      selectedCategory = categoryFromProgramName(programName);
      const opts = (FOCUS_BY_CATEGORY[selectedCategory] || FOCUS_BY_CATEGORY.other).map((x) => ({
        value: x.id,
        label: x.label
      }));
      populateSelect(focusEl, opts, { emptyLabel: 'Bez zaměření' });
    }

    let runSeq = 0;
    const offerCoordsCache = new Map();

    async function distanceKmForOffer(offer, originPoint) {
      const obec = String(offer?.obec || '').trim();
      const kraj = String(offer?.kraj || '').trim();
      if (!obec || !originPoint) return null;

      const key = `${normalizeKey(obec)}|${kraj}`;
      if (offerCoordsCache.has(key)) {
        const cached = offerCoordsCache.get(key);
        if (!cached) return null;
        return haversineKm(originPoint, cached);
      }

      const coords = await lookupObecCoords(obec, kraj);
      offerCoordsCache.set(key, coords);
      if (!coords) return null;
      return haversineKm(originPoint, coords);
    }

    async function runSearch({ resetPage = false } = {}) {
      const seq = ++runSeq;
      const focusId = String(focusEl?.value || '').trim();
      const roles = recommendedRoles({ category: selectedCategory, focusId });
      renderReco(recoEl, roles);

      const query = String(qEl?.value || '').trim();
      const minWage = Number(minEl?.value || 0) || 0;
      const maxKm = Number(dojezdEl?.value || 0) || 0;

      const kraj = String(krajEl?.value || '').trim();
      const placeNameRaw = String(placeEl?.value || '').trim();
      const placeRawNorm = normalizeKey(placeNameRaw);
      const selNameNorm = normalizeKey(selectedPlace?.name || '');
      const selDisplayNorm = normalizeKey(selectedPlace?.__display || '');

      const hasSelectedPlace =
        Boolean(selectedPlace?.key) &&
        Boolean(selectedPlace?.name) &&
        (placeRawNorm === selNameNorm || (selDisplayNorm && placeRawNorm === selDisplayNorm));

      const placeName = hasSelectedPlace ? selectedPlace.name : placeNameRaw;
      const placeKraj = selectedPlace?.kraj || '';

      // Used for display only; filtering should not depend on these.
      const roleTokens = roles.map((r) => normalizeKey(r.title)).filter(Boolean);

      let originPoint = null;
      const needKmFilter = !!maxKm;
      const canUsePlace = placeName && placeName.length >= 2;

      if (needKmFilter) {
        if (!canUsePlace) {
          if (statusEl) statusEl.textContent = 'Pro dojezd vyber „Moje poloha“. (Zadej alespoň 2 znaky)';
          lastResults = [];
          if (resetPage) state.page = 1;
          renderPage({ scrollTop: false });
          return;
        }
        if (statusEl) statusEl.textContent = 'Počítám dojezd…';
        originPoint = hasSelectedPlace
          ? await lookupPlaceCoordsByKey(selectedPlace.key)
          : await lookupObecCoords(placeName, placeKraj);
        if (seq !== runSeq) return;
        if (!originPoint) {
          if (statusEl) statusEl.textContent = 'Nepodařilo se najít souřadnice pro zadanou polohu.';
          lastResults = [];
          if (resetPage) state.page = 1;
          renderPage({ scrollTop: false });
          return;
        }
        await ensureObceIndexLoaded();
        if (seq !== runSeq) return;
      }

      const filtered = allJobs
        .filter((j) => {
          if (kraj) return String(j.kraj || '').trim() === kraj;
          return true;
        })
        .filter((j) => focusMatchesOffer(j, focusId))
        .filter((j) => {
          if (!minWage) return true;
          const w = offerMonthlyWagePoint(j);
          return w != null && w >= minWage;
        })
        .filter((j) => {
          const text = jobToText(j);
          if (!query) return true;
          return matchesAllTokens(text, query);
        })

      let withKm = filtered;
      if (needKmFilter && originPoint) {
        withKm = [];
        for (const j of filtered) {
          const d = await distanceKmForOffer(j, originPoint);
          if (seq !== runSeq) return;
          if (d == null) continue;
          if (d <= maxKm) withKm.push({ ...j, __distKm: d });
        }
      }

      withKm.sort((a, b) => {
        const ad = String(a?.datum || '');
        const bd = String(b?.datum || '');
        if (bd !== ad) return bd.localeCompare(ad);
        return String(a?.profese || '').localeCompare(String(b?.profese || ''), 'cs');
      });

      // If we don't filter by km, but a place is selected, compute distance only for the first ~200 rows.
      if (!needKmFilter && canUsePlace) {
        originPoint = hasSelectedPlace
          ? await lookupPlaceCoordsByKey(selectedPlace.key)
          : await lookupObecCoords(placeName, placeKraj);
        if (seq !== runSeq) return;
        if (originPoint) {
          const limited = withKm.slice(0, 200);
          const enriched = [];
          for (const j of limited) {
            const d = await distanceKmForOffer(j, originPoint);
            if (seq !== runSeq) return;
            enriched.push(d == null ? j : { ...j, __distKm: d });
          }
          // Keep order
          withKm = [...enriched, ...withKm.slice(200)];
        }
      }

      lastResults = withKm;
      if (resetPage) state.page = 1;
      if (statusEl && !statusEl.textContent.startsWith('Nepodařilo') && !statusEl.textContent.startsWith('Pro dojezd')) {
        // Keep status line empty; count + paging info is in pager.
        statusEl.textContent = '';
      }
      renderPage({ scrollTop: false });
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      runSearch({ resetPage: true });
    });

    qEl?.addEventListener('input', () => {
      if (String(qEl.value || '').trim().length >= 3 || !String(qEl.value || '').trim()) runSearch({ resetPage: true });
    });

    programEl?.addEventListener('change', () => {
      updateCategoryAndFocus();
      runSearch({ resetPage: true });
    });

    focusEl?.addEventListener('change', () => runSearch({ resetPage: true }));
    krajEl?.addEventListener('change', () => runSearch({ resetPage: true }));
    placeEl?.addEventListener('input', () => {
      selectedPlace = null;
      if (String(placeEl.value || '').trim().length >= 2 || !String(placeEl.value || '').trim()) runSearch({ resetPage: true });
    });
    minEl?.addEventListener('input', () => runSearch({ resetPage: true }));
    dojezdEl?.addEventListener('input', () => runSearch({ resetPage: true }));

    clearEl?.addEventListener('click', () => {
      selectedSchool = null;
      selectedCategory = 'other';
      selectedPlace = null;
      if (schoolEl) schoolEl.value = '';
      if (programEl) programEl.value = '';
      if (focusEl) focusEl.value = '';
      if (qEl) qEl.value = '';
      if (krajEl) krajEl.value = '';
      if (placeEl) placeEl.value = '';
      if (minEl) minEl.value = '';
      if (dojezdEl) dojezdEl.value = '';

      populateSelect(programEl, [], { emptyLabel: '—' });
      populateSelect(focusEl, [], { emptyLabel: 'Bez zaměření' });

      state.page = 1;
      runSearch({ resetPage: true });
    });

    // Initial state
    populateSelect(programEl, [], { emptyLabel: '—' });
    populateSelect(focusEl, [], { emptyLabel: 'Bez zaměření' });
    renderReco(recoEl, []);
    runSearch({ resetPage: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
