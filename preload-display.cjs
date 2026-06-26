const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("displayBridge", {
    onUpdate: (callback) => {
        ipcRenderer.on("display:update", (event, payload) => callback(payload));
    }
});
