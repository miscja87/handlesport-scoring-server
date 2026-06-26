const { app, BrowserWindow, screen, ipcMain } = require("electron");

let win         = null;
let displayWin  = null; 

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

    win.on("closed", () => {
        
        win = null;
        
        // Close the display window too when the admin window closes
        if (displayWin) {
            displayWin.close();
            displayWin = null;
        }
    });
}

function openDisplayWindow() {
    
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

    displayWin.loadURL("http://localhost:8080/display");

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

ipcMain.on("display:open", () => {
    openDisplayWindow();
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
    
    // dynamic import perché server.js è ESM
    const { startServer } = await import("./server.js");

    startServer();
    createWindow();
});

app.on("window-all-closed", () => {
    
    if (process.platform !== "darwin") app.quit();
});