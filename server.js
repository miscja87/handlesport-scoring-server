import express from "express";
import cors from "cors";
import os from "os";
import path from "path";
import fs from "fs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { initScores, getScores, updateScore, deleteScore } from "./scores.js";
import { createMatch, updateMatchDetails, updateMatchState, getMatchState } from "./match.js";
import { loginAsServer, createRefereeDoc, ensureRefereeDoc, updateRefereeDoc, deleteRefereeDoc, listenToRefereeScores, auth } from "./firestore.js";
import { ACTIONS, API_KEY, HANDLESPORT_BACKEND_URL, STATUS } from "./constants.js";
import { SPECIALTY_CONFIGURATION } from "./specialty.js";
import {
    initLogger,
    appendLogEntry,
    startLogSession,
    hasActiveLogSession,
    listLogFiles,
    getLogFilePath,
    isValidLogFileName,
    logFileExists
} from "./logger.js";

// dir name
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Constants
const PORT = 8080;
const LOCAL_IP = getLocalIP();

// In a packaged Electron build, __dirname resolves inside the read-only
// app.asar archive — mkdirSync/writes there fail silently (no console
// attached to the packaged .exe), which hung the whole app on startup with
// no window and no error. main.cjs sets HANDLESPORT_LOGS_DIR to a real
// writable folder (Electron's userData dir) before importing this module;
// falls back to the old __dirname-relative path when run standalone (e.g.
// plain `node server.js`, outside Electron).
initLogger(process.env.HANDLESPORT_LOGS_DIR || path.join(__dirname, "logs"));

// Initial state
let adminClient = null;
let clients = [];
let event = null;
let ring = null;
let specialtyCode = null;
let serverId = null;
let jwtToken = null;
let level0Enabled = false; // PT "Level 0": while on, any referee button press forces that side's score straight to 0
let isGlobalMode = false; // GLOBAL: referees write straight to Firestore (any network) instead of POSTing here
let unsubscribeRefereeScores = null; // teardown for the GLOBAL-mode Firestore listener below
let globalConnectedReferees = new Set(); // referee ids already broadcast as CONNECTED in GLOBAL mode — avoids re-broadcasting on every later score change

// ── SSE STREAMS ──

// admin stream
app.get("/stream/admin", (req, res) => {

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    adminClient = res;
    console.log("Admin SSE connected");

    req.on("close", () => {
        adminClient = null;
        console.log("Admin SSE disconnected");
    });
});

// clients stream
app.get("/stream/clients", (req, res) => {
    
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    clients.push(res);
    console.log(`Client SSE connected. Total connected clients: ${clients.length}`);

    req.on("close", () => {
        clients = clients.filter(c => c !== res);
        console.log(`Client SSE disconnected. Total connected clients: ${clients.length}`);
    });
});

// ── AUTH / LOGIN ──

// Login as server (for Firestore access)
app.post("/api/login/admin", async (req, res) => {
    try {
        const { eventId, ringId, specialty, isGlobal } = req.body;

        validate(res, eventId, ringId);

        event = eventId;
        ring = ringId;
        specialtyCode = specialty;
        isGlobalMode = !!isGlobal;

        console.log("Login server", event, ring, "isGlobal:", isGlobalMode);

        // Login to Firebase as server if not already logged in
        if (!serverId) {

            await loginAsServer(event, ring);

            // Initialize scores in memory
            initScores(SPECIALTY_CONFIGURATION[specialtyCode].referees, SPECIALTY_CONFIGURATION[specialtyCode].startScore);

            // Create match
            await createMatch(event, ring, specialtyCode);

            // Set server id
            serverId = auth.currentUser.uid;

            // Generate JWT token
            jwtToken = generateJwt(event, ring);

            // GLOBAL mode: referees can't reach this server directly (they
            // may not share a network with it), so instead of waiting for
            // POST /api/score/referee/:id, listen to their Firestore score
            // docs directly and feed changes into the same broadcastAdmin()
            // path the local flow uses — the admin UI doesn't need to know
            // which mode is active.
            if (isGlobalMode) {
                globalConnectedReferees = new Set();
                startGlobalRefereeListener();
            }
        }

        res.json({
            ok: true,
            uid: serverId,
            token: jwtToken,
            referees : SPECIALTY_CONFIGURATION[specialtyCode].referees,
            refereeStartScore: SPECIALTY_CONFIGURATION[specialtyCode].startScore,
            buttons: SPECIALTY_CONFIGURATION[specialtyCode].buttons,
            defaultButton: SPECIALTY_CONFIGURATION[specialtyCode].defaultButton,
            localIp: LOCAL_IP
        });
    
    } catch (err) {
        console.error("Login failed:", err);
        res.status(401).json({ ok: false, error: err.message });
    }
});

