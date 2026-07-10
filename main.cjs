const { app, BrowserWindow, screen, ipcMain } = require("electron");

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

    win.loadURL("http://localhost:8080/intro");

    setupSerialPortSupport(win);

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

app.whenReady().then(async () => {
    try {
        // server.js's logger writes to this folder — must be a real writable
        // path, not one relative to the app's own install directory (in a
        // packaged build that's inside the read-only app.asar archive, and
        // mkdirSync/writes there fail). Electron's userData dir is always
        // writable both in dev and packaged.
        process.env.HANDLESPORT_LOGS_DIR = require("path").join(app.getPath("userData"), "logs");

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
