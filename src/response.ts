/** Do not expose proxy HTML or raw response bodies in user-facing errors. */
export async function readJson(response: Response) {
  const text = await response.text();
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
  if (!response.ok)
    throw new Error(typeof data?.error === "string" ? data.error : "请求失败，请稍后重试。");
  return data;
}