// Sets up (or re-sets-up, after an error) the GLOBAL-mode Firestore listener
// for referee score/status changes. Firestore's onSnapshot listener is dead
// once its error callback fires — it won't recover on its own — so on error
// this also notifies the admin UI (a topbar badge, admin-shared.js) and
// retries after a short delay, re-arming itself as long as we're still in
// GLOBAL mode. Without this, a lost listener would fail completely silently:
// referees keep scoring into Firestore, the admin just never finds out.
function startGlobalRefereeListener() {
    unsubscribeRefereeScores = listenToRefereeScores(
        event, ring,
        (refereeId, data) => {
            // The referee's own device sets its Firestore doc's status to
            // "ok" once it finishes authenticating via the global link —
            // mirrors what /api/login/referee does for LOCAL mode, so the QR
            // modal closes and the referee card lights up the same way
            // either way. Only fires once per referee — the same doc's
            // status stays "ok" on every later score update too.
            if (data?.status === "ok" && !globalConnectedReferees.has(refereeId)) {
                globalConnectedReferees.add(refereeId);
                console.log(`[GLOBAL] Referee ${refereeId} connected`);
                broadcastAdmin({ referee: refereeId, action: ACTIONS.CONNECTED });
            }

            if (!data?.score) return;

            // Firestore stores these as strings like "21.0" (the referee's
            // incrementRefereeScore transaction always calls .toFixed(1)) —
            // parseFloat here mirrors what the LOCAL POST route already
            // does, so a whole number shows as "21" on the admin UI instead
            // of "21.0".
            const red = parseFloat(data.score.red);
            const blue = parseFloat(data.score.blue);
            const updated = updateScore(refereeId, data.action, red, blue);
            if (!updated) return;

            console.log(`[GLOBAL] Updated score for referee ${refereeId}:`, updated);
            broadcastAdmin({ referee: refereeId, score: updated.score, action: updated.action });
        },
        (error) => {
            console.error("[GLOBAL] Referee score listener lost:", error.message);
            broadcastAdmin({ action: "global_sync_status", status: "lost" });

            setTimeout(() => {
                if (isGlobalMode) startGlobalRefereeListener();
            }, 3000);
        }
    );

    broadcastAdmin({ action: "global_sync_status", status: "ok" });
}

// Login as referee
app.post("/api/login/referee", async (req, res) => {
    
    validate(res, event, ring);

    try {
        const { refereeId, token } = req.body;
        const currentScores = getScores();
        const referee = currentScores?.[refereeId];

        if (!referee) {
            
            return res.status(404).json({ error: `Referee with id ${refereeId} not found` });
        }

        const validToken = token && referee.token === token;

        if (!validToken) {
            
            return res.status(401).json({ error: "Invalid token" });
        }

        const startScore = SPECIALTY_CONFIGURATION[specialtyCode].startScore;
        const buttons = SPECIALTY_CONFIGURATION[specialtyCode].buttons;
        const defaultButton = SPECIALTY_CONFIGURATION[specialtyCode].defaultButton;

        console.log("Login referee", event, ring, refereeId);
        console.log("Creating referee document in Firestore with initial score", startScore);    
        await createRefereeDoc(event, ring, refereeId, { red: startScore, blue: startScore });

        // send score to admin
        broadcastAdmin({ referee: refereeId, action: ACTIONS.CONNECTED });

        res.json({ ok: true, score: referee.score, configuration: { ring, startScore : startScore, buttons : buttons, defaultButton : defaultButton } });
    } catch (err) {
        console.error("Login failed:", err);
        res.status(401).json({ ok: false, error: err.message });
    }
});

