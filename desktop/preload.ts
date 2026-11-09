import { contextBridge, ipcRenderer } from "electron";
// No general filesystem, shell or network capability is exposed to the page.
contextBridge.exposeInMainWorld("everseDesktop", {
  download: (path: string) => ipcRenderer.invoke("everse:export-file", path),
});
