const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("displayBridge", {
    openDisplay: () => ipcRenderer.send("display:open"),
    closeDisplay: () => ipcRenderer.send("display:close"),
    update: (payload) => ipcRenderer.send("display:update", payload)
});
