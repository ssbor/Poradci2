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
	const embeddedResetBtn = isEmbedded ? advisorRoot.querySelector('[data-role="advisor-reset"]') : null;
	const embeddedStarters = null;
	const embeddedHistory = isEmbedded ? advisorRoot.querySelector('[data-role="advisor-history"]') : null;
	const embeddedResults = isEmbedded ? advisorRoot.querySelector('[data-role="advisor-results"]') : null;
	const embeddedTabs = isEmbedded ? Array.from(advisorRoot.querySelectorAll('[data-role="advisor-tab"]')) : [];

	// If neither embedded nor floating markup exists, do nothing.
	if (!chatMessages || !chatInput || !chatSendButton) return;
	if (!isEmbedded && (!chatTrigger || !chatWindow)) return;

	const state = {
		busy: false,
		// Floating chatbot uses single-thread state.
		messages: [],
		lastSearch: null,
		mode: 'auto',
		// Embedded advisor uses sessions.
		sessions: [],
		activeSessionId: null,
		sidebarTab: 'results'
	};

	const MODE_STORAGE_KEY = 'advisor_mode_v1';
	const SESSIONS_STORAGE_KEY = 'advisor_sessions_v1';
	const MAX_SESSIONS = 25;
	const MAX_SESSION_MESSAGES = 40;

	const normalizeMode = (raw) => {
		const m = String(raw || '').trim();
		return ['auto', 'all', 'jobs', 'edu', 'courses'].includes(m) ? m : 'auto';
	};

	const modeLabel = (mode) =>
		mode === 'auto' ? 'Auto' : mode === 'jobs' ? 'Práce' : mode === 'edu' ? 'Vzdělání' : mode === 'courses' ? 'Kurzy' : 'Vše';

	const nowTs = () => Date.now();

	const makeId = () => {
		const a = Math.random().toString(36).slice(2, 10);
		return `s_${Date.now().toString(36)}_${a}`;
	};

	const shortTime = (ts) => {
		try {
			return new Date(ts).toLocaleString('cs-CZ', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
		} catch {
			return '';
		}
	};

	const getActiveSession = () => {
		if (!isEmbedded) return null;
		const id = state.activeSessionId;
		return state.sessions.find((s) => s && s.id === id) || null;
	};

	const getMode = () => {
		if (!isEmbedded) return state.mode;
		return normalizeMode(getActiveSession()?.mode || 'auto');
	};

	const getMessagesForRequest = () => {
		const arr = isEmbedded ? getActiveSession()?.messages || [] : state.messages;
		// Send only role/content to backend (avoid local render fields).
		return arr.map((m) => ({ role: m.role, content: m.content }));
	};

	const clampSessionMessages = (messages) => {
		const arr = Array.isArray(messages) ? messages : [];
		return arr.slice(-MAX_SESSION_MESSAGES);
	};

	const saveSessions = () => {
		if (!isEmbedded) return;
		try {
			const payload = {
				activeSessionId: state.activeSessionId,
				sessions: state.sessions.slice(-MAX_SESSIONS)
			};
			localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(payload));
		} catch {
			// ignore storage errors
		}
	};

	const loadSessions = () => {
		if (!isEmbedded) return;
		try {
			const raw = localStorage.getItem(SESSIONS_STORAGE_KEY);
			if (!raw) return;
			const parsed = JSON.parse(raw);
			const sessions = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
			state.sessions = sessions
				.map((s) => ({
					id: String(s?.id || ''),
					mode: normalizeMode(s?.mode || 'all'),
					title: String(s?.title || ''),
					createdAt: Number(s?.createdAt || 0) || 0,
					updatedAt: Number(s?.updatedAt || 0) || 0,
					results: s?.results && typeof s.results === 'object' ? s.results : null,
					messages: clampSessionMessages(Array.isArray(s?.messages) ? s.messages : []).map((m) => ({
						role: String(m?.role || ''),
						content: String(m?.content || ''),
						render_html: m?.render_html ? String(m.render_html) : ''
					}))
				}))
				.filter((s) => s.id);
			state.activeSessionId = String(parsed?.activeSessionId || '') || (state.sessions[0]?.id || null);
		} catch {
			// ignore
		}
	};

	const setSidebarTab = (tab) => {
		if (!isEmbedded) return;
		const t = tab === 'history' ? 'history' : 'results';
		state.sidebarTab = t;
		if (embeddedTabs && embeddedTabs.length) {
			embeddedTabs.forEach((b) => {
				const on = String(b.getAttribute('data-tab') || '') === t;
				b.classList.toggle('is-active', on);
				b.setAttribute('aria-selected', on ? 'true' : 'false');
			});
		}
		if (embeddedHistory) embeddedHistory.hidden = t !== 'history';
		if (embeddedResults) embeddedResults.hidden = t !== 'results';
	};

	const setTabLabel = (tab, text) => {
		if (!isEmbedded || !embeddedTabs || !embeddedTabs.length) return;
		const btn = embeddedTabs.find((b) => String(b.getAttribute('data-tab') || '') === tab);
		if (btn) btn.textContent = text;
	};

	const packResults = (data) => {
		const recos = Array.isArray(data?.recommendations) ? data.recommendations.slice(0, 5) : [];
		const eduRecos = Array.isArray(data?.edu_recommendations) ? data.edu_recommendations.slice(0, 5) : [];
		return {
			intent: String(data?.intent || '').trim() || 'general',
			search: data?.search && typeof data.search === 'object' ? data.search : null,
			jobs_match_count: data?.jobs_match_count != null ? Number(data.jobs_match_count) : null,
			jobs_url: String(data?.jobs_url || '').trim(),
			edu_match_count: data?.edu_match_count != null ? Number(data.edu_match_count) : null,
			edu_url: String(data?.edu_url || '').trim(),
			recommendations: recos,
			edu_recommendations: eduRecos
		};
	};

	const renderResults = () => {
		if (!isEmbedded || !embeddedResults) return;
		const s = getActiveSession();
		const r = s?.results && typeof s.results === 'object' ? s.results : null;
		if (!r) {
			setTabLabel('results', 'Výsledky');
			embeddedResults.innerHTML = '<div class="muted">Výsledky se ukážou tady, až mi napíšeš co hledáš (práce / škola).<br><br>Tip: „Hledám práci automechanik Plzeň“ nebo „Chci nástavbu v Plzeňském kraji“.</div>';
			return;
		}

		const intent = String(r?.intent || 'general');
		const jobsUrl = String(r?.jobs_url || '').trim();
		const jobsN = r?.jobs_match_count != null ? Number(r.jobs_match_count) : null;
		const eduUrl = String(r?.edu_url || '').trim();
		const eduN = r?.edu_match_count != null ? Number(r.edu_match_count) : null;
		const recos = Array.isArray(r?.recommendations) ? r.recommendations : [];
		const eduRecos = Array.isArray(r?.edu_recommendations) ? r.edu_recommendations : [];
		const shownCount = (intent === 'jobs' ? recos.length : intent === 'edu' ? eduRecos.length : 0);
		setTabLabel('results', shownCount ? `Výsledky (${shownCount})` : 'Výsledky');

		let head = '';
		if (intent === 'jobs') {
			const label = Number.isFinite(jobsN) && jobsN > 0 ? `Nalezeno: ${jobsN} nabídek` : 'Nabídky práce';
			head = `<div class="advisor-result-card"><div class="advisor-result-title">${escapeHtml(label)}</div>` +
				(jobsUrl ? `<div class="advisor-result-actions"><a class="advisor-link" href="${escapeHtml(jobsUrl)}">Otevřít všechny</a></div>` : '') +
				`</div>`;
		} else if (intent === 'edu') {
			const label = Number.isFinite(eduN) && eduN > 0 ? `Nalezeno: ${eduN} škol/oborů` : 'Školy / obory';
			head = `<div class="advisor-result-card"><div class="advisor-result-title">${escapeHtml(label)}</div>` +
				(eduUrl ? `<div class="advisor-result-actions"><a class="advisor-link" href="${escapeHtml(eduUrl)}">Otevřít všechny</a></div>` : '') +
				`</div>`;
		} else {
			head = '<div class="muted">Pro obecné dotazy tady nic nelistuji. Napiš, že chceš práci nebo školu, a doplním výsledky.</div>';
		}

		let body = '';
		if (intent === 'jobs' && recos.length) {
			body += recos
				.map((o) => {
					const title = escapeHtml(String(o?.profese || ''));
					const firm = escapeHtml(String(o?.zamestnavatel || ''));
					const where = escapeHtml(String(o?.lokalita || o?.obec || ''));
					const wage = escapeHtml(String(o?.mzda_text || ''));
					const url = offerDetailUrl(o);
					return (
						`<div class="advisor-result-card">` +
						`<div class="advisor-result-title">${title || 'Pozice'}</div>` +
						(firm ? `<div class="advisor-result-meta">${firm}</div>` : '') +
						(where ? `<div class="advisor-result-meta">${where}</div>` : '') +
						(wage ? `<div class="advisor-result-meta">${wage}</div>` : '') +
						(url ? `<div class="advisor-result-actions"><a class="advisor-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Detail</a></div>` : '') +
						`</div>`
					);
				})
				.join('');
		}

		if (intent === 'edu' && eduRecos.length) {
			body += eduRecos
				.map((o) => {
					const school = escapeHtml(String(o?.school_name || ''));
					const place = escapeHtml(String([o?.obec, o?.kraj].filter(Boolean).join(' · ')));
					const program = escapeHtml(String(o?.program_name || ''));
					const code = escapeHtml(String(o?.program_code || ''));
					const meta = escapeHtml(String([o?.stupen, o?.forma].filter(Boolean).join(' · ')));
					const urlRaw = String(o?.url || '').trim();
					const url = urlRaw && !/^https?:\/\//i.test(urlRaw) ? `https://${urlRaw}` : urlRaw;
					return (
						`<div class="advisor-result-card">` +
						`<div class="advisor-result-title">${school || 'Škola'}</div>` +
						(place ? `<div class="advisor-result-meta">${place}</div>` : '') +
						(program ? `<div class="advisor-result-meta">${program}${code ? ` <span style=\"opacity:.85\">(${code})</span>` : ''}</div>` : '') +
						(meta ? `<div class="advisor-result-meta">${meta}</div>` : '') +
						(url ? `<div class="advisor-result-actions"><a class="advisor-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Web</a></div>` : '') +
						`</div>`
					);
				})
				.join('');
		}

		embeddedResults.innerHTML = head + (body ? `<div style="margin-top:.55rem">${body}</div>` : '');
	};

	const guessTitleFromMessages = (session) => {
		const msgs = Array.isArray(session?.messages) ? session.messages : [];
		const firstUser = msgs.find((m) => m && m.role === 'user' && String(m.content || '').trim());
		const txt = String(firstUser?.content || '').trim();
		if (!txt) return '';
		return txt.length > 42 ? txt.slice(0, 42).trim() + '…' : txt;
	};

	const createSession = (mode, { seedWelcome = true } = {}) => {
		if (!isEmbedded) return null;
		const ts = nowTs();
		const session = {
			id: makeId(),
			mode: normalizeMode(mode),
			title: '',
			createdAt: ts,
			updatedAt: ts,
			messages: []
		};
		if (seedWelcome) {
			session.messages.push({ role: 'assistant', content: welcomeMessageForMode(session.mode), render_html: '' });
		}
		state.sessions = [session, ...state.sessions].slice(0, MAX_SESSIONS);
		state.activeSessionId = session.id;
		try {
			localStorage.setItem(MODE_STORAGE_KEY, session.mode);
		} catch {
			// ignore
		}
		saveSessions();
		return session;
	};

	const deleteSession = (id) => {
		if (!isEmbedded) return;
		const before = state.sessions.length;
		state.sessions = state.sessions.filter((s) => s && s.id !== id);
		if (state.sessions.length === before) return;
		if (state.activeSessionId === id) state.activeSessionId = state.sessions[0]?.id || null;
		if (!state.activeSessionId) createSession('auto');
		saveSessions();
	};

	const renderHistory = () => {
		if (!isEmbedded || !embeddedHistory) return;
		const active = state.activeSessionId;
		const rows = state.sessions.slice(0, MAX_SESSIONS).map((s) => {
			const title = String(s?.title || '').trim() || guessTitleFromMessages(s) || `${modeLabel(s?.mode)} · ${shortTime(s?.createdAt || 0)}`;
			const meta = `${shortTime(s?.updatedAt || s?.createdAt || 0)}`;
			const chip = modeLabel(s?.mode);
			const isActive = s?.id === active;
			return `
				<button type="button" class="advisor-history-item ${isActive ? 'is-active' : ''}" data-role="advisor-history-item" data-id="${escapeHtml(
					String(s?.id || '')
				)}">
					<div class="advisor-history-title">${escapeHtml(title)}</div>
					<div class="advisor-history-meta">
						<span class="advisor-history-chip">${escapeHtml(chip)}</span>
						<span style="opacity:.85">${escapeHtml(meta)}</span>
						<button type="button" class="advisor-history-delete" data-role="advisor-history-delete" data-id="${escapeHtml(
							String(s?.id || '')
						)}" aria-label="Smazat chat">×</button>
					</div>
				</button>`;
		});
		embeddedHistory.innerHTML = rows.join('') || '<div class="muted">Zatím tu nic není.</div>';
	};

	const renderActiveChat = () => {
		if (!isEmbedded) return;
		const s = getActiveSession();
		if (!s) return;
		if (chatMessages) chatMessages.innerHTML = '';
		for (const m of Array.isArray(s.messages) ? s.messages : []) {
			if (!m) continue;
			const sender = m.role === 'user' ? 'user' : 'bot';
			const html = sender === 'bot' && m.render_html ? m.render_html : '';
			addMessageToChat(html || m.content, sender, { html: !!html });
		}
	};

	const setActiveSession = (id) => {
		if (!isEmbedded) return;
		const s = state.sessions.find((x) => x && x.id === id);
		if (!s) return;
		state.activeSessionId = s.id;
		try {
			localStorage.setItem(MODE_STORAGE_KEY, s.mode);
		} catch {
			// ignore
		}
		applyEmbeddedCopy();
		setActiveModeButton(s.mode);
		renderHistory();
		renderActiveChat();
		renderResults();
		saveSessions();
	};

	const welcomeMessageForMode = (mode) => {
		return mode === 'jobs'
			? 'Jsem poradce pro práci. Napiš mi, co řešíš.'
			: mode === 'edu'
				? 'Jsem poradce pro vzdělání. Napiš mi, co řešíš.'
				: mode === 'courses'
					? 'Jsem poradce pro kurzy. Napiš mi, co řešíš.'
					: mode === 'auto'
						? 'Jsem chytrý poradce. Rozpoznám, jestli řešíš práci, vzdělání nebo kurzy. Napiš mi, co potřebuješ.'
						: 'Jsem chytrý poradce. Napiš mi, co řešíš.';
	};

	const setActiveModeButton = (mode) => {
		if (!isEmbedded) return;
		advisorRoot.querySelectorAll('[data-role="advisor-mode"]').forEach((b) => {
			const isOn = String(b.getAttribute('data-mode') || '') === mode;
			b.classList.toggle('is-active', isOn);
			b.setAttribute('aria-selected', isOn ? 'true' : 'false');
		});
	};

	const renderStarters = () => {};

	const resetChat = () => {
		if (!isEmbedded) {
			state.messages = [];
			state.lastSearch = null;
			if (chatMessages) chatMessages.innerHTML = '';
			addMessageToChat(welcomeMessageForMode(state.mode), 'bot');
			return;
		}
		// Embedded: start a NEW session (keep history).
		const mode = getMode();
		createSession(mode);
		setActiveSession(state.activeSessionId);
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
		const mode = getMode();

		if (embeddedModeBadge) {
			const label =
				mode === 'auto'
					? 'Auto'
					: mode === 'jobs'
						? 'Práce'
						: mode === 'edu'
							? 'Vzdělání'
							: mode === 'courses'
								? 'Kurzy'
								: 'Vše';
			embeddedModeBadge.textContent = label;
			embeddedModeBadge.classList.toggle('is-auto', mode === 'auto');
			embeddedModeBadge.classList.toggle('is-jobs', mode === 'jobs');
			embeddedModeBadge.classList.toggle('is-edu', mode === 'edu');
			embeddedModeBadge.classList.toggle('is-courses', mode === 'courses');
		}

		const placeholder = 'Napiš zprávu…';
		chatInput.setAttribute('placeholder', placeholder);
		if (embeddedHeaderP) {
			embeddedHeaderP.textContent = 'Napiš mi, co řešíš.';
		}
	};

	const buildJobsUrl = (search) => {
		const params = new URLSearchParams();
		const q = String(search?.q || '').trim();
		const kraj = String(search?.kraj || '').trim();
		const place = String(search?.place || '').trim();
		const minMzda = Number(search?.minMzda || 0) || 0;
		const dojezdKmRaw = Number(search?.dojezdKm || 0) || 0;
		const dojezdKm = dojezdKmRaw || (place ? 5 : 0);

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
				mode: getMode(),
				context: { page },
				messages: getMessagesForRequest()
			})
		});

		const data = await resp.json().catch(() => null);
		if (!resp.ok) {
			const base = String(data?.error || 'AI služba není dostupná.');
			const status = data?.status != null ? ` (HTTP ${String(data.status)})` : '';
			const provider = String(data?.provider || '').trim();
			const model = String(data?.model || '').trim();
			const who = provider || model ? `\nProvider: ${provider || '?'}${model ? `, model: ${model}` : ''}` : '';
			const detailsRaw = String(data?.details || '').trim();
			const details = detailsRaw ? `: ${detailsRaw.replace(/\s+/g, ' ').slice(0, 260)}` : '';
			let modelsHint = '';
			const available = Array.isArray(data?.available_models) ? data.available_models : [];
			if (available.length) {
				const names = available
					.filter((m) => Array.isArray(m?.methods) && m.methods.includes('generateContent'))
					.map((m) => String(m?.name || '').replace(/^models\//, '').trim())
					.filter(Boolean)
					.slice(0, 12);
				if (names.length) {
					modelsHint = `\nDostupné Gemini modely: ${names.join(', ')}`;
				}
			}
			const hintRaw = String(data?.hint || '').trim();
			const hint = hintRaw ? `\n${hintRaw}` : '';
			throw new Error(`${base}${status}${details}${who}${modelsHint}${hint}`);
		}
		return data;
	};

	const sendMessage = async () => {
		const messageText = String(chatInput.value || '').trim();
		if (!messageText) return;
		if (state.busy) return;
		if (isEmbedded && !getActiveSession()) {
			createSession('auto');
		}

		addMessageToChat(messageText, 'user');
		chatInput.value = '';
		if (isEmbedded) {
			const s = getActiveSession();
			if (s) {
				s.messages = clampSessionMessages([...(s.messages || []), { role: 'user', content: messageText, render_html: '' }]);
				s.updatedAt = nowTs();
				if (!String(s.title || '').trim()) {
					s.title = guessTitleFromMessages(s);
				}
				saveSessions();
				renderHistory();
			}
		} else {
			state.messages.push({ role: 'user', content: messageText });
		}

		setBusy(true);
		setStatus('Přemýšlím');
		try {
			const data = await callAI();
			const reply = String((data && data.reply) || '').trim();
			const followUp = data && data.follow_up ? String(data.follow_up).trim() : '';
			state.lastSearch = data?.search || null;
			let html = escapeHtmlWithBreaks(reply || 'Rozumím.');

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
			if (followUp) html += '<br><br>' + escapeHtmlWithBreaks(followUp);

			// Embedded: store & render results into sidebar (instead of inside chat bubble).
			if (isEmbedded) {
				const s = getActiveSession();
				if (s) {
					s.results = packResults(data);
					s.updatedAt = nowTs();
					renderResults();
					// Auto-switch to results tab when we have job/edu results.
					const it = String(s.results?.intent || '');
					const hasJobs = (it === 'jobs') && ((Number(s.results?.jobs_match_count || 0) > 0) || (Array.isArray(s.results?.recommendations) && s.results.recommendations.length));
					const hasEdu = (it === 'edu') && ((Number(s.results?.edu_match_count || 0) > 0) || (Array.isArray(s.results?.edu_recommendations) && s.results.edu_recommendations.length));
					if (hasJobs || hasEdu) setSidebarTab('results');
				}
			}

			addMessageToChat(html, 'bot', { html: true });
			if (isEmbedded) {
				const s = getActiveSession();
				if (s) {
					s.messages = clampSessionMessages([
						...(s.messages || []),
						{ role: 'assistant', content: reply || '', render_html: html }
					]);
					s.updatedAt = nowTs();
					if (!String(s.title || '').trim()) {
						s.title = guessTitleFromMessages(s);
					}
					saveSessions();
					renderHistory();
				}
			} else {
				state.messages.push({ role: 'assistant', content: reply || '' });
			}
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
		// Embedded advisor: load sessions + restore last used mode.
		loadSessions();
		if (!state.sessions.length) {
			let startMode = 'auto';
			try {
				const saved = localStorage.getItem(MODE_STORAGE_KEY);
				startMode = normalizeMode(saved || startMode);
			} catch {
				// ignore
			}
			createSession(startMode);
		}
		if (!state.activeSessionId) state.activeSessionId = state.sessions[0]?.id || null;
		setActiveSession(state.activeSessionId);
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
		setActiveModeButton(getMode());
		renderHistory();
		renderActiveChat();
		renderResults();
		setSidebarTab(state.sidebarTab);

		if (embeddedResetBtn) {
			embeddedResetBtn.addEventListener('click', (e) => {
				e.preventDefault();
				resetChat();
			});
		}

		advisorRoot.addEventListener('click', (e) => {
			const t = e.target;
			if (!(t instanceof Element)) return;

			const tabBtn = t.closest('[data-role="advisor-tab"]');
			if (tabBtn) {
				e.preventDefault();
				setSidebarTab(String(tabBtn.getAttribute('data-tab') || 'results'));
				return;
			}

			const del = t.closest('[data-role="advisor-history-delete"]');
			if (del) {
				e.preventDefault();
				const id = String(del.getAttribute('data-id') || '').trim();
				if (id) {
					deleteSession(id);
					renderHistory();
					renderActiveChat();
					renderResults();
					applyEmbeddedCopy();
					setActiveModeButton(getMode());
				}
				return;
			}

			const item = t.closest('[data-role="advisor-history-item"]');
			if (item && embeddedHistory && embeddedHistory.contains(item)) {
				e.preventDefault();
				const id = String(item.getAttribute('data-id') || '').trim();
				if (id) setActiveSession(id);
				return;
			}

			const btn = t.closest('[data-role="advisor-mode"]');
			if (!btn) return;
			e.preventDefault();
			const next = normalizeMode(btn.getAttribute('data-mode') || 'all');
			// Clicking a focus creates a NEW chat "tab" (keeps history like Gemini).
			createSession(next);
			setActiveSession(state.activeSessionId);
		});

		advisorRoot.addEventListener('keydown', (e) => {
			const t = e.target;
			if (!(t instanceof Element)) return;
			const isModeBtn = t.matches('[data-role="advisor-mode"]');
			if (!isModeBtn) return;
			if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
			e.preventDefault();
			const btns = Array.from(advisorRoot.querySelectorAll('[data-role="advisor-mode"]'));
			const idx = btns.indexOf(t);
			if (idx < 0) return;
			const delta = e.key === 'ArrowRight' ? 1 : -1;
			const nextBtn = btns[(idx + delta + btns.length) % btns.length];
			if (nextBtn) nextBtn.click();
			if (nextBtn) nextBtn.focus();
		});
	}
});
