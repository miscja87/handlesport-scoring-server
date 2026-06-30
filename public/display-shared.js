// ══════════════════════════════════════════════════════════════
// DISPLAY SHARED LOGIC
// Shared between display-sp.html (Sparring) and display-pt.html (Pattern).
//
// Exposes everything on window.SharedDisplay. Each host page must call
// SharedDisplay.configure({...}) once at startup with its hooks — see
// the "configure" doc below — then call SharedDisplay.init() to start
// listening for IPC updates from admin.
//
// Contains: flag handling, generic top-row/name-row/next-match field
// updates, winner announcement overlay, and referee box rendering
// (parametrized by referee count, so SP's 4 and PT's 5 both work).
//
// Does NOT contain: anything specific to the SP timer/round layout
// (countdown ring, round indicator, W/-P, main score) — those stay in
// display-sp.html. PT currently mirrors that layout too for now, kept
// in display-pt.html's own script, until it diverges for real.
// ══════════════════════════════════════════════════════════════

(function () {

    let hooks = {};
    let refereeCount = 4;

    // ── FLAGS ──
    // Sets a flag <img> src from a country name (e.g. "ITALY" -> /images/flags/ITALY.png).
    function setFlagSrc(imgId, countryName) {
        const img = document.getElementById(imgId);
        if (!img) return;

        if (!countryName) {
            // No country set yet — keep the default flag visible instead of hiding it.
            return;
        }

        img.style.visibility = "visible";
        img.src = `/images/flags/${countryName.toUpperCase()}.png`;
        img.onerror = () => { img.style.visibility = "hidden"; };
    }

    // ── TIME FORMATTING ──
    // Shared by any host page that shows a countdown — under 60s shows just
    // seconds (no leading zero/colon), otherwise MM:SS.
    function formatTime(seconds) {
        if (seconds < 60) {
            return String(seconds);
        }
        const m = Math.floor(seconds / 60).toString().padStart(2, "0");
        const s = (seconds % 60).toString().padStart(2, "0");
        return `${m}:${s}`;
    }

    // ── REFEREE BOXES ──
    // Builds the referee-boxes grid markup for the given referee count
    // (2 boxes per referee: blue, red) and sets the grid-template-columns
    // accordingly. Call once at startup after the DOM is ready.
    function buildRefereeBoxes(count) {
        refereeCount = count;

        const grid = document.getElementById("refereeBoxes");
        const labels = document.getElementById("refereeLabels");
        if (!grid) return;

        grid.style.gridTemplateColumns = `repeat(${count * 2}, 1fr)`;
        grid.innerHTML = "";
        for (let i = 1; i <= count; i++) {
            grid.insertAdjacentHTML("beforeend", `
                <div class="referee-box" id="ref${i}blue"></div>
                <div class="referee-box" id="ref${i}red"></div>
            `);
        }

        if (labels) {
            labels.style.gridTemplateColumns = `repeat(${count}, 1fr)`;
            labels.innerHTML = "";
            for (let i = 1; i <= count; i++) {
                labels.insertAdjacentHTML("beforeend", `<span>REF. ${i}</span>`);
            }
        }

        if (hooks.onRefereeBoxesBuilt) hooks.onRefereeBoxesBuilt(count);
    }

    // Applies the `referees` array from the IPC payload to the boxes built
    // by buildRefereeBoxes. Each entry: { score: {red, blue}, active }.
    // Colors the box of whichever side is ahead for that referee, with
    // intensity scaling by margin (0 -> base color, >=8 -> max intensity).
    function applyRefereeBoxes(referees) {
        referees.forEach((ref, idx) => {
            const i = idx + 1;
            const redBox = document.getElementById(`ref${i}red`);
            const blueBox = document.getElementById(`ref${i}blue`);
            const isActive = !!ref?.active;

            const redScore = parseFloat(ref?.score?.red) || 0;
            const blueScore = parseFloat(ref?.score?.blue) || 0;
            const margin = Math.abs(redScore - blueScore);

            // Linear scale: margin 0 -> intensity 1 (base color), margin >= 8 -> intensity 1.6 (max)
            const intensity = 1 + Math.min(margin, 8) / 8 * 0.6;

            if (redBox) {
                redBox.textContent = redScore;
                redBox.classList.toggle("red-active", isActive);
                redBox.style.setProperty("--intensity", (isActive && redScore > blueScore) ? intensity : 1);
            }
            if (blueBox) {
                blueBox.textContent = blueScore;
                blueBox.classList.toggle("blue-active", isActive);
                blueBox.style.setProperty("--intensity", (isActive && blueScore > redScore) ? intensity : 1);
            }
        });
    }

    // ── WINNER ANNOUNCEMENT (identical for SP/PT) ──
    let winnerTimeout1 = null;
    let winnerTimeout2 = null;

    function showWinnerAnnouncement(color, name, scoreRed, scoreBlue) {
        const overlay = document.getElementById("winnerOverlay");
        const nameLineEl = document.getElementById("winnerNameLine");
        const scoreEl = document.getElementById("winnerScore");

        clearTimeout(winnerTimeout1);
        clearTimeout(winnerTimeout2);

        nameLineEl.textContent = name || color.toUpperCase();

        if (scoreRed !== undefined && scoreBlue !== undefined) {
            scoreEl.textContent = `${scoreBlue} — ${scoreRed}`;
        } else {
            scoreEl.textContent = "";
        }

        overlay.classList.remove("red-bg", "blue-bg", "fade-out");
        overlay.classList.add(color === "red" ? "red-bg" : "blue-bg");

        // Force reflow so the animation restarts cleanly if triggered again quickly
        void overlay.offsetWidth;
        overlay.classList.add("show");

        winnerTimeout1 = setTimeout(() => {
            overlay.classList.add("fade-out");
        }, 4200);

        winnerTimeout2 = setTimeout(() => {
            overlay.classList.remove("show", "fade-out");
        }, 5000);
    }

    // ── GENERIC FIELD UPDATES (top row, name row, next match) ──
    // Applies the fields that are identical across SP/PT. Host pages call
    // this first in their own applyState(), then handle their own
    // specialty-specific fields (timer/round for SP, pattern name for PT).
    function applyCommonFields(payload) {
        document.getElementById("connecting")?.classList.add("hidden");

        if (payload.announceWinner) {
            showWinnerAnnouncement(
                payload.announceWinner.color,
                payload.announceWinner.name,
                payload.announceWinner.scoreRed,
                payload.announceWinner.scoreBlue
            );
        }

        if (payload.ring !== undefined) document.getElementById("ringNumber").textContent = payload.ring;
        if (payload.category !== undefined) document.getElementById("categoryLabel").textContent = payload.category;
        if (payload.matchNumber !== undefined) document.getElementById("matchNumber").textContent = payload.matchNumber;

        if (payload.nameRed !== undefined) document.getElementById("nameRed").textContent = payload.nameRed;
        if (payload.nameBlue !== undefined) document.getElementById("nameBlue").textContent = payload.nameBlue;
        if (payload.countryRed !== undefined) setFlagSrc("flagRed", payload.countryRed);
        if (payload.countryBlue !== undefined) setFlagSrc("flagBlue", payload.countryBlue);

        if (payload.referees) {
            applyRefereeBoxes(payload.referees);
        }

        if (payload.nextMatches && payload.nextMatches[0]) {
            const m = payload.nextMatches[0];
            const redEl = document.getElementById("next1Red");
            const blueEl = document.getElementById("next1Blue");
            if (redEl) redEl.textContent = m.red || "RED";
            if (blueEl) blueEl.textContent = m.blue || "BLUE";
        }
    }

    // ── BOOTSTRAP ──
    // Host pages call this once at startup. hooks.refereeCount sets up the
    // boxes immediately; hooks.applyState(payload) is the host's own
    // complete handler (it should call SharedDisplay.applyCommonFields(payload)
    // itself, then handle its own specialty-specific fields).
    function init() {
        if (hooks.refereeCount) {
            buildRefereeBoxes(hooks.refereeCount);
        }

        if (window.displayBridge) {
            window.displayBridge.onUpdate((payload) => {
                if (hooks.applyState) hooks.applyState(payload);
            });
        } else {
            const connecting = document.getElementById("connecting");
            if (connecting) connecting.textContent = "displayBridge not available — check preload script.";
        }
    }

    function configure(newHooks) {
        hooks = newHooks || {};
    }

    window.SharedDisplay = {
        configure,
        init,
        setFlagSrc,
        formatTime,
        buildRefereeBoxes,
        applyRefereeBoxes,
        showWinnerAnnouncement,
        applyCommonFields
    };

})();
