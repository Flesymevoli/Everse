// PNG container validation only; image pixels are never decoded or executed.
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function readPngCard(bytes: Buffer): unknown {
  if (bytes.length > 2 * 1024 * 1024) throw new Error("PNG 上限 2 MB");
  if (
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    throw new Error("不是 PNG 文件");
  const metadata = new Map<string, string>();
  let offset = 8,
    ended = false;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error("PNG 数据截断");
    const length = bytes.readUInt32BE(offset);
    if (length > bytes.length - offset - 12) throw new Error("PNG 块长度无效");
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const end = offset + 8 + length;
    if (crc32(bytes.subarray(offset + 4, end)) !== bytes.readUInt32BE(end))
      throw new Error("PNG 校验失败");
    if (offset === 8 && (type !== "IHDR" || length !== 13))
      throw new Error("PNG 缺少图像头");
    if (type === "tEXt") {
      const payload = bytes.subarray(offset + 8, end);
      const separator = payload.indexOf(0);
      if (separator > 0) {
        const key = payload.toString("latin1", 0, separator).toLowerCase();
        if ((key === "chara" || key === "ccv3") && !metadata.has(key))
          metadata.set(key, payload.toString("latin1", separator + 1));
      }
    }
    offset = end + 4;
    if (type === "IEND") {
      if (length !== 0) throw new Error("PNG 结束块无效");
      ended = true;
      break;
    }
  }
  if (!ended || offset !== bytes.length) throw new Error("PNG 结束标记无效");
  const encoded = metadata.get("ccv3") ?? metadata.get("chara");
  if (!encoded) throw new Error("PNG 未包含 chara/ccv3 角色卡数据");
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      encoded,
    )
  )
    throw new Error("角色卡 Base64 编码无效");
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        Buffer.from(encoded, "base64"),
      ),
    );
  } catch {
    throw new Error("角色卡不是有效的 UTF-8 JSON");
  }
}
