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

	const addMessageToChat = (text, sender) => {
		const messageElement = document.createElement('div');
		messageElement.classList.add('chat-message', sender);
		messageElement.innerHTML = String(text || '').replace(/\n/g, '<br>');
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
			const reply = String(data?.reply || '').trim();
			const followUp = data?.follow_up ? String(data.follow_up).trim() : '';
			state.lastSearch = data?.search || null;

			let out = reply || 'Rozumím.';
			if (state.lastSearch && (state.lastSearch.q || state.lastSearch.kraj || state.lastSearch.place)) {
				const url = buildJobsUrl(state.lastSearch);
				out += `\n\nOdkaz: <a href="${url}">Otevřít vyfiltrované nabídky</a>`;
			}
			if (followUp) out += `\n\n${followUp}`;

			addMessageToChat(out, 'bot');
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
});
