import { fetchLocal, readJson } from "./response";
declare global {
  interface Window {
    everseDesktop?: { download(path: string): Promise<{ canceled: boolean }> };
  }
}

/** Blob downloads work in both a browser and the desktop app's private scheme. */
export async function downloadLocalFile(path: string) {
  if (!/^\/api\/[a-zA-Z0-9_/-]+\/export$/.test(path))
    throw new Error("无效的导出地址");
  if (window.everseDesktop) {
    await window.everseDesktop.download(path);
    return;
  }
  const response = await fetchLocal(path);
  if (!response.ok) await readJson(response);
  const disposition = response.headers.get("content-disposition") ?? "";
  const suggested =
    /filename="?([^";]+)"?/i.exec(disposition)?.[1] ?? "everse-export.json";
  const filename = suggested
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
    .slice(0, 150);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
