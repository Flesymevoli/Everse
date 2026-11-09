import { execFile } from "node:child_process";
import { join } from "node:path";
export interface SecretProtector {
  protect(value: string): Promise<string>;
  unprotect(value: string): Promise<string>;
}
function transform(value: string, decrypt: boolean): Promise<string> {
  if (process.platform !== "win32")
    return Promise.reject(
      new Error("当前仅支持 Windows 用户加密保存；没有明文回退"),
    );
  const operation = decrypt ? "Unprotect" : "Protect";
  // Legacy entropy is deliberately stable across the Everse rename, so existing keys decrypt.
  const script = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $e=[Text.Encoding]::UTF8.GetBytes('YunoTavern.connections.v1'); $r=[Security.Cryptography.ProtectedData]::${operation}($b,$e,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r))`;
  return new Promise((resolve, reject) => {
    const child = execFile(
      join(
        process.env.SystemRoot ?? "C:\\Windows",
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      ),
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, timeout: 15000, maxBuffer: 100000 },
      (error, stdout) => {
        if (error)
          return reject(
            new Error("Windows 密钥保护失败；请确认使用保存时的 Windows 账号"),
          );
        resolve(
          decrypt
            ? Buffer.from(stdout.trim(), "base64").toString("utf8")
            : stdout.trim(),
        );
      },
    );
    child.stdin?.on("error", () => {});
    child.stdin?.end(
      decrypt ? value : Buffer.from(value, "utf8").toString("base64"),
    );
  });
}
export const windowsProtector: SecretProtector = {
  protect: (value) => transform(value, false),
  unprotect: (value) => transform(value, true),
};
