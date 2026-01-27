/* Demo job datasets + renderer (shared across pages)
   Exposes:
   - window.DATA (for chatbot)
   - window.JobsDemo.initOborPage(target)
*/

(function(){
  'use strict';

  // ===== Demo datasety (statická ukázka) =====
  const DATA = {
    auto: [
      {kraj:"Německo", area:"zahranici_bor", okres:"92637 Weiden", profese:"Kfz-Mechaniker / Mechatroniker (m/w/d)", cz_isco:"72311", mzda_od:30000, mzda_do:40000, zamestnavatel:"A.T.U Auto-Teile-Unger", datum:"2025-11-07"},
      {kraj:"Německo", area:"zahranici_bor", okres:"92637 Weiden", profese:"Zweiradmechatroniker (m/w/d)", cz_isco:"72311", mzda_od:30000, mzda_do:40000, zamestnavatel:"Zweirad-Center Weiden", datum:"2025-11-07"},
      {kraj:"Německo", area:"zahranici_bor", okres:"92729 Weiherhammer", profese:"Industriemechaniker (m/w/d)", cz_isco:"72311", mzda_od:30000, mzda_do:40000, zamestnavatel:"BHS Corrugated", datum:"2025-11-07"},
      {kraj:"Německo", area:"zahranici_bor", okres:"92637 Weiden", profese:"KFZ-Mechatroniker (m/w/d) - Nutzfahrzeugtechnik", cz_isco:"72311", mzda_od:30000, mzda_do:40000, zamestnavatel:"Autohaus Weiden", datum:"2025-11-07"},
      {kraj:"CZ032", okres:"Plzeň-město", profese:"Mechanik opravář motorových vozidel (automechanik)", cz_isco:"72311", mzda_od:28000, mzda_do:35000, zamestnavatel:"AutoServis Plzeň s.r.o.", datum:"2025-10-15"},
      {kraj:"CZ032", okres:"Tachov", profese:"Automechanik", cz_isco:"72311", mzda_od:29000, mzda_do:36000, zamestnavatel:"Truck & Car Tachov a.s.", datum:"2025-10-14"},
      {kraj:"CZ041", okres:"Karlovy Vary", profese:"Automechanik – osobní vozy", cz_isco:"72311", mzda_od:27000, mzda_do:34000, zamestnavatel:"KV Auto, spol. s r.o.", datum:"2025-10-13"},
      {kraj:"CZ041", okres:"Sokolov", profese:"Mechanik opravář motorových vozidel", cz_isco:"72311", mzda_od:26000, mzda_do:33000, zamestnavatel:"Sokolov Auto Repair", datum:"2025-10-12"}
    ],
    agri: [
      {kraj:"Německo", area:"zahranici_bor", okres:"Marktleuthen", profese:"Land-/Baumaschinenmechatroniker/in", cz_isco:"72334", mzda_od:30000, mzda_do:40000, zamestnavatel:"Wunderlich Christof", datum:"2025-10-20"},
      {kraj:"Německo", area:"zahranici_bor", okres:"Bad Laer", profese:"Landmaschinenmechaniker/in", cz_isco:"72334", mzda_od:30000, mzda_do:40000, zamestnavatel:"SOVEA Personalservice GmbH", datum:"2025-10-19"},
      {kraj:"Německo", area:"zahranici_bor", okres:"Friesoythe", profese:"Landmaschinenmechaniker/in", cz_isco:"72334", mzda_od:30000, mzda_do:40000, zamestnavatel:"pluss Personalmanagement GmbH", datum:"2025-10-18"},
      {kraj:"Německo", area:"zahranici_bor", okres:"95643 Tirschenreuth", profese:"Land- und Baumaschinenmechatroniker/in", cz_isco:"72334", mzda_od:30000, mzda_do:40000, zamestnavatel:"BayWa AG", datum:"2025-11-07"},
      {kraj:"Německo", area:"zahranici_bor", okres:"95632 Wunsiedel", profese:"Land- und Baumaschinenmechatroniker (m/w/d)", cz_isco:"72334", mzda_od:30000, mzda_do:40000, zamestnavatel:"XXXLutz", datum:"2025-11-07"},
      {kraj:"Německo", area:"zahranici_bor", okres:"95676 Wiesau", profese:"Servicetechniker für Landmaschinen (m/w/d)", cz_isco:"72334", mzda_od:30000, mzda_do:40000, zamestnavatel:"CLAAS", datum:"2025-11-07"},
      {kraj:"CZ032", okres:"Klatovy", profese:"Opravář zemědělských strojů", cz_isco:"72334", mzda_od:29000, mzda_do:38000, zamestnavatel:"Agro KT Servis s.r.o.", datum:"2025-10-15"},
      {kraj:"CZ032", okres:"Plzeň-jih", profese:"Mechanik zemědělské techniky", cz_isco:"72334", mzda_od:30000, mzda_do:40000, zamestnavatel:"ZETOR Agro Plzeň", datum:"2025-10-14"},
      {kraj:"CZ041", okres:"Cheb", profese:"Opravář zemědělských a lesnických strojů", cz_isco:"72334", mzda_od:28000, mzda_do:37000, zamestnavatel:"FarmTech Západ", datum:"2025-10-13"}
    ],
    gastro: [
      {kraj:"Německo", area:"zahranici_bor", okres:"95632 Wunsiedel", profese:"Koch (m/w/d)", cz_isco:"5120", mzda_od:28000, mzda_do:35000, zamestnavatel:"Hotel Bayerischer Hof", datum:"2025-11-07"},
      {kraj:"Německo", area:"zahranici_bor", okres:"92637 Weiden", profese:"Koch (m/w/d)", cz_isco:"5120", mzda_od:28000, mzda_do:35000, zamestnavatel:"BräuWirt", datum:"2025-11-07"},
      {kraj:"Německo", area:"zahranici_bor", okres:"95652 Waldsassen", profese:"Alleinkoch (m/w/d)", cz_isco:"5120", mzda_od:28000, mzda_do:35000, zamestnavatel:"Hotel zum ehem. Königlich-Bayerischen Forsthaus", datum:"2025-11-07"},
      {kraj:"Německo", area:"zahranici_bor", okres:"92637 Weiden i.d.OPf.", profese:"Kellner / Servicemitarbeiter (m/w/d)", cz_isco:"5131", mzda_od:26000, mzda_do:32000, zamestnavatel:"Hotel Stadtkrug", datum:"2025-11-07"},
      {kraj:"Německo", area:"zahranici_bor", okres:"95698 Neualbenreuth", profese:"Servicekraft (m/w/d)", cz_isco:"5131", mzda_od:26000, mzda_do:32000, zamestnavatel:"Schlosshotel Ernestgrün", datum:"2025-11-07"},
      {kraj:"Německo", area:"zahranici_bor", okres:"95643 Tirschenreuth", profese:"Koch/Köchin", cz_isco:"5120", mzda_od:28000, mzda_do:35000, zamestnavatel:"Kliniken Nordoberpfalz AG", datum:"2025-11-07"},
      {kraj:"Německo", area:"zahranici_bor", okres:"95643 Tirschenreuth", profese:"Koch (m/w/d) Pflegeheim", cz_isco:"5120", mzda_od:28000, mzda_do:35000, zamestnavatel:"BRK-Kreisverband Tirschenreuth", datum:"2025-11-07"},
      {kraj:"CZ032", okres:"Plzeň-město", profese:"Kuchař – teplá kuchyně", cz_isco:"51201", mzda_od:26000, mzda_do:32000, zamestnavatel:"Restaurace U Zvonu", datum:"2025-10-15"},
      {kraj:"CZ032", okres:"Tachov", profese:"Číšník/servírka", cz_isco:"5131", mzda_od:23000, mzda_do:30000, zamestnavatel:"Hotel Svět", datum:"2025-10-14"},
      {kraj:"CZ041", okres:"Karlovy Vary", profese:"Kuchař studené kuchyně", cz_isco:"51201", mzda_od:24000, mzda_do:31000, zamestnavatel:"Grand Bistro KV", datum:"2025-10-13"},
      {kraj:"CZ041", okres:"Sokolov", profese:"Číšník/servírka", cz_isco:"5131", mzda_od:22000, mzda_do:28000, zamestnavatel:"Penzion Sokol", datum:"2025-10-12"}
    ]
  };

  function median(arr){
    if(!arr.length) return null;
    const s=[...arr].sort((a,b)=>a-b);
    const m=Math.floor(s.length/2);
    return s.length%2? s[m] : Math.round((s[m-1]+s[m])/2);
  }

  function q(target, selector){
    // allow both [data-id=foo-target] and [data-id=foo]
    const el1 = document.querySelector(selector.replace('$t', target));
    if (el1) return el1;
    return document.querySelector(selector.replace('-$t','').replace('$t',''));
  }

  function render(target){
    const regionSel = document.querySelector(`select[data-role=region][data-target="${target}"]`) || document.querySelector('select[data-role=region]');
    const region = regionSel ? regionSel.value : '';

    const rows = (DATA[target]||[])
      .filter(r => {
        if (region === 'zahranici_bor') return r.area === 'zahranici_bor';
        return !region || r.kraj === region;
      })
      .sort((a,b)=> (b.datum||'').localeCompare(a.datum||''));

    const wages = rows.map(r=> r.mzda_od).filter(v=> typeof v==='number' && !Number.isNaN(v));
    const med = median(wages);
    const fmt = (n)=> n==null? '–' : n.toLocaleString('cs-CZ');

    const countEl = q(target, `[data-id="count-$t"]`);
    const medianEl = q(target, `[data-id="median-$t"]`);
    if (countEl) countEl.textContent = rows.length;
    if (medianEl) medianEl.textContent = fmt(med);

    const cnt={}; rows.forEach(r=> cnt[r.zamestnavatel]=(cnt[r.zamestnavatel]||0)+1);
    const top = Object.entries(cnt).sort((a,b)=>b[1]-a[1]).slice(0,10);
    const ol = q(target, `[data-id="top-$t"]`);
    if (ol){
      ol.innerHTML='';
      top.forEach(([name,c])=>{ const li=document.createElement('li'); li.textContent=`${name} (${c})`; ol.appendChild(li); });
    }

    const tb = q(target, `[data-id="tbl-$t"]`);
    if (tb){
      tb.innerHTML='';
      rows.forEach(r=>{
        const tr=document.createElement('tr');
        const mzda = (r.mzda_od? r.mzda_od.toLocaleString('cs-CZ'):'') + (r.mzda_do? '–'+r.mzda_do.toLocaleString('cs-CZ'):'');
        tr.innerHTML = `<td>${r.profese||''}</td><td>${r.zamestnavatel||''}</td><td>${r.okres||''}</td><td>${mzda||''}</td><td>${r.datum||''}</td>`;
        tb.appendChild(tr);
      });
    }
  }

  function initOborPage(target){
    // Button(s)
    Array.from(document.querySelectorAll('[data-role=load]')).forEach(btn=>{
      const t = btn.getAttribute('data-target');
      if (!t || t === target){
        btn.addEventListener('click', ()=> render(target));
      }
    });

    // Select(s)
    Array.from(document.querySelectorAll('select[data-role=region]')).forEach(sel=>{
      const t = sel.getAttribute('data-target');
      if (!t || t === target){
        sel.addEventListener('change', ()=> render(target));
      }
    });

    render(target);
  }

  // expose globals
  window.DATA = DATA;
  window.JobsDemo = { initOborPage };
})();
