const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    scanSpecs: () => ipcRenderer.invoke('scan-specs'),
    runTest: (path) => ipcRenderer.invoke('run-test', path),
    stopTest: () => ipcRenderer.invoke('stop-test'),
    openInVSCode: (location) => ipcRenderer.invoke('open-in-vscode', location),
    readFile: (path) => ipcRenderer.invoke('read-file', path),
    onTestOutput: (callback) => ipcRenderer.on('test-output', (_event, value) => callback(value))
});
