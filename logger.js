import fs from "fs";
import path from "path";

// One log file per "session" (= one open-app-to-close-app run), identified
// by a random session id generated when the admin panel logs in.
let currentSessionId = null;
let currentLogFilePath = null;
let logsDir = null;

// Must be called once at startup with the absolute path to the logs folder
// (e.g. path.join(__dirname, "logs")). Creates the folder if missing.
export function initLogger(dir) {
    logsDir = dir;
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
    }
}

// Appends one JSON-lines entry to the current session's log file.
// Every entry automatically gets a server-side timestamp.
export function appendLogEntry(entry) {
    if (!currentLogFilePath) return; // silently no-op if no session started yet
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n";
    fs.appendFile(currentLogFilePath, line, (err) => {
        if (err) console.error("Failed to write log entry:", err);
    });
}

// Starts a new logging session. Returns { sessionId, fileName }.
export function startLogSession(crypto, ring) {
    currentSessionId = crypto.randomUUID();
    const fileName = `RING_${ring ?? "X"}_${currentSessionId}.jsonl`;
    currentLogFilePath = path.join(logsDir, fileName);

    fs.writeFileSync(currentLogFilePath, ""); // create empty file
    appendLogEntry({ event: "session_open", sessionId: currentSessionId, ring });

    return { sessionId: currentSessionId, fileName };
}

export function hasActiveLogSession() {
    return !!currentLogFilePath;
}

export function listLogFiles() {
    return fs.readdirSync(logsDir)
        .filter(f => f.endsWith(".jsonl"))
        .map(f => {
            const stat = fs.statSync(path.join(logsDir, f));
            return { fileName: f, size: stat.size, mtime: stat.mtime };
        })
        .sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
}

export function getLogFilePath(fileName) {
    return path.join(logsDir, fileName);
}

export function isValidLogFileName(fileName) {
    return /^RING_[\w-]+_[\w-]+\.jsonl$/.test(fileName);
}

export function logFileExists(fileName) {
    return fs.existsSync(getLogFilePath(fileName));
}
