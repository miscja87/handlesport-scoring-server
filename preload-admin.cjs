const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("displayBridge", {
    openDisplay: (specialty) => ipcRenderer.send("display:open", specialty),
    closeDisplay: () => ipcRenderer.send("display:close"),
    update: (payload) => ipcRenderer.send("display:update", payload)
});

contextBridge.exposeInMainWorld("serialBridge", {
    onPortList: (callback) => ipcRenderer.on("serial:port-list", (_event, ports) => callback(ports)),
    choosePort: (portId) => ipcRenderer.send("serial:port-chosen", portId)
});