// ── REFEREE SCORE ──

// Update score by referee
app.post("/api/score/referee/:id", (req, res) => {
    
    validate(res, event, ring);

    const currentScores = getScores();
    const referee = parseInt(req.params.id);
    const { score, action } = req.body;

    if (!currentScores[referee]) {
        return res.status(404).json({ error: `Referee ${referee} not found` });
    }

    // Score updates are only allowed while the match is actually running —
    // tablet.html already blocks this client-side, but not every caller
    // goes through the tablet UI (e.g. the serial controller bridge), so
    // it's enforced here too as the single source of truth.
    if (action === ACTIONS.UPDATE_SCORE && getMatchState() !== STATUS.PLAY) {
        return res.status(409).json({ error: "Scoring blocked — match is not in PLAY state" });
    }

    let red = parseFloat(score.red);
    let blue = parseFloat(score.blue);
    let forcedToZero = false;

    // LEVEL 0: while active, any button press forces the side that just
    // changed straight to 0 instead of applying its normal point value —
    // for penalties severe enough to zero a competitor's score outright.
    if (level0Enabled && action === ACTIONS.UPDATE_SCORE) {
        const previous = currentScores[referee].score;
        if (red !== parseFloat(previous.red)) { red = 0; forcedToZero = true; }
        if (blue !== parseFloat(previous.blue)) { blue = 0; forcedToZero = true; }
    }

    // update score in memory
    const updated = updateScore(referee, action, red, blue);
    console.log(`Updated score for referee ${referee}:`, updated);

    // send score to admin
    broadcastAdmin({ referee: referee, score: updated.score, action: updated.action });

    // send score to clients if reset_score, or if Level 0 just overrode the
    // value — the referee's own tablet computed a different score locally
    // before sending it, so it needs correcting back to the forced value.
    if (updated.action === ACTIONS.RESET_SCORE || forcedToZero) {

        broadcastClients({ referee: referee, score: updated.score, action: ACTIONS.RESET_SCORE });
    }

    // save score in Firestore
    updateRefereeDoc(event, ring, referee, { score: updated.score, action: updated.action } );
    
    res.json({ ok: true });
});

// Delete referee score
app.delete("/api/score/referee/:id", async (req, res) => {
    
    validate(res, event, ring);

    const referee = parseInt(req.params.id);    
    const currentScores = getScores();
    const startScore = SPECIALTY_CONFIGURATION[specialtyCode].startScore;

    if (!currentScores?.[referee]) {
        
        return res.status(404).json({ error: `Referee ${referee} not found` });
    }

    // delete score in memory
    deleteScore(referee, startScore);
    
    // send score to admin
    broadcastAdmin({ referee: referee, score: currentScores[referee] });

    // delete score in Firestore
    await deleteRefereeDoc(event, ring, referee);

    res.json({ ok: true });
});

// Clears the referee's match score token on the handlesport.com backend —
// removes the MySQL record tied to their auth — and deletes their Firestore
// doc. Wired up from the referee card's "CLEAR TOKEN" button (admin-shared.js),
// both modes: called unconditionally (it responds ok even when there's no
// MySQL token to clear in LOCAL mode) since LOCAL referees still get a
// Firestore doc (created at /api/login/referee) that's worth clearing too.
app.post("/api/referee/clear-token/:refereeId", async (req, res) => {

    validate(res, event, ring);

    try {
        const { refereeId } = req.params;

        const bodyParams = new URLSearchParams({
            id_event: event,
            id_ring: ring,
            id_referee: refereeId
        });

        const response = await fetch(`${HANDLESPORT_BACKEND_URL}/scoring/clearMatchScoreToken`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded", token: jwtToken },
            body: bodyParams.toString()
        });

        const raw = await response.json();

        if (!response.ok) {
            return res.status(response.status).json(raw);
        }

        // Delete the Firestore doc entirely rather than just resetting
        // status — the next AUTH click already calls ensureRefereeDoc(),
        // which recreates it fresh (status: pending, score: startScore) if
        // missing. That recreation, followed by the referee's own
        // loginAsReferee() later writing status:"ok", is a genuine
        // "pending" -> "ok" transition, which is what Firestore's
        // onSnapshot actually needs to fire a change event (same-value
        // rewrites are silently ignored — see the listener above).
        await deleteRefereeDoc(event, ring, refereeId);

        // Forget this referee was ever marked CONNECTED, so the next real
        // "pending" -> "ok" transition gets broadcast again (GLOBAL only —
        // this set stays empty and unused in LOCAL mode).
        globalConnectedReferees.delete(parseInt(refereeId));

        return res.json({ ok: true, raw });

    } catch (err) {
        console.error("Failed to clear referee match score token:", err);
        return res.status(500).json({ ok: false, error: "Failed to clear referee match score token" });
    }
});

