// stage.html was written for WKWebView and talks to its host through
// window.webkit.messageHandlers.agent.postMessage(m). Provide exactly that, forwarding to
// the main process. Nothing else is exposed to the page.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('webkit', {
  messageHandlers: {
    agent: {
      postMessage: (m) => ipcRenderer.send('stage:message', m),
    },
  },
});
