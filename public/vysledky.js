(function(){
  'use strict';

  function escapeHtml(s){
    return String(s == null ? '' : s)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function readLast(){
    try{
      const raw = localStorage.getItem('advisor_last_payload_v1');
      if(!raw) return null;
      const parsed = JSON.parse(raw);
      const at = Number(parsed?.at || 0) || 0;
      const payload = parsed?.payload && typeof parsed.payload === 'object' ? parsed.payload : null;
      if(!payload) return null;
      return { at, payload };
    }catch{
      return null;
    }
  }

  function fmtTime(ts){
    if(!ts) return '';
    try{
      return new Date(ts).toLocaleString('cs-CZ', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
    }catch{
      return '';
    }
  }

  function el(sel){
    return document.querySelector(sel);
  }

  function render(){
    const metaEl = el('[data-role=results-meta]');
    const intentEl = el('[data-role=results-intent]');
    const sumEl = el('[data-role=results-summary]');
    const actionsEl = el('[data-role=results-actions]');
    const jobsEl = el('[data-role=results-jobs]');
    const eduEl = el('[data-role=results-edu]');

    const last = readLast();
    if(!last){
      if(metaEl) metaEl.textContent = 'Nenalezené výsledky v prohlížeči.';
      if(intentEl) intentEl.textContent = '—';
      if(sumEl) sumEl.innerHTML = '<div class="muted">Otevři poradce na homepage a napiš dotaz (např. „Hledám práci automechanik v Plzni“).</div>';
      if(actionsEl) actionsEl.innerHTML = '';
      if(jobsEl) jobsEl.innerHTML = '';
      if(eduEl) eduEl.innerHTML = '';
      return;
    }

    const p = last.payload;
    const intent = String(p?.intent || '').trim() || 'general';
    const reply = String(p?.reply || '').trim();

    const jobsUrl = String(p?.jobs_url || '').trim();
    const jobsN = p?.jobs_match_count != null ? Number(p.jobs_match_count) : null;
    const recos = Array.isArray(p?.recommendations) ? p.recommendations : [];

    const eduUrl = String(p?.edu_url || '').trim();
    const eduN = p?.edu_match_count != null ? Number(p.edu_match_count) : null;
    const eduRecos = Array.isArray(p?.edu_recommendations) ? p.edu_recommendations : [];

    if(metaEl) metaEl.textContent = last.at ? `Uloženo: ${fmtTime(last.at)}` : 'Uloženo: —';
    if(intentEl) intentEl.textContent = intent === 'jobs' ? 'Téma: Práce' : intent === 'edu' ? 'Téma: Vzdělání' : intent === 'courses' ? 'Téma: Kurzy' : 'Téma: Obecný dotaz';

    if(sumEl){
      sumEl.innerHTML = reply ? `<div>${escapeHtml(reply)}</div>` : '<div class="muted">(Bez textové odpovědi.)</div>';
    }

    // Actions
    const buttons = [];
    if(jobsUrl){
      const label = Number.isFinite(jobsN) && jobsN > 0 ? `Otevřít nabídky (${jobsN})` : 'Otevřít nabídky práce';
      buttons.push(`<a class="btn btn--primary" href="${escapeHtml(jobsUrl)}">${escapeHtml(label)}</a>`);
    }
    if(eduUrl){
      const label = Number.isFinite(eduN) && eduN > 0 ? `Otevřít školy (${eduN})` : 'Otevřít vzdělání';
      buttons.push(`<a class="btn btn--purple-dark" href="${escapeHtml(eduUrl)}">${escapeHtml(label)}</a>`);
    }
    if(actionsEl){
      actionsEl.innerHTML = buttons.length ? `<div style="display:flex; gap:.6rem; flex-wrap:wrap">${buttons.join('')}</div>` : '';
    }

    // Jobs cards
    if(jobsEl){
      if(recos.length){
        const cards = recos.slice(0,5).map((r)=>{
          const title = escapeHtml(String(r?.profese || ''));
          const firm = escapeHtml(String(r?.zamestnavatel || ''));
          const where = escapeHtml(String(r?.lokalita || r?.obec || ''));
          const wage = escapeHtml(String(r?.mzda_text || ''));
          const url = String(r?.url_adresa || '').trim();
          const link = url ? `<a class="btn btn--ghost" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Detail na ÚP</a>` : '';
          return `<div class="card" style="margin-top:.75rem"><div style="font-weight:900">${title || 'Pozice'}</div>${firm ? `<div class="muted">${firm}</div>`:''}${where?`<div class="muted">${where}</div>`:''}${wage?`<div class="muted">${wage}</div>`:''}<div style="margin-top:.6rem; display:flex; gap:.6rem; flex-wrap:wrap">${link}</div></div>`;
        }).join('');
        jobsEl.innerHTML = `<h2 class="section-title" style="margin-top:1.2rem">Top nabídky práce</h2>${cards}`;
      }else{
        jobsEl.innerHTML = '';
      }
    }

    // Edu cards
    if(eduEl){
      if(eduRecos.length){
        const cards = eduRecos.slice(0,5).map((r)=>{
          const school = escapeHtml(String(r?.school_name || ''));
          const place = escapeHtml(String([r?.obec, r?.kraj].filter(Boolean).join(' · ')));
          const program = escapeHtml(String(r?.program_name || ''));
          const code = escapeHtml(String(r?.program_code || ''));
          const meta = escapeHtml(String([r?.stupen, r?.forma].filter(Boolean).join(' · ')));
          const urlRaw = String(r?.url || '').trim();
          const url = urlRaw && !/^https?:\/\//i.test(urlRaw) ? `https://${urlRaw}` : urlRaw;
          const link = url ? `<a class="btn btn--ghost" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Web školy</a>` : '';
          return `<div class="card" style="margin-top:.75rem"><div style="font-weight:900">${school || 'Škola'}</div>${place?`<div class="muted">${place}</div>`:''}${program?`<div style="margin-top:.35rem">${program}${code?` <span class=\"muted\">(${code})</span>`:''}</div>`:''}${meta?`<div class="muted">${meta}</div>`:''}<div style="margin-top:.6rem; display:flex; gap:.6rem; flex-wrap:wrap">${link}</div></div>`;
        }).join('');
        eduEl.innerHTML = `<h2 class="section-title" style="margin-top:1.2rem">Top školy / obory</h2>${cards}`;
      }else{
        eduEl.innerHTML = '';
      }
    }
  }

  function wire(){
    const clearBtn = el('[data-role=results-clear]');
    if(clearBtn){
      clearBtn.addEventListener('click', ()=>{
        try{ localStorage.removeItem('advisor_last_payload_v1'); }catch{}
        render();
      });
    }
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', ()=>{ wire(); render(); });
  }else{
    wire();
    render();
  }
})();