// Same as above but for every referee at once — no id_referee, the backend
// clears every match score token for this event/ring in one call. Wired up
// from the "CLEAR ALL TOKENS" toolbar button (admin-shared.js), both modes —
// see the per-referee route above for why it's called unconditionally.
app.post("/api/referees/clear-tokens", async (req, res) => {

    validate(res, event, ring);

    try {
        const bodyParams = new URLSearchParams({
            id_event: event,
            id_ring: ring
        });

        const response = await fetch(`${HANDLESPORT_BACKEND_URL}/scoring/clearMatchScoreToken`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded", token: jwtToken },
            body: bodyParams.toString()
        });

        const raw = await response.json();

        if (!response.ok) {
            return res.status(response.status).json(raw);
        }

        // Same reasoning as the per-referee route above — delete every
        // referee's Firestore doc so the next AUTH click recreates it fresh
        // via ensureRefereeDoc(), guaranteeing a genuine "pending" -> "ok"
        // transition on the next real re-auth.
        const totalReferees = SPECIALTY_CONFIGURATION[specialtyCode].referees;
        for (let i = 1; i <= totalReferees; i++) {
            await deleteRefereeDoc(event, ring, i);
        }
        globalConnectedReferees = new Set();

        return res.json({ ok: true, raw });

    } catch (err) {
        console.error("Failed to clear all referee match score tokens:", err);
        return res.status(500).json({ ok: false, error: "Failed to clear all referee match score tokens" });
    }
});

// Score by referee
app.get("/api/score/referee/:id", (req, res) => {
    
    const referee = parseInt(req.params.id);
    const currentScores = getScores();

    if (!currentScores?.[referee]) {
        
        return res.status(404).json({ error: `Referee ${referee} not found` });
    }

    res.json(currentScores[referee]);
});

// Referee url
app.get("/api/tablet/url/:refereeId", async (req, res) => {

    const { refereeId } = req.params;

    const currentScores = getScores();
    const referee = currentScores?.[refereeId];
    if (!referee) return res.status(404).json({ error: `Referee ${refereeId} not found` });

    // GLOBAL mode: the referee needs a link that works from any network, so
    // instead of pointing at this machine's LAN address we ask the backend
    // for a handlesport.com URL (backed by its own auth, not our local
    // token) — the referee's tablet talks to Firestore/handlesport.com
    // directly from there, never to this server.
    if (isGlobalMode) {
        try {
            // The referee's Firestore doc might not exist yet at this point
            // (nothing else has created it in GLOBAL mode) — make sure it's
            // there with the specialty's real start score before handing
            // out the link, otherwise the referee's tablet would attach to
            // a doc that doesn't exist. Only creates it if missing, so
            // re-generating the link for an already-connected referee
            // doesn't reset their live score/status.
            const startScore = SPECIALTY_CONFIGURATION[specialtyCode].startScore;
            await ensureRefereeDoc(event, ring, refereeId, { red: startScore, blue: startScore });

            const bodyParams = new URLSearchParams({
                id_event: event,
                id_ring: ring,
                id_referee: refereeId,
                specialty: specialtyCode,
                start_score: startScore,
                buttons: SPECIALTY_CONFIGURATION[specialtyCode].buttons.join(","),
                default_button: SPECIALTY_CONFIGURATION[specialtyCode].defaultButton,
                new: true
            });

            const response = await fetch(`${HANDLESPORT_BACKEND_URL}/scoring/auth`, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded", token: jwtToken },
                body: bodyParams.toString()
            });

            const data = await response.json();

            if (!response.ok || data.result !== "success" || !data.url) {
                return res.status(response.status || 500).json({ ok: false, error: "Failed to generate global referee link", raw: data });
            }

            return res.json({ ok: true, refereeId, url: data.url, code: data.code });

        } catch (err) {
            console.error("Failed to fetch global referee auth URL:", err);
            return res.status(500).json({ ok: false, error: "Failed to generate global referee link" });
        }
    }

    const url = `http://${LOCAL_IP}:${PORT}/tablet/${refereeId}?token=${referee.token}`;

    res.json({ ok: true, refereeId, url });
});

