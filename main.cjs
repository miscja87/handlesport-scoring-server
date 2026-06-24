const { app, BrowserWindow } = require("electron");

let win;

function createWindow() {
    win = new BrowserWindow({
        width: 1400,
        height: 900,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    win.loadURL("http://localhost:8080/intro");

    win.on("closed", () => {
        win = null;
    });
}

app.whenReady().then(async () => {
    
    // dynamic import perché server.js è ESM
    const { startServer } = await import("./server.js");

    startServer();
    createWindow();
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
});