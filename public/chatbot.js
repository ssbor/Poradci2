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
	const embeddedStarters = isEmbedded ? advisorRoot.querySelector('[data-role="advisor-starters"]') : null;
	const embeddedHistory = isEmbedded ? advisorRoot.querySelector('[data-role="advisor-history"]') : null;

	// If neither embedded nor floating markup exists, do nothing.
	if (!chatMessages || !chatInput || !chatSendButton) return;
	if (!isEmbedded && (!chatTrigger || !chatWindow)) return;

	const state = {
		busy: false,
		// Floating chatbot uses single-thread state.
		messages: [],
		lastSearch: null,
		mode: 'all',
		// Embedded advisor uses sessions.
		sessions: [],
		activeSessionId: null
	};

	const MODE_STORAGE_KEY = 'advisor_mode_v1';
	const SESSIONS_STORAGE_KEY = 'advisor_sessions_v1';
	const MAX_SESSIONS = 25;
	const MAX_SESSION_MESSAGES = 40;

	const normalizeMode = (raw) => {
		const m = String(raw || '').trim();
		return ['all', 'jobs', 'edu', 'courses'].includes(m) ? m : 'all';
	};

	const modeLabel = (mode) =>
		mode === 'jobs' ? 'Práce' : mode === 'edu' ? 'Vzdělání' : mode === 'courses' ? 'Kurzy' : 'Vše';

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
		return normalizeMode(getActiveSession()?.mode || 'all');
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
		if (!state.activeSessionId) createSession('all');
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
		renderStarters();
		renderHistory();
		renderActiveChat();
		saveSessions();
	};

	const welcomeMessageForMode = (mode) => {
		if (mode === 'jobs') {
			return 'Jasně — pomůžu ti vybrat práci. Napiš: co umíš / praxe, kde chceš pracovat (město/kraj), dojezd a ideálně mzdu.';
		}
		if (mode === 'edu') {
			return 'Jasně — poradím se školou/oborem. Napiš: co máš hotové (výuční list/maturita), co chceš studovat a odkud jsi (město/kraj).';
		}
		if (mode === 'courses') {
			return 'Jasně — poradím s kurzem/rekvalifikací. Napiš: cíl, časové možnosti (kdy můžeš), rozpočet a jestli chceš online nebo prezenčně.';
		}
		return 'Jsem chytrý poradce. Napiš mi, co řešíš (práce / škola / kurzy) a pár vět o sobě. Začnu otázkami.';
	};

	const setActiveModeButton = (mode) => {
		if (!isEmbedded) return;
		advisorRoot.querySelectorAll('[data-role="advisor-mode"]').forEach((b) => {
			const isOn = String(b.getAttribute('data-mode') || '') === mode;
			b.classList.toggle('is-active', isOn);
			b.setAttribute('aria-selected', isOn ? 'true' : 'false');
		});
	};

	const renderStarters = () => {
		if (!isEmbedded || !embeddedStarters) return;
		const mode = getMode();
		const starters =
			mode === 'jobs'
				? [
					{ label: 'Hledám práci jako…', text: 'Hledám práci jako … Jsem z … Dojezd … km. Min. mzda … Kč. Umím…' },
					{ label: 'Brigáda / praxe', text: 'Chci brigádu/praxi. Umím… Můžu kdy… Lokalita…' },
					{ label: 'Bez praxe', text: 'Nemám praxi, ale chci začít v oboru… Co doporučíš za pozice?' }
				]
				: mode === 'edu'
					? [
						{ label: 'Nástavba', text: 'Chci nástavbu na maturitu. Mám hotové… Jsem z… Zajímá mě obor…' },
						{ label: 'Změna oboru', text: 'Chci změnit obor. Baví mě… Nebaví mě… Jsem z…' },
						{ label: 'Kód oboru', text: 'Hledám obor podle kódu (např. 41-45-M/01). Chci zjistit kde se dá studovat.' }
					]
					: mode === 'courses'
						? [
							{ label: 'Rekvalifikace', text: 'Chci rekvalifikaci na… Můžu večer/víkendy. Rozpočet… Online/prezenčně…' },
							{ label: 'Dovednost', text: 'Chci se naučit… kvůli práci. Mám úroveň… Čas týdně…' },
							{ label: 'Řidičák / svářečák', text: 'Chci získat oprávnění/kvalifikaci (např. řidičák/svářečák). Co je nejlepší postup?' }
						]
						: [
							{ label: 'Najít práci', text: 'Hledám práci jako… Jsem z… Dojezd… km. Min. mzda… Kč.' },
							{ label: 'Vybrat školu', text: 'Chci pokračovat ve studiu. Mám hotové… Jsem z… Zajímá mě obor…' },
							{ label: 'Najít kurz', text: 'Chci rekvalifikaci / kurz na… Můžu kdy… Online nebo prezenčně…' }
						];

		embeddedStarters.innerHTML = starters
			.map(
				(s) =>
					`<button type="button" class="advisor-starter" data-role="advisor-starter" data-text="${escapeHtml(String(s.text || ''))}">${escapeHtml(
						String(s.label || '')
					)}</button>`
			)
			.join('');
	};

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

		renderStarters();
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
			createSession('all');
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
			const recos = Array.isArray(data?.recommendations) ? data.recommendations : [];
			const eduRecos = Array.isArray(data?.edu_recommendations) ? data.edu_recommendations : [];
			const jobsMatchCount = data?.jobs_match_count != null ? Number(data.jobs_match_count) : null;
			const jobsUrl = String(data?.jobs_url || '').trim();

			let html = escapeHtmlWithBreaks(reply || 'Rozumím.');

			if (recos.length) {
				html += '<br><br><b>Doporučené nabídky:</b><br>';
				if (Number.isFinite(jobsMatchCount) && jobsMatchCount > recos.length) {
					html += `<div style="opacity:.85; margin-top:.25rem">Vybral jsem top ${Math.min(5, recos.length)} z ${jobsMatchCount} nabídek.</div>`;
				}
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

			// If we have a broad jobs match count but no top picks (e.g., strict scoring), still show a helpful summary.
			if (!recos.length && Number.isFinite(jobsMatchCount) && jobsMatchCount > 0) {
				html += `<br><br><div style="opacity:.9"><b>Našel jsem</b> ${jobsMatchCount} nabídek podle toho, co píšeš.</div>`;
				if (jobsUrl) {
					html += `<div style="margin-top:.25rem"><a href="${escapeHtml(jobsUrl)}">Zobrazit nabídky</a></div>`;
				}
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
			if (followUp) html += '<br><br>' + escapeHtmlWithBreaks(followUp);

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
			let startMode = 'all';
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
		renderStarters();
		renderHistory();
		renderActiveChat();

		if (embeddedResetBtn) {
			embeddedResetBtn.addEventListener('click', (e) => {
				e.preventDefault();
				resetChat();
			});
		}

		if (embeddedStarters) {
			embeddedStarters.addEventListener('click', (e) => {
				const t = e.target;
				if (!(t instanceof Element)) return;
				const btn = t.closest('[data-role="advisor-starter"]');
				if (!btn) return;
				e.preventDefault();
				const txt = String(btn.getAttribute('data-text') || '').trim();
				if (!txt) return;
				chatInput.value = txt;
				chatInput.focus();
			});
		}

		advisorRoot.addEventListener('click', (e) => {
			const t = e.target;
			if (!(t instanceof Element)) return;

			const del = t.closest('[data-role="advisor-history-delete"]');
			if (del) {
				e.preventDefault();
				const id = String(del.getAttribute('data-id') || '').trim();
				if (id) {
					deleteSession(id);
					renderHistory();
					renderActiveChat();
					applyEmbeddedCopy();
					setActiveModeButton(getMode());
					renderStarters();
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