// ── MATCH ──

// Get match status
app.get("/api/match/status", (req, res) => {
    
    validate(res, event, ring);

    const state = getMatchState();

    res.json({ state });
});

// Update match status
app.post("/api/match/status", (req, res) => {
    
    validate(res, event, ring);

    // update status in memory
    const { state } = req.body;

    // update status in Firestore
    updateMatchState(event, ring, state);

    // send status to clients
    broadcastClients({ action: ACTIONS.UPDATE_STATE, state: state });
    
    res.json({ ok: true });
});

// Get Level 0 status
app.get("/api/match/level0", (req, res) => {

    validate(res, event, ring);

    res.json({ enabled: level0Enabled });
});

// Toggle Level 0 (any referee button press forces that side's score to 0)
app.post("/api/match/level0", (req, res) => {

    validate(res, event, ring);

    level0Enabled = !!req.body.enabled;
    console.log("Level 0 mode:", level0Enabled);

    res.json({ ok: true, enabled: level0Enabled });
});

// Update match details
app.post("/api/match/details", (req, res) => {
    
    validate(res, event, ring);

    // update details in memory
    const matchDetails = req.body;

    // update details in Firestore
    updateMatchDetails(event, ring, matchDetails);
    
    res.json({ ok: true });
});

// Update match result
app.post("/api/match/update", async (req, res) => {
 
    try {
        validate(res, event, ring);
 
        const {
            id_category,
            pool,
            id_match,
            id_real_match,
            id_winner,
            id_loser,
            left_score,
            right_score,
            tie
        } = req.body;
 
        if (!id_category || !pool || !id_match || !id_real_match) {
            
            return res.status(400).json({ok: false, error: "id_category, pool, id_match and id_real_match are required"});
        }
 
        const rawParams = {
            id_event: event,
            id_ring: ring,
            id_category,
            pool,
            id_match,
            id_real_match,
            id_winner,
            id_loser,
            left_score,
            right_score,
            tie,
            app: true
        };

        // Avoid sending literal "undefined"/"null" strings for missing values.
        const filteredParams = Object.fromEntries(
            Object.entries(rawParams).filter(([, v]) => v !== undefined && v !== null)
        );

        const bodyParams = new URLSearchParams(filteredParams);
 
        const response = await fetch(
            `${HANDLESPORT_BACKEND_URL}/scoring/updateMatch`,
            {
                method: "POST",
                headers: {"Content-Type": "application/x-www-form-urlencoded", token: jwtToken },
                body: bodyParams.toString()
            }
        );
 
        const data = await response.json();
 
        if (!response.ok) {
            
            return res.status(response.status).json(data);
        }
 
        if (data.result !== "OK") {
            
            return res.status(400).json({ ok: false, error: "Update in updating match result", result: data.result, raw: data });
        }

        return res.json({ ok: true, finish: data.finish });
 
    } catch (err) {
        
        console.error(err);
        
        return res.status(500).json({ ok: false, error: "Failed to update match" });
    }
});

// ── HANDLESPORT BACKEND PROXIES ──

// Get categories
app.get("/api/categories", async (req, res) => {

    try {
        validate(res, event, ring);

        const response = await fetch(
            `${HANDLESPORT_BACKEND_URL}/scoring/getCategories?specialty_code=${specialtyCode}&id_event=${event}&id_ring=${ring}`,
            { headers: { token: jwtToken }}
        );

        const data = await response.json();

        if (!response.ok) {
            
            return res.status(response.status).json(data);
        }

        return res.json(data);

    } catch (err) {
        
        console.error(err);

        return res.status(500).json({ok: false, error: "Failed to fetch categories"});
    }
});

