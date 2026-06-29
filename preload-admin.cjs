const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("displayBridge", {
    openDisplay: (specialty) => ipcRenderer.send("display:open", specialty),
    closeDisplay: () => ipcRenderer.send("display:close"),
    update: (payload) => ipcRenderer.send("display:update", payload)
});
