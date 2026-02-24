// Počká, až se načte celá stránka
document.addEventListener("DOMContentLoaded", () => {

	// Najde potřebné HTML elementy
	const chatTrigger = document.getElementById("chat-trigger");
	const chatWindow = document.getElementById("chat-window");
	const chatMessages = document.getElementById("chat-messages");
	const chatInput = document.getElementById("chat-input-field");
	const chatSendButton = document.getElementById("chat-send-btn");

	// If the page doesn't include the chatbot markup, do nothing.
	if (!chatTrigger || !chatWindow || !chatMessages || !chatInput || !chatSendButton) {
		return;
	}

    // Paměť pro téma konverzace
    let pendingTopic = null;

	// 1. Přepínání viditelnosti okna
	chatTrigger.addEventListener("click", () => {
		if (chatWindow.style.display === "none" || chatWindow.style.display === "") {
			chatWindow.style.display = "flex";
			// Uvítací zpráva, pokud je chat prázdný
			if (chatMessages.children.length === 0) {
                pendingTopic = null; // Vždy resetujeme paměť při otevření
				addMessageToChat("Dobrý den! Jsem online kariérový poradce. Zeptejte se mě na konkrétní obor (např. 'automechanik', 'kuchař' nebo 'opravář').", "bot");
			}
		} else {
			chatWindow.style.display = "none";
		}
	});

	// 2. Funkce pro odeslání zprávy (tlačítkem nebo Enterem)
	const sendMessage = () => {
		const messageText = chatInput.value.trim();
		if (messageText === "") return; // Neodesílat prázdné zprávy

		// Přidá zprávu uživatele do chatu
		addMessageToChat(messageText, "user");
		chatInput.value = ""; // Vyčistí vstupní pole

		// Získá odpověď od bota (s malým zpožděním, aby to vypadalo reálněji)
		setTimeout(() => {
			const botResponse = getBotResponse(messageText);
			addMessageToChat(botResponse, "bot");
		}, 1000);
	};

	// Odeslání kliknutím na tlačítko
	chatSendButton.addEventListener("click", sendMessage);

	// Odeslání stisknutím klávesy Enter
	chatInput.addEventListener("keydown", (event) => {
		if (event.key === "Enter") {
			sendMessage();
		}
	});

	// 3. Funkce pro přidání zprávy do okna
	const addMessageToChat = (text, sender) => {
		const messageElement = document.createElement("div");
		messageElement.classList.add("chat-message", sender);
		messageElement.innerHTML = text.replace(/\n/g, '<br>'); // Podporuje nové řádky
		chatMessages.appendChild(messageElement);
		chatMessages.scrollTop = chatMessages.scrollHeight;
	};


	// 4. "Mozek" chatbota - VERZE S PAMĚTÍ
	// (Proměnná 'DATA' je definovaná v souboru index.html)
	const getBotResponse = (userInput) => {
		const input = userInput.toLowerCase();

        // === ČÁST A: ZPRACOVÁNÍ ODPOVĚDI NA LOKALITU ===
        if (pendingTopic) {
            let regionFilter = null;
            let regionName = "";

            // --- ZDE JE ÚPRAVA PRO DIAKRITIKU ---
            if (input.includes("plzeň") || input.includes("plzeňský") || input.includes("plzen") || input.includes("plzensky")) {
                regionFilter = 'CZ032';
                regionName = "v Plzeňském kraji";
            } else if (input.includes("karlovar") || input.includes("karlovarský") || input.includes("karlovarsky")) {
                regionFilter = 'CZ041';
                regionName = "v Karlovarském kraji";
            } else if (input.includes("zahraničí") || input.includes("německo") || input.includes("zahranici") || input.includes("nemecko")) {
                regionFilter = 'zahranici_bor';
                regionName = "v zahraničí";
            }
            // --- KONEC ÚPRAVY PRO DIAKRITIKU ---


            // Pokud jsme našli lokalitu
            if (regionFilter) {
				if (typeof DATA === "undefined" || !DATA) {
					const topicName = pendingTopic;
					pendingTopic = null;
					return `Teď nemám k dispozici datovou sadu nabídek pro obor ${topicName} (na této stránce). Zkuste prosím stránku s tabulkou nabídek nebo vyhledávání pracovních pozic.`;
				}

				const dataSet = DATA[pendingTopic]; // 'auto', 'agri', nebo 'gastro'
                let foundJob = null;

                if (regionFilter === 'zahranici_bor') {
                    foundJob = dataSet.find(job => job.area === 'zahranici_bor');
                } else {
                    foundJob = dataSet.find(job => job.kraj === regionFilter);
                }

                // Důležité: Vymažeme paměť, aby se bot neptal znovu.
                const topicName = pendingTopic; // Uložíme si název oboru pro odpověď
                pendingTopic = null; 

                if (foundJob) {
                    return `OK, ${regionName} pro obor ${topicName} jsem našel například:\n\n"${foundJob.profese}"\nu firmy: ${foundJob.zamestnavatel}\nv místě: ${foundJob.okres}.\n\nVšechny ostatní nabídky najdete v příslušné tabulce na stránce.`;
                } else {
                    return `Bohužel, ${regionName} pro obor ${topicName} zrovna teď v datech žádnou nabídku nevidím. Zkuste se podívat přímo do tabulky na jiný kraj.`;
                }

            } else {
                // Uživatel odpověděl, ale nebylo to ani jedno z míst.
                pendingTopic = null; // Resetujeme paměť.
                return "Tomu jsem nerozuměl. Zkusme to prosím znovu od začátku. O jaký obor máte zájem?";
            }
        }

        // === ČÁST B: ZPRACOVÁNÍ NOVÉ OTÁZKY ===
        // Toto se spustí, jen pokud na nic nečekáme (pendingTopic === null)

		// Přivítání
		if (input.includes("ahoj") || input.includes("dobrý den") || input.includes("zdravím")) {
			return "Dobrý den! Jsem online kariérový poradce. Můžete se mě zeptat na konkrétní pracovní obor.";
		}

		// Automechanik (tady taky přidáme rozpoznávání bez diakritiky)
		if (input.includes("automechanik") || input.includes("mechanik") || input.includes("auta") || input.includes("automechanik") || input.includes("mechanik")) {
            pendingTopic = 'auto'; // Uložíme si, že se ptá na AUTA
			return "Skvělá volba. Kde byste chtěl pracovat?\n\n(Napište mi: Plzeňský kraj, Karlovarský kraj, nebo Zahraničí)";
		}

		// Kuchař nebo číšník
		if (input.includes("kuchař") || input.includes("kuchařka") || input.includes("číšník") || input.includes("servírka") || input.includes("gastro") || input.includes("kuchar") || input.includes("cisnik")) {
			pendingTopic = 'gastro'; // Uložíme si, že se ptá na GASTRO
            return "Rozumím. Pro jakou lokalitu hledáte?\n\n(Napište: Plzeňský kraj, Karlovarský kraj, nebo Zahraničí)";
		}

		// Opravář zemědělských strojů
		if (input.includes("opravář") || input.includes("zemědělských") || input.includes("agri") || input.includes("opravar") || input.includes("zemedelskych")) {
			pendingTopic = 'agri'; // Uložíme si, že se ptá na AGRI
            return "Výborně. Hledáte v Plzeňském kraji, Karlovarském kraji, nebo v zahraničí?";
		}
		
		// Ostatní dotazy (kontakt, služby...)
		if (input.includes("kontakt") || input.includes("email") || input.includes("telefon") || input.includes("adresa")) {
			return "Omlouvám se, na této ukázkové stránce nemám k dispozici kontaktní údaje. Jsem jen chatbot pro demonstraci nabídek práce.";
		}
		if (input.includes("služby") || input.includes("pomoc") || input.includes("životopis") || input.includes("cv")) {
			return "Mojí hlavní funkcí je ukazovat vám přehled pracovních nabídek. Pro specifické služby jako tvorba CV se prosím obraťte přímo na kariéního poradce.";
		}
		if (input.includes("díky") || input.includes("děkuji")) {
			return "Rádo se stalo! Přeji hezký den.";
		}

		// Výchozí odpověď (když nerozumí)
		return "Omlouvám se, této otázce úplně nerozumím. Zkuste se zeptat na konkrétní pracovní obor (např. 'automechanik', 'kuchař' nebo 'opravář').";
	};

});