// Get matches
app.get("/api/matches", async (req, res) => {

    try {
        validate(res, event, ring);

        const { id_category, pool } = req.query;

        if (!id_category || !pool) {
            
            return res.status(400).json({ ok: false, error: "id_category and pool are required" });
        }

        const response = await fetch(
            `${HANDLESPORT_BACKEND_URL}/scoring/loadMatches?id_event=${event}&id_ring=${ring}&id_category=${id_category}&pool=${pool}`,
            { headers: { token: jwtToken }}
        );

        const data = await response.json();

        if (!response.ok) {
            
            return res.status(response.status).json(data);
        }

        return res.json(data);

    } catch (err) {
        
        console.error(err);

        return res.status(500).json({ok: false, error: "Failed to fetch categories"});
    }
});

// Lightweight connectivity check used by intro.html's connection stability
// indicator — touches the external handlesport.com backend too (not just
// this local server), since that's what setup and GLOBAL mode actually
// depend on being reachable. Callable before login (no event/ring needed).
app.get("/api/ping", async (req, res) => {
    const start = Date.now();
    try {
        const response = await fetch(`${HANDLESPORT_BACKEND_URL}/scoring/getEvents`);
        return res.json({ ok: true, backendReachable: response.ok, backendMs: Date.now() - start });
    } catch (err) {
        return res.json({ ok: true, backendReachable: false, backendMs: Date.now() - start });
    }
});

// Returns the running app's own version, shown on the setup screen.
// HANDLESPORT_APP_VERSION is set by main.cjs from Electron's app.getVersion()
// (the authoritative source); falls back to reading package.json directly
// when run standalone (e.g. plain `node server.js`, outside Electron).
app.get("/api/app-version", (req, res) => {
    if (process.env.HANDLESPORT_APP_VERSION) {
        return res.json({ version: process.env.HANDLESPORT_APP_VERSION });
    }
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8"));
        return res.json({ version: pkg.version });
    } catch (err) {
        return res.json({ version: null });
    }
});

// Checks handlesport.com for a newer scoring-server release. Called by
// main.cjs right after the admin window finishes loading; if a newer
// version is available, intro.html shows an update modal. Doesn't require
// login — event/ring aren't set yet at this point in the app's lifecycle.
app.get("/api/check-update", async (req, res) => {
    try {
        const key = crypto.createHash("md5").update(API_KEY).digest("hex");
        const response = await fetch(`${HANDLESPORT_BACKEND_URL}/scoring/getScoringServer?key=${key}`);
        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json(data);
        }

        return res.json(data);

    } catch (err) {
        console.error("Failed to check for updates:", err);
        return res.status(500).json({ ok: false, error: "Failed to check for updates" });
    }
});

// Get events
app.get("/api/events", async (req, res) => {

    try {

        const response = await fetch(`${HANDLESPORT_BACKEND_URL}/scoring/getEvents`);

        const data = await response.json();

        if (!response.ok) {
            
            return res.status(response.status).json(data);
        }

        return res.json(data);

    } catch (err) {
        
        console.error(err);

        return res.status(500).json({ok: false, error: "Failed to fetch events"});
    }
});

// ── MISC ──

// Get flags
app.get("/api/flags", (req, res) => {
    
    try {
        
        const flagsDir = path.join(__dirname, "public", "images", "flags");
        const files = fs.readdirSync(flagsDir);
 
        const countries = files
            .filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f))
            .map(f => f.replace(/\.(png|jpg|jpeg|webp)$/i, "").toUpperCase())
            .sort();
 
        res.json({ ok: true, countries });
    
    } catch (err) {
        
        console.error("Failed to list flags:", err);
        
        res.status(500).json({ ok: false, error: "Failed to list flags" });
    }
});

// Get patterns
app.get("/api/patterns", async (req, res) => {
    
    try {

        const response = await fetch(`${HANDLESPORT_BACKEND_URL}/scoring/getPatterns`);

        const data = await response.json();

        if (!response.ok) {
            
            return res.status(response.status).json(data);
        }

        return res.json(data);

    } catch (err) {
        
        console.error(err);

        return res.status(500).json({ok: false, error: "Failed to fetch patterns"});
    }
});

