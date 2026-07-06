// ══════════════════════════════════════════════════════════════
// ADMIN SHARED LOGIC
// Shared between admin.html (SP) and admin-pt.html (PT).
//
// Exposes everything on window.SharedAdmin. Each host page must call
// SharedAdmin.configure({...}) once at startup with its hooks before
// using anything else — see the "configure" doc below.
//
// Contains: login/setup/SSE init, error/info modals, keypad, category
// + match loading/navigation, flag picker, name edit modal, referee
// management (render/auth/score/connect), display-window toggle,
// session logging, toast.
//
// Does NOT contain: anything specific to the SP match layout (timer,
// round, break, doctor timer, W/-P, winner modal) — those stay in
// admin.html. PT-specific scoring (starts at 10, scales down, 2-form
// flow) stays in admin-pt.html.
// ══════════════════════════════════════════════════════════════

(function () {

    // ── CONFIGURATION / HOOKS ──
    // Filled in by SharedAdmin.configure(...). See bottom of file for defaults.
    let hooks = {};

    // ── SHARED STATE ──
    let localIp = null;
    let setupEventId = null;
    let setupRingId = null;
    let setupSpecialty = null;

    let currentMatches = [];
    let currentMatchIndex = 0;

    let currentCountryRed = "ITALY";
    let currentCountryBlue = "ITALY";

    let logSessionId = null;

    const categoriesById = {};

    let refereeCount = 4;
    let refereeState = {};
    let refereeDefaultStartScore = 0;
    let refereeButtons = [1];      // specialty's tablet button values (SP: [3,2,1], PT: [-0.2,-0.5,0])
    let refereeDefaultButton = 1;  // the value a plain, tier-less button press should apply (SP: 1, PT: -0.2)

    let currentAuthRefereeId = null;
    let keypadTargetId = null;
    let keypadMin = 0;
    let keypadValue = "";
    let keypadAllowNegative = false;
    let keypadOnConfirm = null;

    let nameEditTargetId = null;
    let nameEditOnConfirm = null;

    let flagPickerTargetId = null;
    let cachedFlagList = null;

    let displayWindowOpen = false;

    function apiBase() {
        return localIp ? `http://${localIp}:8080` : "http://localhost:8080";
    }

    // ── INIT / LOGIN / SSE ──
    async function init() {
        try {
            const setupParams = new URLSearchParams(window.location.search);
            setupEventId = setupParams.get("event");
            setupRingId = setupParams.get("ring");
            setupSpecialty = setupParams.get("specialty");

            if (!setupEventId || !setupRingId || !setupSpecialty) {
                showErrorModal("Missing setup data", "Event, ring or specialty were not provided. Please go back and complete the setup screen.");
                return;
            }

            const res = await fetch(`http://localhost:8080/api/login/admin`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ eventId: setupEventId, ringId: setupRingId, specialty: setupSpecialty })
            });
            if (!res.ok) throw new Error(`Login failed (HTTP ${res.status})`);
            const data = await res.json();

            console.log("Login successful:", data);
            localIp = data.localIp;

            document.getElementById("ringNumber").textContent = setupRingId;

            const refereeCountFromServer = parseInt(data.referees) || refereeCount;
            const startScoreFromServer = data.refereeStartScore !== undefined
                ? parseFloat(data.refereeStartScore)
                : (hooks.refereeStartScore ?? 0);
            initReferees(refereeCountFromServer, startScoreFromServer);

            if (Array.isArray(data.buttons)) refereeButtons = data.buttons;
            if (data.defaultButton !== undefined) refereeDefaultButton = parseFloat(data.defaultButton);

            await startLogSession(setupRingId);

            const eventSource = new EventSource(`http://${localIp}:8080/stream/admin`);
            console.log("Event stream initialized on", `http://${localIp}:8080/stream/admin`);

            eventSource.onmessage = (event) => {
                const data = JSON.parse(event.data);
                console.log("Event received:", data);

                if (data.action === "connected") {
                    markRefereeConnected(data.referee);
                }

                if (data.action === "update_score") {
                    updateRefereeScore(data.referee, data.score);
                }
            };

            if (hooks.onInitComplete) hooks.onInitComplete();

        } catch (err) {
            console.error("Initialization error:", err);
            showErrorModal("Login failed", "Could not connect to the local server. Please check that the server is running and try again.");
        }
    }

    // ── ERROR MODAL ──
    function showErrorModal(title, message) {
        document.getElementById("errorModalTitle").textContent = title;
        document.getElementById("errorModalMessage").textContent = message;
        document.getElementById("errorModalOverlay").classList.remove("hidden");
    }

    function closeErrorModal() {
        document.getElementById("errorModalOverlay").classList.add("hidden");
    }

    function closeErrorModalOnBackdrop(event) {
        if (event.target.id === "errorModalOverlay") closeErrorModal();
    }

    // ── INFO MODAL (generic confirmations / transitions) ──
    // options.cancelText: pass to show an explicit Cancel button alongside
    // the confirm button (otherwise the modal is only dismissible via the
    // backdrop, as before). options.onCancel fires if provided.
    function showInfoModal(title, message, buttonText = null, onConfirm = null, options = {}) {
        document.getElementById("infoModalTitle").textContent = title;
        document.getElementById("infoModalMessage").textContent = message;
        document.getElementById("infoModalIcon").textContent = options.icon || "ⓘ";

        const footer = document.getElementById("infoModalFooter");
        const btn = document.getElementById("infoModalBtn");

        if (buttonText) {
            footer.classList.remove("hidden");
            btn.textContent = buttonText;
            btn.classList.toggle("success", !!options.success);
            btn.onclick = () => {
                closeInfoModal();
                if (onConfirm) onConfirm();
            };
        } else {
            footer.classList.add("hidden");
        }

        const cancelRow = document.getElementById("infoModalCancelRow");
        const cancelBtn = document.getElementById("infoModalCancelBtn");
        if (options.cancelText) {
            cancelRow.classList.remove("hidden");
            cancelBtn.textContent = options.cancelText;
            cancelBtn.onclick = () => {
                closeInfoModal();
                if (options.onCancel) options.onCancel();
            };
        } else {
            cancelRow.classList.add("hidden");
        }

        document.getElementById("infoModalOverlay").classList.remove("hidden");
    }

    function closeInfoModal() {
        document.getElementById("infoModalOverlay").classList.add("hidden");
    }

    function closeInfoModalOnBackdrop(event) {
        if (event.target.id === "infoModalOverlay") closeInfoModal();
    }

    // ── KEYPAD ──
    // targetId: id of an <input> to update directly (legacy behavior), or null
    // when using a custom onConfirm callback instead (e.g. referee score boxes).
    function openKeypad(targetId, title, min, options = {}) {
        keypadTargetId = targetId;
        keypadMin = min;
        keypadAllowNegative = options.allowNegative ?? false;
        keypadOnConfirm = options.onConfirm ?? null;

        const startValue = options.initialValue ?? (targetId ? document.getElementById(targetId).value : "");
        keypadValue = startValue !== undefined && startValue !== null ? String(startValue) : "";

        document.getElementById("keypadTitle").textContent = title;
        document.getElementById("keypadDisplay").value = keypadValue || "0";
        document.getElementById("keypadSignBtn").disabled = !keypadAllowNegative;
        document.getElementById("keypadOverlay").classList.remove("hidden");

        const displayInput = document.getElementById("keypadDisplay");
        setTimeout(() => {
            displayInput.focus();
            displayInput.select();
        }, 0);
    }

    function closeKeypad() {
        document.getElementById("keypadOverlay").classList.add("hidden");
        keypadTargetId = null;
        keypadOnConfirm = null;
        keypadAllowNegative = false;
    }

    function closeKeypadOnBackdrop(event) {
        if (event.target.id === "keypadOverlay") closeKeypad();
    }

    function keypadPress(digit) {
        if (keypadValue.length >= 6) return;
        keypadValue += digit;
        document.getElementById("keypadDisplay").value = keypadValue;
    }

    function keypadBackspace() {
        keypadValue = keypadValue.slice(0, -1);
        document.getElementById("keypadDisplay").value = keypadValue || "0";
    }

    function keypadClear() {
        keypadValue = "";
        document.getElementById("keypadDisplay").value = "0";
    }

    function keypadToggleSign() {
        if (!keypadAllowNegative) return;
        if (keypadValue.startsWith("-")) {
            keypadValue = keypadValue.slice(1);
        } else if (keypadValue) {
            keypadValue = "-" + keypadValue;
        } else {
            keypadValue = "-";
        }
        document.getElementById("keypadDisplay").value = keypadValue || "0";
    }

    // Syncs keypadValue when the user types directly on a physical keyboard.
    function keypadOnInput(input) {
        let raw = input.value;

        let sign = "";
        if (keypadAllowNegative && raw.startsWith("-")) {
            sign = "-";
            raw = raw.slice(1);
        }
        const digits = raw.replace(/[^0-9]/g, "").slice(0, 6);

        keypadValue = sign + digits;
        input.value = keypadValue;
    }

    function keypadOnKeydown(event) {
        if (event.key === "Enter") {
            event.preventDefault();
            confirmKeypad();
        } else if (event.key === "Escape") {
            event.preventDefault();
            closeKeypad();
        }
    }

    function confirmKeypad() {
        if (!keypadTargetId && !keypadOnConfirm) return;

        let value = parseInt(keypadValue);
        if (isNaN(value)) value = keypadMin;
        if (!keypadAllowNegative && value < keypadMin) value = keypadMin;

        if (keypadOnConfirm) {
            keypadOnConfirm(value);
        } else {
            const input = document.getElementById(keypadTargetId);
            input.value = value;
            input.dispatchEvent(new Event("change"));
        }

        closeKeypad();
    }

    // ── CATEGORY MODAL ──
    function openCategoryModal() {
        document.getElementById("categoryModalOverlay").classList.remove("hidden");
        refreshCategoryList();
    }

    function closeCategoryModal() {
        document.getElementById("categoryModalOverlay").classList.add("hidden");
    }

    function closeCategoryModalOnBackdrop(event) {
        if (event.target.id === "categoryModalOverlay") closeCategoryModal();
    }

    async function refreshCategoryList() {
        const select = document.getElementById("categorySelect");

        try {
            const res = await fetch(`${apiBase()}/api/categories`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const categories = await res.json();

            select.innerHTML = "";
            categories.forEach(cat => {
                categoriesById[cat.id] = cat;

                const option = document.createElement("option");
                option.value = cat.id;
                option.textContent = cat.long_custom_name;
                select.appendChild(option);
            });

            showToast(`Category list refreshed (${categories.length} categories)`);
        } catch (err) {
            console.error("Failed to fetch categories:", err);
            showErrorModal("Could not load categories", "Failed to fetch the category list from the server. Please check the connection and try again.");
        }
    }

    async function loadCategory() {
        const select = document.getElementById("categorySelect");
        if (!select.options.length) {
            showToast("No category selected");
            return;
        }
        const selectedOption = select.options[select.selectedIndex];
        const categoryId = selectedOption.value;
        const category = categoriesById[categoryId];

        document.getElementById("categoryDisplay").textContent = selectedOption.textContent;
        document.getElementById("categoryDisplay").dataset.categoryId = categoryId;
        closeCategoryModal();

        logEvent("category_loaded", { category: selectedOption.textContent, categoryId });

        if (!category || !category.pool) {
            showToast("Category loaded (pool info missing — could not load matches)");
            return;
        }

        await loadMatches(categoryId, category.pool);
    }

    // Resets category/match state back to defaults (e.g. after a category
    // finishes), so the admin can load the next category from a clean slate.
    function resetCategoryForNextLoad() {
        document.getElementById("categoryDisplay").textContent = "No category loaded";
        document.getElementById("categoryDisplay").removeAttribute("data-category-id");

        document.getElementById("nameLeft").textContent = "RED";
        document.getElementById("nameRight").textContent = "BLUE";
        document.getElementById("matchNumber").value = "1";

        setFlag("flagLeft", "ITALY");
        setFlag("flagRight", "ITALY");

        updateMatchStatusBadge(null);

        currentMatches = [];
        currentMatchIndex = 0;
        updateMatchNavButtons();

        const nextRed = document.getElementById("nextMatchRed");
        const nextBlue = document.getElementById("nextMatchBlue");
        if (nextRed) nextRed.textContent = "RED";
        if (nextBlue) nextBlue.textContent = "BLUE";

        if (hooks.pushDisplayUpdate) hooks.pushDisplayUpdate();
        showToast("Ready to load a new category");
    }

    // Fetches matches for the loaded category/pool and applies the first
    // IN_PROGRESS one (or the first match if none is in progress).
    async function loadMatches(idCategory, pool, silent = false) {
        try {
            const res = await fetch(`${apiBase()}/api/matches?id_category=${idCategory}&pool=${pool}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();

            const matches = data.matches || [];
            if (!matches.length) {
                if (!silent) showToast("Category loaded — no matches found");
                return;
            }

            matches.sort((a, b) => parseInt(b.id_match) - parseInt(a.id_match));

            currentMatches = matches;

            const inProgressIndex = currentMatches.findIndex(m => m.state === "IN_PROGRESS");
            currentMatchIndex = inProgressIndex !== -1 ? inProgressIndex : 0;

            applyMatch(currentMatches[currentMatchIndex]);

            if (!silent) showToast(`Category loaded (${matches.length} matches)`);
        } catch (err) {
            console.error("Failed to fetch matches:", err);
            showErrorModal("Could not load matches", "Failed to fetch the match list for this category. Please check the connection and try again.");
        }
    }

    // Applies a single match's player names/flags to the RED/BLUE header,
    // then calls the host page's onMatchApplied hook for anything specific
    // (SP: timer/round resets; PT: form-score resets).
    function applyMatch(match) {
        if (!match) return;
        document.getElementById("nameLeft").textContent = match.left_player_des || "RED";
        document.getElementById("nameRight").textContent = match.right_player_des || "BLUE";
        document.getElementById("matchNumber").value = match.id_match;
        setFlag("flagLeft", match.left_player_country_name);
        setFlag("flagRight", match.right_player_country_name);
        updateMatchStatusBadge(match.state);
        updateMatchNavButtons();
        updateNextMatchPreview();
        notifyMatchDetails(match);

        if (hooks.pushDisplayUpdate) hooks.pushDisplayUpdate();

        logEvent("match_changed", {
            matchNumber: match.id_match,
            red: match.left_player_des || "RED",
            blue: match.right_player_des || "BLUE"
        });

        if (hooks.onMatchApplied) hooks.onMatchApplied(match);
    }

    // Sets a flag <img> src from a country name (e.g. "ITALY" -> /images/flags/ITALY.png).
    // Keeps the previously-shown flag (defaults to ITALY) if no country is given.
    function setFlag(imgId, countryName) {
        const img = document.getElementById(imgId);
        if (!img) return;

        if (imgId === "flagLeft") currentCountryRed = countryName || currentCountryRed;
        if (imgId === "flagRight") currentCountryBlue = countryName || currentCountryBlue;

        if (!countryName) return;

        img.style.visibility = "visible";
        img.src = `/images/flags/${countryName.toUpperCase()}.png`;
        img.onerror = () => { img.style.visibility = "hidden"; };
    }

    // currentMatches is sorted by id_match descending, and goToNextMatch moves
    // to currentMatchIndex + 1 — so the "next" match in flow is that same index.
    function updateNextMatchPreview() {
        const redEl = document.getElementById("nextMatchRed");
        const blueEl = document.getElementById("nextMatchBlue");
        if (!redEl || !blueEl) return;

        const next = currentMatches[currentMatchIndex + 1];
        if (next) {
            redEl.textContent = next.left_player_des || "RED";
            blueEl.textContent = next.right_player_des || "BLUE";
        } else {
            redEl.textContent = "—";
            blueEl.textContent = "—";
        }
    }

    function updateMatchStatusBadge(state) {
        const badge = document.getElementById("matchStatusBadge");
        if (!badge) return;
        const labels = { IDLE: "Idle", IN_PROGRESS: "In progress", COMPLETED: "Completed" };

        badge.classList.remove("idle", "in_progress", "completed", "visible");

        if (!state || !labels[state]) return;

        badge.textContent = labels[state];
        badge.classList.add(state.toLowerCase(), "visible");
    }

    function goToPrevMatch() {
        if (currentMatchIndex <= 0) return;
        currentMatchIndex -= 1;
        applyMatch(currentMatches[currentMatchIndex]);
    }

    function goToNextMatch() {
        if (currentMatchIndex >= currentMatches.length - 1) return;
        currentMatchIndex += 1;
        applyMatch(currentMatches[currentMatchIndex]);
    }

    function updateMatchNavButtons() {
        const prevBtn = document.getElementById("prevMatchBtn");
        const nextBtn = document.getElementById("nextMatchBtn");
        if (prevBtn) prevBtn.disabled = currentMatchIndex <= 0;
        if (nextBtn) nextBtn.disabled = currentMatchIndex >= currentMatches.length - 1;
    }

    // Notifies the server of match details (names/countries/photos/category/
    // specialty) for persistence.
    async function notifyMatchDetails(match) {
        try {
            const categoryName = document.getElementById("categoryDisplay").textContent;

            const body = {
                "red.name": match.left_player_des || "RED",
                "blue.name": match.right_player_des || "BLUE",
                "red.country": match.left_player_country_name || "",
                "blue.country": match.right_player_country_name || "",
                "red.photo": match.left_player_photo || "default.png",
                "blue.photo": match.right_player_photo || "default.png",
                "category": categoryName,
                "specialty": setupSpecialty
            };

            const res = await fetch(`${apiBase()}/api/match/details`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body)
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);

        } catch (err) {
            console.error("Failed to notify match details:", err);
        }
    }

    // ── GENERIC TEXT EDIT MODAL (participant names, category) ──
    function editParticipantName(targetId, defaultLabel) {
        openNameEditModal(
            targetId === "nameLeft" ? "Edit RED name" : "Edit BLUE name",
            targetId,
            defaultLabel
        );
    }

    function editCategoryName() {
        openNameEditModal("Edit category", "categoryDisplay", "No category loaded", () => {
            document.getElementById("categoryDisplay").removeAttribute("data-category-id");
            notifyCategoryOnly();
        });
    }

    async function notifyCategoryOnly() {
        try {
            const res = await fetch(`${apiBase()}/api/match/details`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ category: document.getElementById("categoryDisplay").textContent })
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
        } catch (err) {
            console.error("Failed to notify category update:", err);
        }
    }

    function openNameEditModal(title, targetId, defaultLabel, onConfirm = null) {
        nameEditTargetId = targetId;
        nameEditOnConfirm = onConfirm;

        const current = document.getElementById(targetId)?.textContent || "";

        document.getElementById("nameEditModalTitle").textContent = title;

        const input = document.getElementById("nameEditInput");
        input.value = current === defaultLabel ? "" : current;
        input.placeholder = defaultLabel;

        document.getElementById("nameEditModalOverlay").classList.remove("hidden");
        setTimeout(() => { input.focus(); input.select(); }, 0);
    }

    function confirmNameEdit() {
        if (!nameEditTargetId) return;

        const input = document.getElementById("nameEditInput");
        const value = input.value.trim();
        const el = document.getElementById(nameEditTargetId);

        el.textContent = value || input.placeholder;

        if (nameEditTargetId === "nameLeft") {
            logEvent("name_changed", { side: "red", name: el.textContent });
        } else if (nameEditTargetId === "nameRight") {
            logEvent("name_changed", { side: "blue", name: el.textContent });
        } else if (nameEditTargetId === "categoryDisplay") {
            logEvent("category_changed_manually", { category: el.textContent });
        }

        const callback = nameEditOnConfirm;
        closeNameEditModal();
        if (hooks.pushDisplayUpdate) hooks.pushDisplayUpdate();
        if (callback) callback();
        showToast("Updated");
    }

    function closeNameEditModal() {
        document.getElementById("nameEditModalOverlay").classList.add("hidden");
        nameEditTargetId = null;
        nameEditOnConfirm = null;
    }

    function closeNameEditModalOnBackdrop(event) {
        if (event.target.id === "nameEditModalOverlay") closeNameEditModal();
    }

    function nameEditOnKeydown(event) {
        if (event.key === "Enter") {
            event.preventDefault();
            confirmNameEdit();
        } else if (event.key === "Escape") {
            event.preventDefault();
            closeNameEditModal();
        }
    }

    // ── FLAG PICKER ──
    async function openFlagPicker(targetId) {
        flagPickerTargetId = targetId;
        document.getElementById("flagPickerOverlay").classList.remove("hidden");

        const grid = document.getElementById("flagPickerGrid");
        grid.innerHTML = `<div class="flag-picker-empty">Loading flags...</div>`;

        try {
            if (!cachedFlagList) {
                const res = await fetch(`${apiBase()}/api/flags`);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                cachedFlagList = data.countries || [];
            }

            if (!cachedFlagList.length) {
                grid.innerHTML = `<div class="flag-picker-empty">No flags found in public/images/flags</div>`;
                return;
            }

            grid.innerHTML = "";
            cachedFlagList.forEach(country => {
                const item = document.createElement("div");
                item.className = "flag-picker-item";
                item.onclick = () => selectFlag(country);
                item.innerHTML = `
                    <img src="/images/flags/${country}.png" alt="">
                    <span>${country}</span>
                `;
                grid.appendChild(item);
            });

        } catch (err) {
            console.error("Failed to load flag list:", err);
            grid.innerHTML = `<div class="flag-picker-empty">Failed to load flags</div>`;
        }
    }

    function selectFlag(country) {
        const img = document.getElementById(flagPickerTargetId);
        if (img) {
            img.src = `/images/flags/${country}.png`;
            img.onerror = () => { img.style.visibility = "hidden"; };
            img.style.visibility = "visible";
        }

        if (flagPickerTargetId === "flagLeft") currentCountryRed = country;
        if (flagPickerTargetId === "flagRight") currentCountryBlue = country;

        logEvent("flag_changed", {
            side: flagPickerTargetId === "flagLeft" ? "red" : "blue",
            country
        });

        closeFlagPicker();
        if (hooks.pushDisplayUpdate) hooks.pushDisplayUpdate();
        showToast(`Flag set to ${country}`);
    }

    function closeFlagPicker() {
        document.getElementById("flagPickerOverlay").classList.add("hidden");
        flagPickerTargetId = null;
    }

    function closeFlagPickerOnBackdrop(event) {
        if (event.target.id === "flagPickerOverlay") closeFlagPicker();
    }

    // ── DISPLAY WINDOW (second monitor) ──
    function toggleDisplayWindow() {
        if (!window.displayBridge) {
            showToast("Display bridge not available");
            return;
        }

        const btn = document.getElementById("displayToggleBtn");

        if (displayWindowOpen) {
            window.displayBridge.closeDisplay();
            displayWindowOpen = false;
            btn.textContent = "📺 OPEN DISPLAY";
            btn.classList.remove("active");
        } else {
            window.displayBridge.openDisplay(setupSpecialty);
            displayWindowOpen = true;
            btn.textContent = "📺 DISPLAY ON";
            btn.classList.add("active");
            if (hooks.pushDisplayUpdate) {
                setTimeout(hooks.pushDisplayUpdate, 400); // give the new window time to attach its listener
            }
        }
    }

    // Builds the part of the display payload that's identical for SP and PT.
    // Host pages spread this into their own payload and add specialty-specific
    // fields (timer/round/W-P for SP; form scores for PT) before calling
    // window.displayBridge.update(...).
    function buildBaseDisplayPayload() {
        let referees = [];
        try {
            for (let i = 1; i <= refereeCount; i++) {
                const ref = refereeState[i];
                referees.push(
                    ref && ref.connected && ref.enabled
                        ? { score: ref.score, active: true }
                        : { score: { red: 0, blue: 0 }, active: false }
                );
            }
        } catch (err) {
            referees = [];
        }

        return {
            ring: document.getElementById("ringNumber")?.textContent,
            category: document.getElementById("categoryDisplay")?.textContent,
            matchNumber: document.getElementById("matchNumber")?.value,

            nameRed: document.getElementById("nameLeft")?.textContent,
            nameBlue: document.getElementById("nameRight")?.textContent,
            countryRed: currentCountryRed,
            countryBlue: currentCountryBlue,

            referees: referees,

            nextMatches: [{
                red: document.getElementById("nextMatchRed")?.textContent || "",
                blue: document.getElementById("nextMatchBlue")?.textContent || ""
            }]
        };
    }

    // ── SESSION LOGGING ──
    async function startLogSession(ring) {
        try {
            const res = await fetch(`${apiBase()}/api/log/start`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ring })
            });
            const data = await res.json();
            if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);

            logSessionId = data.sessionId;
            console.log("Log session started:", data.fileName);
        } catch (err) {
            console.error("Failed to start log session:", err);
        }
    }

    // Fire-and-forget: logs an event to the current session file. Never blocks
    // or interrupts the UI flow even if the request fails.
    function logEvent(event, fields = {}) {
        fetch(`${apiBase()}/api/log/event`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ event, ...fields })
        }).catch(err => console.error(`Failed to log event "${event}":`, err));
    }

    function downloadSessionLog() {
        if (!logSessionId) {
            showToast("No active log session yet");
            return;
        }
        const fileName = `RING_${setupRingId}_${logSessionId}.jsonl`;
        window.open(`${apiBase()}/api/log/download/${fileName}`, "_blank");
    }

    // ── REFEREES ──
    // Initializes refereeCount/refereeState and renders the cards.
    // Called automatically by init() once the login response tells us how
    // many referees this specialty has; startScore comes from
    // hooks.refereeStartScore (0 for SP, 10 for PT). Exposed in case a host
    // page ever needs to re-initialize at runtime.
    function initReferees(count, startScore = 0) {
        refereeCount = count;
        refereeDefaultStartScore = startScore;
        refereeState = {};
        recentScoreEvents = [];
        for (let i = 1; i <= refereeCount; i++) {
            refereeState[i] = {
                score: { red: startScore, blue: startScore },
                code: null,
                url: null,
                connected: false,
                enabled: true,
                staleWarned: false, // true once we've flagged this referee as lagging behind the others
                imbalanceSince: 0   // Date.now() of when this referee first fell behind (0 = not currently behind)
            };
        }
        renderReferees();
        startRefereeStalenessWatch();
    }

    // ── REFEREE STALENESS WATCH ──
    // Flags a referee who's fallen behind the others: EVENT_GAP_THRESHOLD+
    // scoring events from others with zero events of their own within
    // EVENT_WINDOW_MS. That imbalance has to hold continuously for
    // STALE_DWELL_MS (a real 15s of elapsed time) before we actually flag it
    // — otherwise a quick burst of clicks (or a genuinely fast exchange)
    // would trigger the warning almost instantly, which felt too twitchy.
    // EVENT_WINDOW_MS is deliberately longer than the dwell time so the
    // qualifying events don't age out of the window before the dwell
    // period has a chance to complete.
    const EVENT_GAP_THRESHOLD = 1;
    const EVENT_WINDOW_MS = 20000;
    const STALE_DWELL_MS = 10000;
    let recentScoreEvents = []; // { refereeId, timestamp } — pruned to the last EVENT_WINDOW_MS on every check
    let staleWatchInterval = null;

    function startRefereeStalenessWatch() {
        if (staleWatchInterval) clearInterval(staleWatchInterval);
        staleWatchInterval = setInterval(checkRefereeStaleness, 5000);
    }

    function checkRefereeStaleness() {
        const activeRefIds = [];
        for (let i = 1; i <= refereeCount; i++) {
            const ref = refereeState[i];
            if (ref && ref.connected && ref.enabled) activeRefIds.push(i);
        }
        if (activeRefIds.length < 2) return;

        const now = Date.now();
        const windowStart = now - EVENT_WINDOW_MS;
        recentScoreEvents = recentScoreEvents.filter(e => e.timestamp >= windowStart);
        if (recentScoreEvents.length === 0) return; // nobody's scored in the window at all — idle, not a fault

        activeRefIds.forEach(i => {
            const ref = refereeState[i];
            const ownEvents = recentScoreEvents.filter(e => e.refereeId === i).length;
            const otherEvents = recentScoreEvents.length - ownEvents;
            const imbalanced = ownEvents === 0 && otherEvents >= EVENT_GAP_THRESHOLD;
            const card = document.getElementById(`refScoreRed${i}`)?.closest(".referee-card");

            if (!imbalanced) {
                ref.imbalanceSince = 0;
                if (ref.staleWarned) {
                    ref.staleWarned = false;
                    card?.classList.remove("stale-warning");
                }
                return;
            }

            if (!ref.imbalanceSince) ref.imbalanceSince = now;

            if (now - ref.imbalanceSince >= STALE_DWELL_MS && !ref.staleWarned) {
                ref.staleWarned = true;
                card?.classList.add("stale-warning");
                showToast(`Referee ${i} hasn't scored in a while — check their tablet`);
                logEvent("referee_stale_warning", { referee: i, otherEvents });
            }
        });
    }

    // Clears any stale-referee warning — call this on RESET ALL so a fresh
    // match doesn't start with a leftover yellow indicator from before.
    function clearRefereeStaleWarnings() {
        recentScoreEvents = [];
        for (let i = 1; i <= refereeCount; i++) {
            const ref = refereeState[i];
            if (!ref) continue;

            ref.staleWarned = false;
            ref.imbalanceSince = 0;
            document.getElementById(`refScoreRed${i}`)?.closest(".referee-card")?.classList.remove("stale-warning");
        }
    }

    function renderReferees() {
        const refereesGrid = document.getElementById("refereesGrid");
        refereesGrid.innerHTML = "";

        for (let i = 1; i <= refereeCount; i++) {
            const card = document.createElement("div");
            card.className = "referee-card";
            card.innerHTML = `
                <div class="referee-title-row">
                    <div class="referee-title">Referee ${i}</div>
                    <label class="referee-toggle">
                        <input type="checkbox" id="refEnabled${i}" ${refereeState[i].enabled ? "checked" : ""}>
                        <span class="referee-toggle-slider"></span>
                    </label>
                </div>
                <div class="referee-score-row">
                    <div class="referee-score-box red" id="refScoreRed${i}" onclick="SharedAdmin.editRefereeScore(${i}, 'red')">${refereeState[i].score.red}</div>
                    <div class="referee-score-box blue" id="refScoreBlue${i}" onclick="SharedAdmin.editRefereeScore(${i}, 'blue')">${refereeState[i].score.blue}</div>
                </div>
                <div class="referee-btn-row">
                    <button class="referee-btn auth" id="refAuth${i}">AUTH</button>
                    <button class="referee-btn reset" id="refReset${i}">RESET</button>
                </div>
                <div class="referee-btn-row">
                    <button class="referee-btn copy" id="refCode${i}" ${refereeState[i].code ? "" : "disabled"}>
                        <span class="copy-icon">⧉</span> ${refereeState[i].code ?? "CODE"}
                    </button>
                    <button class="referee-btn copy" id="refUrl${i}" ${refereeState[i].url ? "" : "disabled"}>
                        <span class="copy-icon">⧉</span> URL
                    </button>
                </div>
            `;
            refereesGrid.appendChild(card);

            document.getElementById(`refEnabled${i}`).addEventListener("change", (e) => {
                toggleRefereeEnabled(i, e.target.checked);
            });

            document.getElementById(`refAuth${i}`).addEventListener("click", () => {
                authReferee(i);
            });

            document.getElementById(`refReset${i}`).addEventListener("click", () => {
                resetRefereeScore(i);
            });

            document.getElementById(`refCode${i}`).addEventListener("click", () => {
                if (!refereeState[i].code) return;
                copyToClipboard(refereeState[i].code, `Code for Referee ${i} copied`);
            });

            document.getElementById(`refUrl${i}`).addEventListener("click", () => {
                if (!refereeState[i].url) return;
                copyToClipboard(refereeState[i].url, `URL for Referee ${i} copied`);
            });
        }
    }

    function copyToClipboard(text, message) {
        navigator.clipboard.writeText(text)
            .then(() => showToast(message))
            .catch(() => showToast("Copy failed"));
    }

    async function authReferee(refereeId) {
        try {
            const res = await fetch(`${apiBase()}/api/tablet/url/${refereeId}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();

            if (!data.ok || !data.url) throw new Error("Invalid response");

            refereeState[refereeId].url = data.url;

            const urlBtn = document.getElementById(`refUrl${refereeId}`);
            if (urlBtn) {
                urlBtn.disabled = false;
                urlBtn.innerHTML = `<span class="copy-icon">⧉</span> URL`;
            }

            openAuthModal(refereeId, data.url);

        } catch (err) {
            console.error("Referee auth error:", err);
            showErrorModal("Authentication failed", `Could not generate the link for Referee ${refereeId}. Please check the server connection and try again.`);
        }
    }

    function openAuthModal(refereeId, url) {
        currentAuthRefereeId = refereeId;
        document.getElementById("authModalTitle").textContent = `Referee ${refereeId} link`;
        document.getElementById("authUrlInput").value = url;

        const qrBox = document.getElementById("authQrBox");
        qrBox.innerHTML = "";
        const canvas = document.createElement("canvas");
        qrBox.appendChild(canvas);
        QRCode.toCanvas(canvas, url, { width: 220, margin: 1 }, (err) => {
            if (err) console.error("QR generation error:", err);
        });

        document.getElementById("authModalOverlay").classList.remove("hidden");
    }

    function closeAuthModal() {
        document.getElementById("authModalOverlay").classList.add("hidden");
        currentAuthRefereeId = null;
    }

    function closeAuthModalOnBackdrop(event) {
        if (event.target.id === "authModalOverlay") closeAuthModal();
    }

    function copyAuthUrl() {
        const url = document.getElementById("authUrlInput").value;
        copyToClipboard(url, "Link copied to clipboard");
    }

    function markRefereeConnected(refereeId) {
        if (!refereeState[refereeId]) return;
        refereeState[refereeId].connected = true;

        const redBox = document.getElementById(`refScoreRed${refereeId}`);
        const blueBox = document.getElementById(`refScoreBlue${refereeId}`);
        if (redBox) redBox.classList.add("connected");
        if (blueBox) blueBox.classList.add("connected");

        if (currentAuthRefereeId === refereeId) {
            closeAuthModal();
        }

        showToast(`Referee ${refereeId} connected`);
        logEvent("referee_connected", { referee: refereeId });

        if (hooks.onRefereeScoreChanged) hooks.onRefereeScoreChanged();
        if (hooks.onRefereeConnected) hooks.onRefereeConnected(refereeId);
    }

    function updateRefereeScore(refereeId, score) {
        if (!refereeState[refereeId] || !score) return;

        refereeState[refereeId].score = score;
        recentScoreEvents.push({ refereeId, timestamp: Date.now() });

        const redBox = document.getElementById(`refScoreRed${refereeId}`);
        const blueBox = document.getElementById(`refScoreBlue${refereeId}`);
        if (redBox) redBox.textContent = score.red ?? 0;
        if (blueBox) blueBox.textContent = score.blue ?? 0;

        if (hooks.onRefereeScoreChanged) hooks.onRefereeScoreChanged();
        if (hooks.onRefereeScoreUpdated) hooks.onRefereeScoreUpdated(refereeId, score);

        logEvent("referee_score", {
            referee: refereeId,
            red: score.red ?? 0,
            blue: score.blue ?? 0,
            ...(hooks.extraLogContext ? hooks.extraLogContext() : {})
        });
    }

    // Opens the keypad to manually edit a single referee's score for one color.
    function editRefereeScore(refereeId, color) {
        const ref = refereeState[refereeId];
        if (!ref) return;

        openKeypad(null, `Referee ${refereeId} — ${color.toUpperCase()} score`, 0, {
            allowNegative: true,
            initialValue: ref.score[color],
            onConfirm: (value) => {
                ref.score[color] = value;

                const box = document.getElementById(`refScore${color === "red" ? "Red" : "Blue"}${refereeId}`);
                if (box) box.textContent = value;

                if (hooks.onRefereeScoreChanged) hooks.onRefereeScoreChanged();
                if (hooks.onRefereeScoreUpdated) hooks.onRefereeScoreUpdated(refereeId, ref.score);

                if (ref.connected) {
                    notifyRefereeScore(refereeId, ref.score);
                }

                showToast(`Referee ${refereeId} ${color} score set to ${value}`);
            }
        });
    }

    // Enables/disables a referee. A disabled referee is excluded from the
    // main majority-vote score and from warning/penalty point subtractions,
    // as if it didn't exist — but its own score/connection state is preserved.
    function toggleRefereeEnabled(refereeId, enabled) {
        const ref = refereeState[refereeId];
        if (!ref) return;

        ref.enabled = enabled;

        const card = document.getElementById(`refEnabled${refereeId}`).closest(".referee-card");
        if (card) card.classList.toggle("disabled-referee", !enabled);

        if (hooks.onRefereeScoreChanged) hooks.onRefereeScoreChanged();
        showToast(`Referee ${refereeId} ${enabled ? "enabled" : "disabled"}`);
    }

    // Resets a single referee's score back to startScore (local UI + server notify).
    function resetRefereeScore(refereeId, startScore = refereeDefaultStartScore) {
        const ref = refereeState[refereeId];
        if (!ref) return;

        ref.score = { red: startScore, blue: startScore };

        const redBox = document.getElementById(`refScoreRed${refereeId}`);
        const blueBox = document.getElementById(`refScoreBlue${refereeId}`);
        if (redBox) redBox.textContent = startScore;
        if (blueBox) blueBox.textContent = startScore;

        if (hooks.onRefereeScoreChanged) hooks.onRefereeScoreChanged();
        if (hooks.onRefereeScoreUpdated) hooks.onRefereeScoreUpdated(refereeId, ref.score);

        if (ref.connected) {
            notifyRefereeScore(refereeId, ref.score);
        }

        showToast(`Referee ${refereeId} score reset`);
    }

    // Subtracts 1 point from the given color for every connected+enabled
    // referee, updates their card display, then notifies hooks.
    function subtractPointFromAllReferees(color) {
        for (let i = 1; i <= refereeCount; i++) {
            const ref = refereeState[i];
            if (!ref || !ref.connected || !ref.enabled) continue;

            ref.score[color] = (parseFloat(ref.score[color]) || 0) - 1;

            const box = document.getElementById(`refScore${color === "red" ? "Red" : "Blue"}${i}`);
            if (box) box.textContent = ref.score[color];

            notifyRefereeScore(i, ref.score);
            if (hooks.onRefereeScoreUpdated) hooks.onRefereeScoreUpdated(i, ref.score);
        }
        if (hooks.onRefereeScoreChanged) hooks.onRefereeScoreChanged();
    }

    // Notifies the server (and therefore the referee's tablet) of a score
    // change that originated from the admin panel (warnings, penalties, reset).
    async function notifyRefereeScore(refereeId, score) {
        try {
            const res = await fetch(`${apiBase()}/api/score/referee/${refereeId}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "reset_score",
                    score: { red: score.red, blue: score.blue }
                })
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
        } catch (err) {
            console.error(`Failed to notify referee ${refereeId} of score update:`, err);
        }
    }

    // Main score = how many referees currently favor red vs blue (majority
    // voting). A referee favors the color with the higher score; ties count
    // for neither. For PT, lower score wins per-referee since PT scales down
    // from 10 — pass invert=true in that case.
    function recalculateMainScore(invert = false) {
        let redVotes = 0;
        let blueVotes = 0;

        for (let i = 1; i <= refereeCount; i++) {
            const ref = refereeState[i];
            if (!ref || !ref.connected || !ref.enabled || !ref.score) continue;

            const red = parseFloat(ref.score.red) || 0;
            const blue = parseFloat(ref.score.blue) || 0;

            let redWins = red > blue;
            let blueWins = blue > red;
            if (invert) { redWins = blue > red; blueWins = red > blue; }

            if (redWins) redVotes++;
            else if (blueWins) blueVotes++;
        }

        const leftEl = document.getElementById("mainScoreLeft");
        const rightEl = document.getElementById("mainScoreRight");
        if (leftEl) leftEl.textContent = redVotes;
        if (rightEl) rightEl.textContent = blueVotes;

        if (hooks.afterRecalculateMainScore) hooks.afterRecalculateMainScore(redVotes, blueVotes);

        return { redVotes, blueVotes };
    }

    // ── SERIAL PORT (Web Serial API, for external referee controllers) ──
    // Electron's Chromium engine supports navigator.serial, but unlike a
    // normal browser tab, Electron doesn't show the OS-native port picker on
    // its own — main.cjs intercepts the "select-serial-port" event and
    // forwards the list to us via serialBridge, and we render our own
    // picker inside this same modal. Actually reading/writing data over the
    // connection lands separately — this only opens/closes it.
    const SERIAL_BAUD_RATES = [9600, 14400, 19200, 38400, 57600, 115200];
    const SERIAL_START_MARKER = String.fromCharCode(2); // STX — controllers frame each message between these
    const SERIAL_END_MARKER = String.fromCharCode(3);   // ETX
    let serialPort = null;
    let serialBaudRate = null;
    let serialReader = null;
    let serialReadableClosed = null; // promise from readable.pipeTo() — must resolve before port.close(), or the OS handle stays locked
    let serialBuffer = ""; // holds bytes received so far until a full ETX-terminated message shows up

    if (window.serialBridge) {
        window.serialBridge.onPortList((ports) => {
            renderSerialPortPicker(ports);
        });
    }

    function openSerialModal() {
        renderSerialModal();
        document.getElementById("serialModalOverlay").classList.remove("hidden");
    }

    function closeSerialModal() {
        const pickerEl = document.getElementById("serialPortPicker");

        // If a port request is still pending (picker visible), cancel it —
        // otherwise it's left hanging since requestPort() never resolves
        // on its own.
        if (!pickerEl.classList.contains("hidden") && window.serialBridge) {
            window.serialBridge.choosePort("");
        }

        document.getElementById("serialModalOverlay").classList.add("hidden");
        pickerEl.classList.add("hidden");
    }

    function closeSerialModalOnBackdrop(event) {
        if (event.target.id === "serialModalOverlay") closeSerialModal();
    }

    function renderSerialModal() {
        const baudSelect = document.getElementById("serialBaudRate");
        if (!baudSelect.dataset.filled) {
            baudSelect.innerHTML = SERIAL_BAUD_RATES
                .map(rate => `<option value="${rate}" ${rate === 9600 ? "selected" : ""}>${rate}</option>`)
                .join("");
            baudSelect.dataset.filled = "true";
        }

        const connected = !!serialPort;
        const statusEl = document.getElementById("serialStatus");
        statusEl.textContent = connected ? `Connected @ ${serialBaudRate} baud` : "Not connected";
        statusEl.classList.toggle("connected", connected);

        document.getElementById("serialConnectBtn").classList.toggle("hidden", connected);
        document.getElementById("serialDisconnectBtn").classList.toggle("hidden", !connected);
        baudSelect.disabled = connected;

        // Color the topbar SERIAL button itself so the connection is visible
        // at a glance without having to open the modal.
        document.getElementById("serialToggleBtn")?.classList.toggle("active", connected);
    }

    // Renders the port list pushed by main.cjs in response to
    // navigator.serial.requestPort() — the user picks one here, which
    // resolves the pending Electron selection via serialBridge.choosePort().
    function renderSerialPortPicker(ports) {
        const pickerEl = document.getElementById("serialPortPicker");
        if (!pickerEl) return;

        const emptyNotice = ports.length
            ? ""
            : `<div class="serial-port-empty">No serial ports found. Plug in the device and try again.</div>`;

        const portButtons = ports.map((p, i) =>
            `<button class="serial-port-btn" data-port-id="${p.portId}">${p.displayName || `Port ${i + 1}`}</button>`
        ).join("");

        // Always offer a way out — without this, an empty port list (or
        // simply changing your mind) leaves the pending Electron selection
        // hanging forever, since requestPort() never resolves on its own.
        pickerEl.innerHTML = `${emptyNotice}${portButtons}<button class="serial-port-btn cancel" data-port-id="">Cancel</button>`;

        pickerEl.querySelectorAll(".serial-port-btn").forEach(btn => {
            btn.onclick = () => {
                window.serialBridge.choosePort(btn.dataset.portId);
                pickerEl.classList.add("hidden");
            };
        });
        pickerEl.classList.remove("hidden");
    }

    async function connectSerial() {
        if (!navigator.serial) {
            showToast("Web Serial API not available in this window");
            return;
        }
        if (!window.serialBridge) {
            showToast("Serial bridge not available");
            return;
        }

        const baudRate = parseInt(document.getElementById("serialBaudRate").value) || 9600;

        try {
            const port = await navigator.serial.requestPort();
            await port.open({ baudRate });

            serialPort = port;
            serialBaudRate = baudRate;

            showToast(`Serial port connected at ${baudRate} baud`);
            logEvent("serial_connected", { baudRate });
            clearSerialLog();
            appendSerialLog(`Connected at ${baudRate} baud — waiting for data...`);
            renderSerialModal();

            startSerialReadLoop();
        } catch (err) {
            console.error("Serial connection error:", err);
            showToast(`Serial connection failed: ${err.message}`);
        }
    }

    async function disconnectSerial() {
        if (!serialPort) return;

        try {
            if (serialReader) {
                await serialReader.cancel();
                serialReader.releaseLock();
                serialReader = null;
            }

            // port.close() throws (or leaves the OS handle locked, blocking
            // any future reconnect until the app restarts) unless the pipe
            // from readable → decoder has actually finished unwinding first.
            if (serialReadableClosed) {
                await serialReadableClosed.catch(() => {});
                serialReadableClosed = null;
            }

            await serialPort.close();
        } catch (err) {
            console.error("Serial disconnect error:", err);
        }

        serialPort = null;
        serialBaudRate = null;

        showToast("Serial port disconnected");
        logEvent("serial_disconnected", {});
        appendSerialLog("Disconnected.");
        renderSerialModal();
    }

    // Reads raw text off the port as it arrives. The controller sends bytes
    // in whatever chunks the OS/driver feels like (often one character at a
    // time), so a single "message" only exists once a full STX...ETX frame
    // has arrived — we accumulate into serialBuffer and only log/emit once
    // an ETX shows up, same framing the controller itself uses. Purely
    // diagnostic for now (confirming presses reach us), before any real
    // handling logic gets built on top of it.
    async function startSerialReadLoop() {
        const decoder = new TextDecoderStream();
        serialReadableClosed = serialPort.readable.pipeTo(decoder.writable).catch(() => {});
        serialReader = decoder.readable.getReader();
        serialBuffer = "";

        try {
            while (true) {
                const { value, done } = await serialReader.read();
                if (done) break;
                if (!value) continue;

                serialBuffer += value;
                const messages = serialBuffer.split(SERIAL_END_MARKER);
                serialBuffer = messages.pop(); // last piece is incomplete (no ETX yet) — keep buffering it

                for (const raw of messages) {
                    const message = raw.split(SERIAL_START_MARKER).join("").trim();
                    if (!message) continue;
                    appendSerialLog(message);
                    handleSerialMessage(message);
                }
            }
        } catch (err) {
            console.error("Serial read error:", err);
            appendSerialLog(`[error] ${err.message}`, true);
        }
    }

    // Dispatches a parsed controller message. Only "ScoreAction" is handled
    // for now; anything else (battery pings, handshakes, unknown frames)
    // is left alone — it's already visible in the log box for inspection.
    function handleSerialMessage(message) {
        let data;
        try {
            data = JSON.parse(message);
        } catch (err) {
            return; // not JSON — not something we act on
        }

        if (data.identifier === "ScoreAction") {
            applyControllerScoreAction(data);
        }
    }

    // Applies a controller button press exactly like a tablet press would:
    // compute the referee's new score locally, then POST the same
    // "update_score" action tablet.html itself sends. The existing
    // broadcastAdmin → /stream/admin → updateRefereeScore() pipeline then
    // takes it from there (DOM, PT pattern-slot redirect, Level 0
    // enforcement server-side, session log) — no separate code path needed.
    async function applyControllerScoreAction(data) {
        const refereeId = parseInt(data.referee);
        const color = String(data.scorer || "").toLowerCase();

        // The controller's own "scoreValue" is a generic press signal (e.g.
        // always 1), not the actual point value — the real per-press amount
        // depends on the specialty (SP: +1, PT: -0.2), same as the tablet's
        // default button. Ignore the message's magnitude and use that.
        const delta = refereeDefaultButton;

        if (!refereeId || (color !== "red" && color !== "blue") || isNaN(delta)) {
            console.warn("Ignoring malformed ScoreAction:", data);
            return;
        }

        const ref = refereeState[refereeId];
        if (!ref) {
            console.warn(`ScoreAction for unknown referee ${refereeId}`);
            return;
        }

        // The controller has no login/auth step like a tablet does — the
        // first score it sends for a referee is the only "connected" signal
        // we get, so mark it here (colors the boxes, syncs PT's rows, etc.).
        if (!ref.connected) {
            markRefereeConnected(refereeId);
        }

        const newScore = { red: ref.score.red, blue: ref.score.blue };
        newScore[color] = Math.max(0, parseFloat(((parseFloat(newScore[color]) || 0) + delta).toFixed(1)));

        try {
            const res = await fetch(`${apiBase()}/api/score/referee/${refereeId}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "update_score",
                    score: { red: String(newScore.red), blue: String(newScore.blue) }
                })
            });

            if (res.status === 409) {
                // Server-side "not in PLAY" gate — expected/common (e.g. the
                // controller was pressed before START), not a real error.
                appendSerialLog(`Ignored — match is not in PLAY state (referee ${refereeId})`);
                return;
            }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
        } catch (err) {
            console.error("Failed to apply controller score action:", err);
            appendSerialLog(`[error] Failed to apply score for referee ${refereeId}: ${err.message}`, true);
        }
    }

    function appendSerialLog(text, isError = false) {
        console.log(isError ? "[serial:error]" : "[serial:data]", text);

        const logEl = document.getElementById("serialLog");
        if (!logEl) return;

        const time = new Date().toLocaleTimeString();
        const line = document.createElement("div");
        line.className = isError ? "serial-log-line error" : "serial-log-line";
        line.textContent = `[${time}] ${text}`;
        logEl.appendChild(line);

        // Cap history so the box doesn't grow unbounded during a long session.
        while (logEl.children.length > 100) {
            logEl.removeChild(logEl.firstChild);
        }

        logEl.scrollTop = logEl.scrollHeight;
    }

    function clearSerialLog() {
        const logEl = document.getElementById("serialLog");
        if (logEl) logEl.innerHTML = "";
    }

    // ── TOAST ──
    function showToast(msg) {
        const toast = document.getElementById("toast");
        toast.textContent = msg;
        toast.classList.add("show");
        setTimeout(() => toast.classList.remove("show"), 2200);
    }

    // ── CONFIGURE / BOOTSTRAP ──
    // Host pages call this once before relying on anything else.
    // Available hooks (all optional):
    //   refereeStartScore           — number; fallback starting score for each
    //                                 referee, used only if the server's login
    //                                 response doesn't include
    //                                 "refereeStartScore" (preferred source —
    //                                 see /api/login/admin)
    //   onInitComplete()            — called after login+SSE setup succeeds
    //   onMatchApplied(match)       — called at the end of applyMatch(), for
    //                                 specialty-specific resets (timer/round
    //                                 for SP, form-score reset for PT)
    //   pushDisplayUpdate()         — called wherever the shared code used to
    //                                 call pushDisplayUpdate directly; host
    //                                 page builds its own payload (using
    //                                 buildBaseDisplayPayload() as a base)
    //   onRefereeScoreChanged()     — called after any referee score change;
    //                                 host page should call its own
    //                                 recalculateMainScore()/notify variant
    //   onRefereeConnected(refId)   — called right after a referee is marked
    //                                 connected (e.g. to sync extra UI rows
    //                                 a host page injected on its own)
    //   onRefereeScoreUpdated(refId, score) — called whenever a referee's
    //                                 score arrives via SSE from the tablet;
    //                                 use this to redirect/mirror the value
    //                                 into custom UI a host page manages
    //   extraLogContext()           — returns extra fields merged into the
    //                                 "referee_score" log event (e.g. SP adds
    //                                 round/remaining time)
    function configure(newHooks) {
        hooks = newHooks || {};
    }

    window.SharedAdmin = {
        configure,
        init,
        apiBase,

        // state accessors
        getLocalIp: () => localIp,
        getSetupRingId: () => setupRingId,
        getSetupSpecialty: () => setupSpecialty,
        getCurrentMatches: () => currentMatches,
        getCurrentMatchIndex: () => currentMatchIndex,
        getRefereeCount: () => refereeCount,
        getRefereeState: () => refereeState,
        getCurrentCountryRed: () => currentCountryRed,
        getCurrentCountryBlue: () => currentCountryBlue,

        // error/info modals
        showErrorModal, closeErrorModal, closeErrorModalOnBackdrop,
        showInfoModal, closeInfoModal, closeInfoModalOnBackdrop,

        // keypad
        openKeypad, closeKeypad, closeKeypadOnBackdrop,
        keypadPress, keypadBackspace, keypadClear, keypadToggleSign,
        keypadOnInput, keypadOnKeydown, confirmKeypad,

        // category / match
        openCategoryModal, closeCategoryModal, closeCategoryModalOnBackdrop,
        refreshCategoryList, loadCategory, loadMatches, applyMatch,
        resetCategoryForNextLoad, goToPrevMatch, goToNextMatch,
        updateMatchNavButtons, updateMatchStatusBadge, updateNextMatchPreview,
        notifyMatchDetails, setFlag,

        // name / category edit
        editParticipantName, editCategoryName, notifyCategoryOnly,
        openNameEditModal, confirmNameEdit, closeNameEditModal,
        closeNameEditModalOnBackdrop, nameEditOnKeydown,

        // flag picker
        openFlagPicker, selectFlag, closeFlagPicker, closeFlagPickerOnBackdrop,

        // serial port
        openSerialModal, closeSerialModal, closeSerialModalOnBackdrop,
        connectSerial, disconnectSerial,

        // display window
        toggleDisplayWindow, buildBaseDisplayPayload,

        // logging
        logEvent, downloadSessionLog,

        // referees
        initReferees, renderReferees, copyToClipboard,
        authReferee, openAuthModal, closeAuthModal, closeAuthModalOnBackdrop, copyAuthUrl,
        markRefereeConnected, updateRefereeScore, editRefereeScore,
        toggleRefereeEnabled, resetRefereeScore, subtractPointFromAllReferees,
        notifyRefereeScore, recalculateMainScore, clearRefereeStaleWarnings,

        // misc
        showToast
    };

})();
