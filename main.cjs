const { app, BrowserWindow, screen, ipcMain, shell } = require("electron");

let win = null;          // admin window (primary)
let displayWin = null;   // public display window (secondary monitor)

function createWindow() {
    win = new BrowserWindow({
        width: 1400,
        height: 900,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: require("path").join(__dirname, "preload-admin.cjs")
        }
    });

    win.loadURL("http://localhost:8080/login");

    setupSerialPortSupport(win);

    // Wait for the page (and its preload-registered IPC listener) to be
    // ready before checking — sending "update:available" any earlier could
    // arrive before intro.html has called updateBridge.onUpdateAvailable().
    win.webContents.once("did-finish-load", checkForUpdate);

    win.on("closed", () => {
        win = null;
        // Close the display window too when the admin window closes
        if (displayWin) {
            displayWin.close();
            displayWin = null;
        }
    });
}

// ── WEB SERIAL SUPPORT ──
// Electron doesn't show the browser's native serial port picker on its own —
// navigator.serial.requestPort() in the renderer just fires this event and
// waits for us to resolve it. We forward the port list to the renderer (via
// preload-admin.cjs's serialBridge) so admin-shared.js can render its own
// picker, then resolve here once the user picks one (or cancel with "").
let pendingSerialPortCallback = null;

function setupSerialPortSupport(window) {
    const ses = window.webContents.session;

    ses.on("select-serial-port", (event, portList, webContents, callback) => {
        event.preventDefault();
        pendingSerialPortCallback = callback;
        webContents.send("serial:port-list", portList.map(p => ({
            portId: p.portId,
            displayName: p.displayName || p.portName || p.path || p.portId
        })));
    });

    ses.setPermissionCheckHandler((webContents, permission) => permission === "serial");
    ses.setDevicePermissionHandler((details) => details.deviceType === "serial");
}

ipcMain.on("serial:port-chosen", (event, portId) => {
    if (pendingSerialPortCallback) {
        pendingSerialPortCallback(portId || "");
        pendingSerialPortCallback = null;
    }
});

// Opens (or focuses) the public display window on the external monitor if one
// is connected, otherwise falls back to the primary display in a separate window.
function openDisplayWindow(specialty) {
    if (displayWin) {
        displayWin.focus();
        return;
    }

    const displays = screen.getAllDisplays();
    const primaryDisplay = screen.getPrimaryDisplay();
    const externalDisplay = displays.find(d => d.id !== primaryDisplay.id);

    const targetDisplay = externalDisplay || primaryDisplay;
    const { x, y, width, height } = targetDisplay.bounds;

    displayWin = new BrowserWindow({
        x: x,
        y: y,
        width: width,
        height: height,
        fullscreen: !!externalDisplay, // fullscreen only if a real second monitor exists
        fullscreenable: true, // explicit, not relying on the default — macOS's native fullscreen (green button / Cmd+Ctrl+F) needs this set to actually offer it
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: require("path").join(__dirname, "preload-display.cjs")
        }
    });

    const specialtyParam = (specialty || "sp").toLowerCase();
    displayWin.loadURL(`http://localhost:8080/display?specialty=${specialtyParam}`);

    displayWin.on("closed", () => {
        displayWin = null;
    });
}

function closeDisplayWindow() {
    if (displayWin) {
        displayWin.close();
        displayWin = null;
    }
}

// ── IPC BRIDGE ──
// admin.html (via preload-admin.cjs) sends "display:update" with any payload.
// We forward it untouched to display.html (via preload-display.cjs).
ipcMain.on("display:open", (event, specialty) => {
    openDisplayWindow(specialty);
});

ipcMain.on("display:close", () => {
    closeDisplayWindow();
});

ipcMain.on("display:update", (event, payload) => {
    if (displayWin) {
        displayWin.webContents.send("display:update", payload);
    }
});

// ── UPDATE CHECK ──
// Asks the local server (which proxies handlesport.com/scoring/getScoringServer)
// for the latest released version. If it's newer than this build, notifies
// intro.html via IPC — the modal there just opens the download URL in the
// user's browser (no auto-download/auto-run of the fetched .exe).
async function checkForUpdate() {
    try {
        const res = await fetch("http://localhost:8080/api/check-update");
        const data = await res.json();

        if (!data.result || !data.version || !data.url) return;
        if (!isNewerVersion(data.version, app.getVersion())) return;

        if (win) win.webContents.send("update:available", { version: data.version, url: data.url });
    } catch (err) {
        console.error("Update check failed:", err);
    }
}

// Plain MAJOR.MINOR.PATCH string comparison — no semver library needed for
// the simple numeric versions this app uses.
function isNewerVersion(remoteVersion, currentVersion) {
    const remote = remoteVersion.split(".").map(Number);
    const current = currentVersion.split(".").map(Number);

    for (let i = 0; i < Math.max(remote.length, current.length); i++) {
        const r = remote[i] || 0;
        const c = current[i] || 0;
        if (r > c) return true;
        if (r < c) return false;
    }
    return false;
}

ipcMain.on("update:open-download", (event, url) => {
    // Only ever open handlesport.com URLs — this came from a network
    // response, so worth a basic origin check before handing it to the OS.
    if (typeof url === "string" && url.startsWith("https://www.handlesport.com/")) {
        shell.openExternal(url);
    }
});

app.whenReady().then(async () => {
    try {
        // server.js's logger writes to this folder — must be a real writable
        // path, not one relative to the app's own install directory (in a
        // packaged build that's inside the read-only app.asar archive, and
        // mkdirSync/writes there fail). Electron's userData dir is always
        // writable both in dev and packaged.
        process.env.HANDLESPORT_LOGS_DIR = require("path").join(app.getPath("userData"), "logs");
        process.env.HANDLESPORT_APP_VERSION = app.getVersion();

        const { startServer } = await import("./server.js");

        startServer();
        createWindow();
    } catch (err) {
        // Packaged Windows builds have no console attached, so an unhandled
        // failure here used to hang silently — orphaned processes, no
        // window, nothing telling the user (or us) what went wrong.
        console.error("Failed to start:", err);
        const { dialog } = require("electron");
        dialog.showErrorBox("HandleSport failed to start", String(err && err.stack || err));
        app.quit();
    }
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
});
