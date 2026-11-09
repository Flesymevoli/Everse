/** Do not expose proxy HTML or raw response bodies in user-facing errors. */
export async function readJson(response: Response) {
  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new Error(
      "读取本地服务响应时连接中断。请重新读取；若刚才在保存，请先核对结果，不要重复提交。",
    );
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      response.status >= 500 || !text.trim()
        ? "本地服务暂时不可用，请确认启动窗口仍在运行，再刷新页面。存档没有被删除。"
        : "本地服务返回了无法识别的数据，请重启应用后刷新页面。",
    );
  }
  if (data === null || typeof data !== "object")
    throw new Error("本地服务返回了不完整的数据，请重启应用后重新读取。");
  if (!response.ok)
    throw new Error(
      typeof data?.error === "string" ? data.error : "请求失败，请稍后重试。",
    );
  return data;
}

/** No automatic retries: a failed response may already have performed a write. */
export async function fetchLocal(path: string, init?: RequestInit) {
  try {
    return await fetch(path, init);
  } catch (error) {
    if (init?.signal?.aborted) throw error;
    throw new Error(
      "无法连接本地服务，请确认启动窗口仍在运行。若刚才在保存，请恢复连接后核对结果，不要重复提交。",
    );
  }
}

export async function requestJson<T>(path: string, body?: unknown): Promise<T> {
  return readJson(
    await fetchLocal(
      "/api/" + path,
      body === undefined
        ? {}
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
    ),
  );
}
