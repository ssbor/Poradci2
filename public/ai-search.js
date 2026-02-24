document.addEventListener('DOMContentLoaded', () => {
  const form = document.querySelector('form[data-role="ai-job-form"]');
  if (!form) return;

  const inputEl = form.querySelector('textarea[data-role="ai-job-input"]');
  const statusEl = form.querySelector('[data-role="ai-job-status"]');
  const btnEl = form.querySelector('button[type="submit"]');

  const setStatus = (txt) => {
    if (!statusEl) return;
    statusEl.textContent = String(txt || '');
  };

  const buildJobsUrl = (search) => {
    const params = new URLSearchParams();
    const q = String((search && search.q) || '').trim();
    const kraj = String((search && search.kraj) || '').trim();
    const place = String((search && search.place) || '').trim();
    const minMzda = Number((search && search.minMzda) || 0) || 0;
    const dojezdKm = Number((search && search.dojezdKm) || 0) || 0;

    if (q) params.set('q', q);
    if (kraj) params.set('kraj', kraj);
    if (place) params.set('place', place);
    if (minMzda) params.set('min', String(Math.round(minMzda)));
    if (dojezdKm) params.set('km', String(Math.round(dojezdKm)));

    const qs = params.toString();
    return 'prace.html' + (qs ? '?' + qs : '') + '#hledani';
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const text = String(inputEl?.value || '').trim();
    if (!text) {
      setStatus('Napiš prosím stručně, co máš vystudováno a co umíš.');
      return;
    }

    setStatus('Přemýšlím…');
    if (btnEl) btnEl.disabled = true;

    try {
      const resp = await fetch('/.netlify/functions/ai-chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: 'jobs',
          context: { page: 'index' },
          messages: [{ role: 'user', content: text }]
        })
      });

      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        const msg = String(data?.error || 'AI služba není dostupná.');
        setStatus(msg);
        return;
      }

      const url = buildJobsUrl(data?.search);
      window.location.href = url;
    } catch {
      setStatus('Nepodařilo se spojit s AI službou.');
    } finally {
      if (btnEl) btnEl.disabled = false;
    }
  });
});