// ── SESSION LOGGING ──

// Starts a new logging session (call this once, e.g. right after /api/login/admin succeeds). Returns the generated session id.
app.post("/api/log/start", (req, res) => {
    
    try {
        
        const { ring } = req.body;
        const { sessionId, fileName } = startLogSession(crypto, ring);

        res.json({ ok: true, sessionId, fileName });
    
    } catch (err) {
        
        console.error("Failed to start log session:", err);
        
        res.status(500).json({ ok: false, error: "Failed to start log session" });
    }
});

// Appends a generic event to the current session log. Body: { event: "referee_score", ...anyOtherFields }
app.post("/api/log/event", (req, res) => {
    
    try {
        
        if (!hasActiveLogSession()) {
            return res.status(400).json({ ok: false, error: "No active logging session — call /api/log/start first" });
        }
        
        if (!req.body || !req.body.event) {
            return res.status(400).json({ ok: false, error: "Missing 'event' field" });
        }
 
        appendLogEntry(req.body);
        
        res.json({ ok: true });
    
    } catch (err) {
        
        console.error("Failed to write log event:", err);
        
        res.status(500).json({ ok: false, error: "Failed to write log event" });
    }
});

// Lists all session log files available on this machine (most recent first).
app.get("/api/log/list", (req, res) => {
    
    try {
        
        const files = listLogFiles();
 
        res.json({ ok: true, files });
    
    } catch (err) {
        
        console.error("Failed to list logs:", err);
        
        res.status(500).json({ ok: false, error: "Failed to list logs" });
    }
});

// Downloads a specific session log file by name.
app.get("/api/log/download/:fileName", (req, res) => {
    
    const fileName = req.params.fileName;
 
    // Basic safety: only allow file names matching our own generated pattern.
    if (!isValidLogFileName(fileName)) {
        
        return res.status(400).json({ ok: false, error: "Invalid file name" });
    }
 
    if (!logFileExists(fileName)) {
        
        return res.status(404).json({ ok: false, error: "Log file not found" });
    }
 
    res.download(getLogFilePath(fileName), fileName);
});

// ── PAGES ──

app.get("/tablet/:id", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "tablet.html"));
});

app.get("/admin", (req, res) => {
    const specialty = req.query.specialty.toLowerCase();
    const fileName = `admin-${specialty}.html`;
    res.sendFile(path.join(__dirname, "public", fileName));
});

app.get("/display", (req, res) => {
    const specialty = req.query.specialty.toLowerCase();
    const fileName = `display-${specialty}.html`;
    res.sendFile(path.join(__dirname, "public", fileName));
});

app.get("/intro", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "intro.html"));
});

// ── SERVER START ──

export async function startServer() {
    
    app.listen(PORT, "0.0.0.0", () => {
        console.log(`Server started on http://localhost:${PORT}`);
        console.log(`IP local: ${LOCAL_IP}`);        
    });
}

// ── HELPERS ──

// Admin broadcast
function broadcastAdmin(data) {
    
    if (adminClient) {
        
        adminClient.write(`data: ${JSON.stringify(data)}\n\n`);
    }
}

// Clients broadcast
function broadcastClients(data) {
    
    clients.forEach(client => {
        
        client.write(`data: ${JSON.stringify(data)}\n\n`);
    });
}

function validate(res, event, ring) {

    if (!event || !ring) {
        
        return res.status(400).json({ ok: false, error: "event and ring required" });
    }
}

function getLocalIP() {
    
    const interfaces = os.networkInterfaces();

    for (let name of Object.keys(interfaces)) {
        
        for (let net of interfaces[name]) {
            
            if (net.family === "IPv4" && !net.internal) {
                
                return net.address;
            }
        }
    }
}

function generateJwt(event, ring) {
    
    const key = crypto.createHash('md5').update(API_KEY).digest('hex');

    const payload = {
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 86400,
        event: event,
        ring: ring
    };

    return jwt.sign(payload, key, { algorithm: 'HS256' });
}
