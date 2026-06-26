import express from "express";
import cors from "cors";
import os from "os";
import path from "path";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { initScores, getScores, updateScore, deleteScore } from "./scores.js";
import { createMatch, updateMatchDetails, updateMatchState, getMatchState } from "./match.js";
import { loginAsServer, createRefereeDoc, updateRefereeDoc, deleteRefereeDoc, auth } from "./firestore.js";
import { ACTIONS, API_KEY, HANDLESPORT_BACKEND_URL } from "./constants.js";
import { SPECIALTY_CONFIGURATION } from "./specialty.js";

// dir name
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Constants
const PORT = 8080;
const LOCAL_IP = getLocalIP();

// Initial state
let adminClient = null;
let clients = [];
let event = null;
let ring = null;
let specialtyCode = null;
let serverId = null;
let jwtToken = null;

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

// Login as server (for Firestore access)
app.post("/api/login/admin", async (req, res) => {
    try {
        const { eventId, ringId, specialty } = req.body;
        
        validate(res, eventId, ringId);
        
        event = eventId;
        ring = ringId;
        specialtyCode = specialty;

        console.log("Login server", event, ring);
        
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
        }

        res.json({ ok: true, uid: serverId, token: jwtToken, localIp: LOCAL_IP });
    
    } catch (err) {
        console.error("Login failed:", err);
        res.status(401).json({ ok: false, error: err.message });
    }
});

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

// Update score by referee
app.post("/api/score/referee/:id", (req, res) => {
    
    validate(res, event, ring);

    const currentScores = getScores();
    const referee = parseInt(req.params.id);
    const { score, action } = req.body;
    
    if (!currentScores[referee]) {
        return res.status(404).json({ error: `Referee ${referee} not found` });
    }

    // update score in memory
    const updated = updateScore(referee, action, parseFloat(score.red), parseFloat(score.blue));
    console.log(`Updated score for referee ${referee}:`, updated);
    
    // send score to admin
    broadcastAdmin({ referee: referee, score: updated.score, action: updated.action });
    
    // send score to clients only if reset_score
    if (updated.action === ACTIONS.RESET_SCORE) {
        
        broadcastClients({ referee: referee, score: updated.score, action: updated.action });
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
app.get("/api/tablet/url/:refereeId", (req, res) => {
    
    const { refereeId } = req.params;

    const currentScores = getScores();
    const referee = currentScores?.[refereeId];
    if (!referee) return res.status(404).json({ error: `Referee ${refereeId} not found` });

    const url = `http://${LOCAL_IP}:${PORT}/tablet/${refereeId}?token=${referee.token}`;

    res.json({ ok: true, refereeId, url });
});

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

// Update match details
app.post("/api/match/details", (req, res) => {
    
    validate(res, event, ring);

    // update details in memory
    const matchDetails = req.body;

    // update details in Firestore
    updateMatchDetails(event, ring, matchDetails);
    
    res.json({ ok: true });
});

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

// Start server
export async function startServer() {
    
    app.listen(PORT, "0.0.0.0", () => {
        console.log(`Server started on http://localhost:${PORT}`);
        console.log(`IP local: ${LOCAL_IP}`);        
    });
}

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
            if (
                net.family === "IPv4" && !net.internal && net.address.startsWith("192.168")
            ) {
                return net.address;
            }
        }
    }
}

function generateJwt(event, ring) {
    const key = crypto
        .createHash('md5')
        .update(API_KEY)
        .digest('hex');

    const payload = {
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 86400,
        event: event,
        ring: ring
    };

    return jwt.sign(payload, key, { algorithm: 'HS256' });
}

app.get("/tablet/:id", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "tablet.html"));
});

app.get("/admin", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/intro", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "intro.html"));
});

app.get("/display", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "display.html"));
});