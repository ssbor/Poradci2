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

  const sendToChatbot = (text) => {
    const bot = window.JobBot;
    if (bot && typeof bot.open === 'function' && typeof bot.send === 'function') {
      bot.open();
      bot.send(text);
      return true;
    }
    return false;
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const text = String(inputEl?.value || '').trim();
    if (!text) {
      setStatus('Napiš prosím stručně, co máš vystudováno a co umíš.');
      return;
    }

    setStatus('Otevírám chat…');
    if (btnEl) btnEl.disabled = true;

    const ok = sendToChatbot(text);
    if (ok) {
      if (inputEl) inputEl.value = '';
      setStatus('');
      if (btnEl) btnEl.disabled = false;
      return;
    }

    setStatus('Chatbot není na stránce dostupný.');
    if (btnEl) btnEl.disabled = false;
  });
});
