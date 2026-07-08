<?php
/**
 * GLOBAL-mode referee tablet — reference implementation to copy onto the
 * handlesport.com PHP server. The controller that serves this page is
 * expected to have already validated the "evt/ring/sp/ref/tkn" query
 * params (from the /scoring/auth link) and to inject the variables below
 * before including this file:
 *
 *   $referee       (int)    e.g. 1
 *   $eventId       (string) e.g. "6"
 *   $ringId        (string) e.g. "1"
 *   $buttons       (array)  e.g. [3, 2, 1]
 *   $defaultButton (number) e.g. 1
 *   $startScore    (number) e.g. 10
 *
 * Unlike the local tablet.html (which fetches this configuration from our
 * own Express server via /api/login/referee), here it's injected server-side
 * by PHP — this page never talks to the local server at all, only to
 * Firebase/Firestore (via js/scoring/common.firestore.js), since it can't
 * assume it's on the same network as the admin's machine.
 */
$referee       = $referee       ?? 1;
$event         = $event       ?? "";
$ringId        = $ringId        ?? "";
$buttons       = $buttons       ?? [3, 2, 1];
$defaultButton = $defaultButton ?? 1;
$startScore    = $startScore    ?? 0;
?>
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no, viewport-fit=cover">
    <title>Referee Scoring</title>
    <link rel="icon" href="/favicon.ico">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }

        body {
            background: #1a1f2e;
            font-family: 'Arial', sans-serif;
            height: 100svh; /* smallest viewport height — avoids the last row
                                getting overlapped when the browser toolbar or
                                a system gesture bar reclaims space, which
                                100dvh doesn't reliably account for in
                                landscape on some Android browsers */
            display: flex;
            flex-direction: column;
            overflow: hidden;
            user-select: none;
        }

        .header {
            display: grid;
            grid-template-columns: 1fr auto 1fr;
            align-items: center;
            gap: 8px;
            padding: 6px 8px 0;
            flex-shrink: 0;
        }

        .score-bar {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
            padding: 10px 16px;
            border-radius: 6px;
            font-size: clamp(20px, 5vw, 32px);
            font-weight: 900;
            color: white;
            letter-spacing: 1px;
            cursor: pointer;
            transition: filter 0.1s;
        }
        .score-bar:active { filter: brightness(1.2); }
        .score-bar.red  { background: #cc0000; }
        .score-bar.blue { background: #1a6fa8; }

        .undo-icon {
            font-size: clamp(14px, 3vw, 20px);
            opacity: 0.75;
            line-height: 1;
            pointer-events: none;
        }

        .header-info {
            text-align: center;
            color: #a0aab8;
            font-size: clamp(10px, 2vw, 13px);
            line-height: 1.5;
        }
        .header-info .state { font-weight: 700; font-size: clamp(11px, 2.2vw, 14px); }
        .header-info .state.stop    { color: #e53e3e; }
        .header-info .state.play { color: #38a169; }

        .score-grid {
            flex: 1;
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 3px;
            padding: 3px 0;
            min-height: 0;
        }
        .score-grid.mode-3 { grid-template-rows: repeat(3, 1fr); }
        .score-grid.mode-1 { grid-template-rows: 1fr; }

        .score-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: clamp(28px, 7vw, 52px);
            font-weight: 300;
            color: rgba(255,255,255,0.9);
            border: none;
            cursor: pointer;
            transition: filter 0.1s, transform 0.1s;
            outline: none;
        }
        .score-btn.red  { background: #cc0000; }
        .score-btn.blue { background: #1a6fa8; }
        .score-btn:active { filter: brightness(1.2); transform: scale(0.98); }

        .score-grid.mode-1 .btn-3,
        .score-grid.mode-1 .btn-2 { display: none; }

        .score-grid.disabled .score-btn {
            opacity: 0.4;
            pointer-events: none;
        }

        .footer {
            display: grid;
            grid-template-columns: auto 1fr;
            gap: 3px;
            padding: 3px 0 0 0;
            padding-bottom: env(safe-area-inset-bottom, 0px);
            flex-shrink: 0;
        }
        .footer-btn {
            background: #2a7a2a;
            border: none;
            color: white;
            padding: 14px 8px;
            font-size: clamp(14px, 3vw, 20px);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: filter 0.1s;
            outline: none;
        }
        .footer-btn:active { filter: brightness(1.3); }
        .footer-btn.label {
            font-size: clamp(12px, 2.5vw, 16px);
            font-weight: 700;
            letter-spacing: 1px;
        }
        .footer-btn.menu-trigger {
            flex: 0 0 60px;
            width: 60px;
            background: #2a3550;
        }

        /* ── MENU ── */
        .menu-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.5);
            z-index: 90;
            display: flex;
            align-items: flex-end;
            justify-content: center;
        }
        .menu-sheet {
            background: #1f2638;
            width: 100%;
            border-radius: 16px 16px 0 0;
            padding: 8px;
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .menu-item {
            display: flex;
            align-items: center;
            gap: 14px;
            background: #2a3550;
            border: none;
            color: white;
            padding: 16px 20px;
            border-radius: 10px;
            font-size: 16px;
            cursor: pointer;
            text-align: left;
        }
        .menu-item:active { filter: brightness(1.2); }
        .menu-item .icon { font-size: 20px; width: 24px; text-align: center; }
        .menu-cancel {
            margin-top: 4px;
            background: #3a4560;
            color: #a0aab8;
            font-weight: 700;
            justify-content: center;
        }

        .loading {
            position: fixed;
            inset: 0;
            background: #1a1f2e;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #a0aab8;
            font-size: 16px;
            z-index: 100;
        }

        .toast {
            position: fixed;
            bottom: 80px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0,0,0,0.8);
            color: white;
            padding: 10px 20px;
            border-radius: 20px;
            font-size: 14px;
            opacity: 0;
            transition: opacity 0.3s;
            pointer-events: none;
            z-index: 99;
        }
        .toast.show { opacity: 1; }
        .hidden { display: none !important; }
    </style>
</head>
<body>

    <!-- common.firestore.js reads event/ring straight out of these two
         fields via jQuery ($('#id_event').val()) — the IDs must match
         exactly, they're not something this page gets to choose. -->
    <input type="hidden" id="id_event" value="<?php echo (int)$event; ?>">
    <input type="hidden" id="id_ring" value="<?php echo (int)$ring; ?>">

    <!-- Config this page itself needs — read directly by the script below. -->
    <input type="hidden" id="cfgReferee" value="<?php echo (int)$referee; ?>">
    <input type="hidden" id="cfgButtons" value="<?php echo htmlspecialchars(json_encode($buttons)); ?>">
    <input type="hidden" id="cfgDefaultButton" value="<?php echo htmlspecialchars($defaultButton); ?>">
    <input type="hidden" id="cfgStartScore" value="<?php echo htmlspecialchars($startScore); ?>">

    <div class="loading" id="loading">Connecting...</div>

    <div class="header hidden" id="mainHeader">
        <!-- slot-left and slot-right always hold the correct color bar -->
        <div class="score-bar red" id="slotLeft">
            <span id="scoreLeft">0</span>
            <span class="undo-icon">↺</span>
        </div>
        <div class="header-info">
            <div id="headerLabel">Ring <?php echo htmlspecialchars($ringId); ?>, Referee <?php echo (int)$referee; ?></div>
            <div class="state stop" id="stateLabel">STOP</div>
        </div>
        <div class="score-bar blue" id="slotRight">
            <span id="scoreRight">0</span>
            <span class="undo-icon">↺</span>
        </div>
    </div>

    <div class="score-grid mode-3 hidden disabled" id="scoreGrid">
        <!-- buttones generated by renderButtons() -->
    </div>

    <div class="footer hidden" id="footer">
        <button class="footer-btn menu-trigger" onclick="openMenu()" title="Menu">☰</button>
        <button class="footer-btn label" id="modeBtn" onclick="toggleMode()">1 B</button>
    </div>

    <div class="menu-overlay hidden" id="menuOverlay" onclick="closeMenuOnBackdrop(event)">
        <div class="menu-sheet">
            <button class="menu-item" onclick="reload(); closeMenu();">
                <span class="icon">↺</span> Reload scores
            </button>
            <button class="menu-item" onclick="swapColors(); closeMenu();">
                <span class="icon">⇄</span> Switch colors
            </button>
            <button class="menu-item" onclick="toggleFullscreen(); closeMenu();">
                <span class="icon">⛶</span> Fullscreen
            </button>
            <button class="menu-item menu-cancel" onclick="closeMenu()">Cancel</button>
        </div>
    </div>

    <div class="toast" id="toast"></div>

    <!-- common.firestore.js expects jQuery to already be available (it reads
         #id_event/#id_ring via $(...) at module-eval time) — remove this if
         the surrounding page layout already loads jQuery globally, otherwise
         keep it, and it MUST come before the module script below. -->
    <script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>

<script type="module">
    import {
        db, doc, onSnapshot, statusRef,
        loginAsReferee, updateRefereeDoc, incrementRefereeScore, loadRefereeDoc, getRefereeDoc
    } from "<?php echo URL_PATH . 'js/scoring/common.firestore.js'; ?>";

    // ── CONFIG (injected by PHP via hidden inputs) ──
    const referee = parseInt(document.getElementById("cfgReferee").value);
    const ringId = document.getElementById("id_ring").value;

    /* Score params */
    const ACTION_UPDATE_SCORE = "update_score";

    // "left" and "right" are the two visual sides — independent from red/blue
    // leftColor = color currently on the left side ("red" or "blue")
    let leftColor = "red";
    let scores = { red: 0, blue: 0 };
    let history = { red: [], blue: [] }; // deltas applied, so undo can send their inverse
    let mode = 3;
    let state = "stop";
    let buttons = JSON.parse(document.getElementById("cfgButtons").value || "[3,2,1]");
    let defaultButton = parseFloat(document.getElementById("cfgDefaultButton").value) || buttons[buttons.length - 1];
    const startScore = parseFloat(document.getElementById("cfgStartScore").value) || 0;

    // ── INIT ──
    async function init() {
        try {
            // loginAsReferee() also sets this referee's Firestore doc status
            // to CONFIG.STATUS_OK, which is what the admin's server listens
            // for to close its QR modal and mark the referee connected.
            console.log(`Logging in as referee ${referee}...`);
            await loginAsReferee(referee);

            // Load whatever score is already on the doc (referee reconnecting
            // mid-match) — fall back to the specialty's start score if none.
            // The doc itself is expected to already exist at this point (the
            // admin's server creates it before handing out this link).
            const existing = await loadRefereeDoc(referee);
            scores.red = parseFloat(existing?.score?.red ?? startScore) || 0;
            scores.blue = parseFloat(existing?.score?.blue ?? startScore) || 0;

            document.getElementById("headerLabel").textContent = `Ring ${ringId}, Referee ${referee}`;

            renderButtons(buttons);
            bindButtons();
            updateDisplay();

            document.getElementById("loading").classList.add("hidden");
            document.getElementById("mainHeader").classList.remove("hidden");
            document.getElementById("scoreGrid").classList.remove("hidden");
            document.getElementById("footer").classList.remove("hidden");

            // Update mode-N based on buttons number
            const grid = document.getElementById("scoreGrid");
            grid.classList.remove("mode-1", "mode-3");
            grid.classList.add(buttons.length === 1 ? "mode-1" : "mode-3");

            // Match PLAY/STOP — mirrors the local tablet's /stream/clients
            // ACTION_UPDATE_STATE listener, sourced from the same status doc
            // match.js already writes to on every round start/stop.
            onSnapshot(statusRef, (statusSnap) => {
                if (!statusSnap.exists()) return;
                applyState(statusSnap.data().state);
            });

            // External corrections (RESET from admin, LEVEL 0 override, etc.)
            // — mirrors the local tablet's ACTION_RESET_SCORE handling. Skips
            // updates that just echo back the optimistic value we already
            // applied locally for our own last add/undo.
            const refDocRef = doc(db, "score", getRefereeDoc(referee));
            onSnapshot(refDocRef, (refSnap) => {
                if (!refSnap.exists()) return;
                const data = refSnap.data();
                if (!data.score) return;

                const red = parseFloat(data.score.red) || 0;
                const blue = parseFloat(data.score.blue) || 0;
                const isOwnEcho = red === scores.red && blue === scores.blue;
                if (isOwnEcho) return;

                scores.red = red;
                scores.blue = blue;
                history.red = [];
                history.blue = [];
                updateDisplay();
                showToast("Score updated from server");
            });

        } catch (err) {
            console.error(err);
            document.getElementById("loading").textContent = `Error: ${err.message}`;
        }
    }

    // ── RENDER BUTTONS ──
    function renderButtons(btns) {
        const grid = document.getElementById("scoreGrid");
        grid.innerHTML = "";

        btns.forEach((val, i) => {
            const label = val > 0 ? `+ ${val}` : `${val}`;
            const idx = i + 1;

            const btnL = document.createElement("button");
            btnL.className = `score-btn red btn-${idx}`;
            btnL.id = `btnL${idx}`;
            btnL.textContent = label;
            grid.appendChild(btnL);

            const btnR = document.createElement("button");
            btnR.className = `score-btn blue btn-${idx}`;
            btnR.id = `btnR${idx}`;
            btnR.textContent = label;
            grid.appendChild(btnR);
        });

        // Update CSS grid rows based on buttons number
        grid.style.gridTemplateRows = `repeat(${btns.length}, 1fr)`;
    }

    // ── BIND BUTTONS ──
    function bindButtons() {
        const rightColor = leftColor === "red" ? "blue" : "red";

        document.getElementById("slotLeft").onclick  = () => undoScore(leftColor);
        document.getElementById("slotRight").onclick = () => undoScore(rightColor);

        buttons.forEach((val, i) => {
            const idx = i + 1;
            document.getElementById(`btnL${idx}`).onclick = () => addScore(leftColor,  val);
            document.getElementById(`btnR${idx}`).onclick = () => addScore(rightColor, val);
        });
    }

    // ── UPDATE DISPLAY ──
    function updateDisplay() {
        const rightColor = leftColor === "red" ? "blue" : "red";

        document.getElementById("scoreLeft").textContent  = scores[leftColor];
        document.getElementById("scoreRight").textContent = scores[rightColor];

        const slotLeft  = document.getElementById("slotLeft");
        const slotRight = document.getElementById("slotRight");
        slotLeft.className  = `score-bar ${leftColor}`;
        slotRight.className = `score-bar ${rightColor}`;

        buttons.forEach((val, i) => {
            const idx = i + 1;
            document.getElementById(`btnL${idx}`).className = `score-btn ${leftColor} btn-${idx}`;
            document.getElementById(`btnR${idx}`).className = `score-btn ${rightColor} btn-${idx}`;
        });
    }

    function applyState(newState) {
        state = newState;
        const stateLabel = document.getElementById("stateLabel");
        const scoreGrid  = document.getElementById("scoreGrid");
        if (state === "play") {
            stateLabel.textContent = "PLAY";
            stateLabel.className = "state play";
            scoreGrid.classList.remove("disabled");
        } else {
            stateLabel.textContent = "STOP";
            stateLabel.className = "state stop";
            scoreGrid.classList.add("disabled");
        }
    }
    function swapColors() {
        leftColor = leftColor === "red" ? "blue" : "red";
        bindButtons();
        updateDisplay();
    }

    // ── SCORE ──
    // Uses incrementRefereeScore (a Firestore transaction that adds the
    // delta to whatever's currently stored) instead of writing an absolute
    // value — safer against races with external corrections. Note: if an
    // external reset/zero happens between an add and its undo, the undo's
    // negative delta isn't clamped by the transaction and could in theory
    // push the stored score below 0 — a pre-existing property of
    // incrementRefereeScore, not something this page can fix on its own.
    // Sends the CLAMPED delta (what actually changed locally after the 0
    // floor), never the raw button/undo value — otherwise a press that gets
    // floored client-side (e.g. score 5, button -10) would still send the
    // full -10 to incrementRefereeScore's transaction, which doesn't clamp,
    // leaving Firestore at -5 while the tablet shows 0 until the next
    // onSnapshot "corrects" it back to the negative value.
    async function addScore(color, points) {
        if (state === "stop") {
            showToast("Scoring blocked — state STOP");
            return;
        }
        const before = scores[color];
        const after = Math.max(0, parseFloat((before + points).toFixed(1)));
        const actualDelta = parseFloat((after - before).toFixed(1));
        history[color].push(actualDelta); // store what was actually applied, so undo reverses that, not the raw button value
        scores[color] = after;
        updateDisplay();
        await sendDelta(color, actualDelta);
    }

    async function undoScore(color) {
        if (state === "stop") {
            showToast("Scoring blocked — state STOP");
            return;
        }
        if (history[color].length === 0) {
            showToast("No actions to undo");
            return;
        }
        const lastDelta = history[color].pop();
        const before = scores[color];
        const after = Math.max(0, parseFloat((before - lastDelta).toFixed(1)));
        const actualDelta = parseFloat((after - before).toFixed(1));
        scores[color] = after;
        updateDisplay();
        await sendDelta(color, actualDelta);
    }

    async function sendDelta(color, delta) {
        try {
            // Not supported on iOS Safari (navigator.vibrate is undefined
            // there) — calling it unconditionally throws and skips the
            // write below entirely, which is why scores failed to send.
            if (navigator.vibrate) navigator.vibrate(100);

            const redDelta = color === "red" ? delta : 0;
            const blueDelta = color === "blue" ? delta : 0;
            await incrementRefereeScore(referee, ACTION_UPDATE_SCORE, redDelta, blueDelta);
        } catch (err) {
            showToast("Error sending score");
        }
    }

    async function reload() {
        location.reload();
    }

    // ── MODE ──
    function toggleMode() {
        const grid = document.getElementById("scoreGrid");
        const btn  = document.getElementById("modeBtn");
        if (mode === buttons.length) {
            mode = 1;
            buttons.forEach((val, i) => {
                const idx = i + 1;
                const show = val === defaultButton;
                document.getElementById(`btnL${idx}`).style.display = show ? "" : "none";
                document.getElementById(`btnR${idx}`).style.display = show ? "" : "none";
            });
            grid.style.gridTemplateRows = "1fr";
            btn.textContent = `${buttons.length} B`;
        } else {
            mode = buttons.length;
            buttons.forEach((val, i) => {
                const idx = i + 1;
                document.getElementById(`btnL${idx}`).style.display = "";
                document.getElementById(`btnR${idx}`).style.display = "";
            });
            grid.style.gridTemplateRows = `repeat(${buttons.length}, 1fr)`;
            btn.textContent = "1 B";
        }
    }

    // ── MENU ──
    function openMenu() {
        document.getElementById("menuOverlay").classList.remove("hidden");
    }

    function closeMenu() {
        document.getElementById("menuOverlay").classList.add("hidden");
    }

    function closeMenuOnBackdrop(event) {
        if (event.target.id === "menuOverlay") closeMenu();
    }

    // ── UI HELPERS ──
    function toggleFullscreen() {
        if (!document.fullscreenElement) document.documentElement.requestFullscreen();
        else document.exitFullscreen();
    }

    function showToast(msg) {
        const toast = document.getElementById("toast");
        toast.textContent = msg;
        toast.classList.add("show");
        setTimeout(() => toast.classList.remove("show"), 2000);
    }

    // Expose the handlers referenced by inline onclick= attributes in the
    // markup above — they're plain function declarations inside this module
    // scope, so they don't leak onto window by default like a classic script does.
    window.reload = reload;
    window.swapColors = swapColors;
    window.toggleFullscreen = toggleFullscreen;
    window.toggleMode = toggleMode;
    window.openMenu = openMenu;
    window.closeMenu = closeMenu;
    window.closeMenuOnBackdrop = closeMenuOnBackdrop;

    // NOT window.addEventListener("load", init) — module scripts already
    // execute after the DOM is parsed, and this module does real async work
    // (the common.firestore.js import) before reaching this line, so by the
    // time we'd register the listener the page's "load" event may have
    // already fired — a late listener never receives a past event, which is
    // exactly why init() was silently never running.
    init();
</script>

</body>
</html>
