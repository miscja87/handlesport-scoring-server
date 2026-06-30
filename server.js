import express from "express";
import cors from "cors";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { initScores, getScores, updateScore, deleteScore } from "./scores.js";
import { createMatch, updateMatchDetails, updateMatchState, getMatchState } from "./match.js";
import { loginAsServer, createRefereeDoc, updateRefereeDoc, deleteRefereeDoc, auth } from "./firestore.js";
import { ACTIONS } from "./constants.js";
import { SPECIALTY_CONFIGURATION } from "./specialty.js";
import { config } from "process";

// dir name
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Initial state
let adminClient = null;
let clients = [];
let event = null;
let ring = null;
let specialtyCode = null;

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
        const { eventId, ringId, specialty, referees } = req.body;
        
        validate(res, eventId, ringId);
        
        event = eventId;
        ring = ringId;
        specialtyCode = specialty;

        console.log("Login server", event, ring);
        
        // Login to Firebase as server
        await loginAsServer(event, ring);

        // Initialize scores in memory
        initScores(referees, SPECIALTY_CONFIGURATION[specialtyCode].startScore);

        // Create match
        await createMatch(event, ring, specialtyCode);

        res.json({ ok: true, uid: auth.currentUser.uid, localIp: getLocalIP() });
    } catch (err) {
        console.error("Login failed:", err);
        res.status(401).json({ ok: false, error: err.message });
    }
});

// Login as referee
app.post("/api/login/referee", async (req, res) => {
    
    validate(res, event, ring);

    try {
        const { refereeId } = req.body;
        const startScore = SPECIALTY_CONFIGURATION[specialtyCode].startScore;
        const buttons = SPECIALTY_CONFIGURATION[specialtyCode].buttons;
        console.log("Login referee", event, ring, refereeId);
        console.log("Creating referee document in Firestore with initial score", startScore);
        await createRefereeDoc(event, ring, refereeId, { red: startScore, blue: startScore });
        res.json({ ok: true, configuration: { startScore : startScore, buttons : buttons } });
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
    updateRefereeDoc(event, ring, referee, updated );
    
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

// Start server
export async function startServer() {
    const PORT = 8080;
    const LOCAL_IP = getLocalIP();    

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
            
            if (net.family === "IPv4" && !net.internal) {
                
                return net.address;
            }
        }
    }
}

app.get("/tablet/:id", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "tablet.html"));
});