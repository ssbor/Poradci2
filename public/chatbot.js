document.addEventListener('DOMContentLoaded', () => {
	const chatTrigger = document.getElementById('chat-trigger');
	const chatWindow = document.getElementById('chat-window');
	const chatMessages = document.getElementById('chat-messages');
	const chatInput = document.getElementById('chat-input-field');
	const chatSendButton = document.getElementById('chat-send-btn');

	if (!chatTrigger || !chatWindow || !chatMessages || !chatInput || !chatSendButton) return;

	const state = {
		messages: [],
		busy: false,
		lastSearch: null
	};

	const escapeHtml = (s) =>
		String(s == null ? '' : s)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#039;');

	const escapeHtmlWithBreaks = (s) => escapeHtml(String(s || '')).replace(/\r\n|\r|\n/g, '<br>');

	const addMessageToChat = (text, sender, { html = false } = {}) => {
		const messageElement = document.createElement('div');
		messageElement.classList.add('chat-message', sender);
		messageElement.innerHTML = html ? String(text || '') : escapeHtmlWithBreaks(text);
		chatMessages.appendChild(messageElement);
		chatMessages.scrollTop = chatMessages.scrollHeight;
	};

	const setBusy = (isBusy) => {
		state.busy = !!isBusy;
		chatSendButton.disabled = state.busy;
		chatInput.disabled = state.busy;
	};

	const buildJobsUrl = (search) => {
		const params = new URLSearchParams();
		const q = String(search?.q || '').trim();
		const kraj = String(search?.kraj || '').trim();
		const place = String(search?.place || '').trim();
		const minMzda = Number(search?.minMzda || 0) || 0;
		const dojezdKm = Number(search?.dojezdKm || 0) || 0;

		if (q) params.set('q', q);
		if (kraj) params.set('kraj', kraj);
		if (place) params.set('place', place);
		if (minMzda) params.set('min', String(Math.round(minMzda)));
		if (dojezdKm) params.set('km', String(Math.round(dojezdKm)));

		const qs = params.toString();
		return `prace.html${qs ? `?${qs}` : ''}#hledani`;
	};

	const offerDetailUrl = (offer) => {
		const direct = String((offer && (offer.url_adresa || offer.urlAdresa || offer.url || offer.detail_url)) || '').trim();
		if (/^https?:\/\//i.test(direct)) return direct;
		const pidRaw = offer && (offer.portal_id != null ? offer.portal_id : offer.portalId);
		const pid = pidRaw == null ? '' : String(pidRaw).trim();
		if (pid) return 'https://www.uradprace.cz/volna-mista-v-cr#/volna-mista-detail/' + encodeURIComponent(pid);
		return '';
	};

	const callAI = async () => {
		const page = location.pathname.split('/').pop() || 'index.html';
		const resp = await fetch('/.netlify/functions/ai-chat', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				mode: 'jobs',
				context: { page },
				messages: state.messages
			})
		});

		const data = await resp.json().catch(() => null);
		if (!resp.ok) {
			const msg = String(data?.error || 'AI služba není dostupná.');
			throw new Error(msg);
		}
		return data;
	};

	const sendMessage = async () => {
		const messageText = String(chatInput.value || '').trim();
		if (!messageText) return;
		if (state.busy) return;

		addMessageToChat(messageText, 'user');
		chatInput.value = '';
		state.messages.push({ role: 'user', content: messageText });

		setBusy(true);
		try {
			const data = await callAI();
			const reply = String((data && data.reply) || '').trim();
			const followUp = data && data.follow_up ? String(data.follow_up).trim() : '';
			state.lastSearch = data?.search || null;
			const recos = Array.isArray(data?.recommendations) ? data.recommendations : [];

			let html = escapeHtmlWithBreaks(reply || 'Rozumím.');

			if (recos.length) {
				html += '<br><br><b>Doporučené nabídky:</b><br>';
				html += '<div style="display:grid; gap:.45rem; margin-top:.35rem">';
				for (const r of recos.slice(0, 5)) {
					const title = escapeHtml(String(r?.profese || ''));
					const firm = escapeHtml(String(r?.zamestnavatel || ''));
					const where = escapeHtml(String(r?.lokalita || r?.obec || ''));
					const wage = escapeHtml(String(r?.mzda_text || ''));
					const url = offerDetailUrl(r);
					html += '<div style="border:1px solid rgba(255,255,255,.12); padding:.45rem .55rem; border-radius:.6rem">';
					html += `<div style="font-weight:700">${title || 'Pozice'}</div>`;
					if (firm) html += `<div style="opacity:.92">${firm}</div>`;
					if (where) html += `<div style="opacity:.85">${where}</div>`;
					if (wage) html += `<div style="opacity:.85">${wage}</div>`;
					if (url) html += `<div style="margin-top:.2rem"><a href="${url}" target="_blank" rel="noopener noreferrer">Otevřít na ÚP</a></div>`;
					html += '</div>';
				}
				html += '</div>';
			}

			if (state.lastSearch && (state.lastSearch.q || state.lastSearch.kraj || state.lastSearch.place)) {
				const url = buildJobsUrl(state.lastSearch);
				html += `<br><br>Odkaz: <a href="${url}">Otevřít vyfiltrované nabídky</a>`;
			}
			if (followUp) html += '<br><br>' + escapeHtmlWithBreaks(followUp);

			addMessageToChat(html, 'bot', { html: true });
			state.messages.push({ role: 'assistant', content: reply || '' });
		} catch (e) {
			addMessageToChat(String(e?.message || 'Něco se nepovedlo.'), 'bot');
		} finally {
			setBusy(false);
		}
	};

	chatTrigger.addEventListener('click', () => {
		const open = chatWindow.style.display === 'flex';
		chatWindow.style.display = open ? 'none' : 'flex';
		if (!open && chatMessages.children.length === 0) {
			addMessageToChat(
				'Jsem kariérový poradce. Napiš mi co máš vystudováno, co umíš, kde chceš pracovat a jakou mzdu očekáváš. Já z toho připravím chytré hledání.',
				'bot'
			);
		}
	});

	chatSendButton.addEventListener('click', sendMessage);
	chatInput.addEventListener('keydown', (event) => {
		if (event.key === 'Enter') sendMessage();
	});

	const openChat = () => {
		chatWindow.style.display = 'flex';
		if (chatMessages.children.length === 0) {
			addMessageToChat(
				'Jsem kariérový poradce. Napiš mi co máš vystudováno, co umíš, kde chceš pracovat a jakou mzdu očekáváš. Já z toho vyberu vhodné nabídky.',
				'bot'
			);
		}
	};

	window.JobBot = {
		open: openChat,
		send(text) {
			const msg = String(text || '').trim();
			if (!msg) return;
			openChat();
			chatInput.value = msg;
			sendMessage();
		}
	};
});
