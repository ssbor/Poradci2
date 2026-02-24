document.addEventListener('DOMContentLoaded', () => {
	const advisorRoot = document.querySelector('[data-role="advisor-root"]');
	const isEmbedded = !!advisorRoot;

	const chatTrigger = document.getElementById('chat-trigger');
	const chatWindow = document.getElementById('chat-window');
	const chatMessages = isEmbedded
		? advisorRoot.querySelector('[data-role="advisor-messages"]')
		: document.getElementById('chat-messages');
	const chatInput = isEmbedded
		? advisorRoot.querySelector('[data-role="advisor-input"]')
		: document.getElementById('chat-input-field');
	const chatSendButton = isEmbedded
		? advisorRoot.querySelector('[data-role="advisor-send"]')
		: document.getElementById('chat-send-btn');
	const statusEl = isEmbedded ? advisorRoot.querySelector('[data-role="advisor-status"]') : null;
	const embeddedHeaderP = isEmbedded ? advisorRoot.querySelector('.chat-header p') : null;
	const embeddedModeBadge = isEmbedded ? advisorRoot.querySelector('[data-role="advisor-mode-badge"]') : null;

	// If neither embedded nor floating markup exists, do nothing.
	if (!chatMessages || !chatInput || !chatSendButton) return;
	if (!isEmbedded && (!chatTrigger || !chatWindow)) return;

	const state = {
		messages: [],
		busy: false,
		lastSearch: null,
		mode: 'all'
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
		if (isEmbedded) {
			advisorRoot.classList.toggle('is-busy', state.busy);
			advisorRoot.setAttribute('aria-busy', state.busy ? 'true' : 'false');
		}
	};

	const setStatus = (txt) => {
		if (!statusEl) return;
		statusEl.textContent = String(txt || '');
	};

	const applyEmbeddedCopy = () => {
		if (!isEmbedded) return;
		const mode = state.mode;

		if (embeddedModeBadge) {
			const label =
				mode === 'jobs'
					? 'Práce'
					: mode === 'edu'
						? 'Vzdělání'
						: mode === 'courses'
							? 'Kurzy'
							: 'Vše';
			embeddedModeBadge.textContent = label;
			embeddedModeBadge.classList.toggle('is-jobs', mode === 'jobs');
			embeddedModeBadge.classList.toggle('is-edu', mode === 'edu');
			embeddedModeBadge.classList.toggle('is-courses', mode === 'courses');
		}

		const placeholder =
			mode === 'jobs'
				? 'Např. "Svářeč, Plzeň, dojezd 20 km, min. 35 000"'
				: mode === 'edu'
					? 'Např. "Chci nástavbu na maturitu, jsem z Plzeňska"'
					: mode === 'courses'
						? 'Např. "Chci rekvalifikaci, mám čas večer / o víkendu"'
						: 'Např. "Hledám práci nebo školu – poradíš?"';
		chatInput.setAttribute('placeholder', placeholder);
		if (embeddedHeaderP) {
			embeddedHeaderP.textContent =
				mode === 'jobs'
					? 'Popiš praxi a co hledáš. Zeptám se na pár věcí a vyberu nabídky.'
					: mode === 'edu'
						? 'Popiš školu/obor a co chceš studovat dál. Doporučím školy a obory.'
						: mode === 'courses'
							? 'Popiš cíl a časové možnosti. Doporučím vhodné kurzy / další krok.'
							: 'Popiš, co řešíš. Pomůžu vybrat nejlepší další krok.';
		}
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
				mode: state.mode,
				context: { page },
				messages: state.messages
			})
		});

		const data = await resp.json().catch(() => null);
		if (!resp.ok) {
			const base = String(data?.error || 'AI služba není dostupná.');
			const status = data?.status != null ? ` (HTTP ${String(data.status)})` : '';
			const detailsRaw = String(data?.details || '').trim();
			const details = detailsRaw ? `: ${detailsRaw.replace(/\s+/g, ' ').slice(0, 260)}` : '';
			const hintRaw = String(data?.hint || '').trim();
			const hint = hintRaw ? `\n${hintRaw}` : '';
			throw new Error(`${base}${status}${details}${hint}`);
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
		setStatus('Přemýšlím');
		try {
			const data = await callAI();
			const reply = String((data && data.reply) || '').trim();
			const followUp = data && data.follow_up ? String(data.follow_up).trim() : '';
			state.lastSearch = data?.search || null;
			const recos = Array.isArray(data?.recommendations) ? data.recommendations : [];
			const eduRecos = Array.isArray(data?.edu_recommendations) ? data.edu_recommendations : [];

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

			if (eduRecos.length) {
				html += '<br><br><b>Doporučené školy / obory:</b><br>';
				html += '<div style="display:grid; gap:.45rem; margin-top:.35rem">';
				for (const r of eduRecos.slice(0, 5)) {
					const school = escapeHtml(String(r?.school_name || ''));
					const place = escapeHtml(String([r?.obec, r?.kraj].filter(Boolean).join(' · ')));
					const program = escapeHtml(String(r?.program_name || ''));
					const code = escapeHtml(String(r?.program_code || ''));
					const forma = escapeHtml(String(r?.forma || ''));
					const stupen = escapeHtml(String(r?.stupen || ''));
					const urlRaw = String(r?.url || '').trim();
					const url = urlRaw && !/^https?:\/\//i.test(urlRaw) ? `https://${urlRaw}` : urlRaw;

					html += '<div style="border:1px solid rgba(255,255,255,.12); padding:.45rem .55rem; border-radius:.6rem">';
					html += `<div style="font-weight:700">${school || 'Škola'}</div>`;
					if (place) html += `<div style="opacity:.9">${place}</div>`;
					if (program) html += `<div style="margin-top:.2rem">${program}${code ? ` <span style=\"opacity:.85\">(${code})</span>` : ''}</div>`;
					const meta = [stupen, forma].filter(Boolean).join(' · ');
					if (meta) html += `<div style="opacity:.85">${meta}</div>`;
					if (url) html += `<div style="margin-top:.2rem"><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Web školy</a></div>`;
					html += '</div>';
				}
				html += '</div>';
			}

			const actions = Array.isArray(data?.actions) ? data.actions : [];
			if (actions.length) {
				html += '<br><br><div style="display:flex; gap:.5rem; flex-wrap:wrap">';
				for (const a of actions.slice(0, 4)) {
					const label = escapeHtml(String(a?.label || 'Otevřít'));
					const url = String(a?.url || '').trim();
					if (!url) continue;
					html += `<a class="btn btn--ghost" href="${escapeHtml(url)}">${label}</a>`;
				}
				html += '</div>';
			}

			if (
				(state.mode === 'jobs' || state.mode === 'all') &&
				state.lastSearch &&
				(state.lastSearch.q || state.lastSearch.kraj || state.lastSearch.place)
			) {
				const url = buildJobsUrl(state.lastSearch);
				html += `<br><br><a href="${url}">Otevřít vyfiltrované nabídky</a>`;
			}
			if (followUp) html += '<br><br>' + escapeHtmlWithBreaks(followUp);

			addMessageToChat(html, 'bot', { html: true });
			state.messages.push({ role: 'assistant', content: reply || '' });
		} catch (e) {
			addMessageToChat(String(e?.message || 'Něco se nepovedlo.'), 'bot');
		} finally {
			setStatus('');
			setBusy(false);
		}
	};

	if (!isEmbedded) {
		chatTrigger.addEventListener('click', () => {
			const open = chatWindow.style.display === 'flex';
			chatWindow.style.display = open ? 'none' : 'flex';
			if (!open && chatMessages.children.length === 0) {
				addMessageToChat(
					'Jsem kariérový poradce. Napiš mi co máš vystudováno, co umíš, kde chceš pracovat a jakou mzdu očekáváš. Já z toho vyberu vhodné nabídky.',
					'bot'
				);
			}
		});
	} else {
		if (chatMessages.children.length === 0) {
			addMessageToChat(
				'Jsem chytrý poradce. Napiš mi, co řešíš (práce / škola / kurzy) a pár vět o sobě. Začnu otázkami.',
				'bot'
			);
		}
	}

	chatSendButton.addEventListener('click', sendMessage);
	chatInput.addEventListener('keydown', (event) => {
		if (event.key === 'Enter') sendMessage();
	});

	const openChat = () => {
		if (!isEmbedded) {
			chatWindow.style.display = 'flex';
			if (chatMessages.children.length === 0) {
				addMessageToChat(
					'Jsem kariérový poradce. Napiš mi co máš vystudováno, co umíš, kde chceš pracovat a jakou mzdu očekáváš. Já z toho vyberu vhodné nabídky.',
					'bot'
				);
			}
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

	if (isEmbedded) {
		applyEmbeddedCopy();
		advisorRoot.addEventListener('click', (e) => {
			const t = e.target;
			if (!(t instanceof Element)) return;
			const btn = t.closest('[data-role="advisor-mode"]');
			if (!btn) return;
			e.preventDefault();
			const next = String(btn.getAttribute('data-mode') || 'all').trim();
			state.mode = next || 'all';
			applyEmbeddedCopy();
			advisorRoot
				.querySelectorAll('[data-role="advisor-mode"]')
				.forEach((b) => b.classList.toggle('is-active', b === btn));
		});
	}
});
