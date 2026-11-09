import mammoth from "mammoth";
import { fromBuffer, type Entry } from "yauzl";

export const documentLimit = 2 * 1024 * 1024;
const expandedLimit = 12 * 1024 * 1024;
const notice =
  "仅导入正文、标题文字和表格中的文字，保留段落分隔；不保留字体、编号和表格布局，不识别图片中的文字。页眉页脚、批注、修订等高级内容可能不完整，请核对提取结果。原始 Word 文件已在本机保留。";

// Inspect and drain each entry before handing the bounded archive to the converter.
// Nothing is extracted to disk, and entry names never become filesystem paths.
async function inspectArchive(buffer: Buffer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    fromBuffer(
      buffer,
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
      (error, zip) => {
        if (error || !zip)
          return reject(
            new Error("文件不是有效的 DOCX，可能已损坏或有密码保护"),
          );
        let total = 0,
          declared = 0,
          count = 0,
          stopped = false;
        const names = new Set<string>();
        const fail = (message: string) => {
          if (stopped) return;
          stopped = true;
          zip.close();
          reject(new Error(message));
        };
        zip.on("error", () => fail("Word 压缩内容损坏，无法安全读取"));
        zip.on("entry", (entry: Entry) => {
          count++;
          declared += entry.uncompressedSize;
          if (count > 1000 || declared > expandedLimit)
            return fail("Word 解压内容过大，请拆分文档后导入");
          if (entry.isEncrypted())
            return fail("不支持加密 Word，请另存为无密码的 DOCX");
          if (names.has(entry.fileName))
            return fail("Word 中有重复文件条目，无法安全读取");
          names.add(entry.fileName);
          if (/vbaProject\.bin$/i.test(entry.fileName))
            return fail("不支持带宏的文档，请另存为普通 DOCX");
          zip.openReadStream(entry, (error, stream) => {
            if (error || !stream) return fail("Word 压缩内容无法读取");
            const xml: Buffer[] = [];
            stream.on("error", () => fail("Word 解压长度不符或内容损坏"));
            stream.on("data", (chunk: Buffer) => {
              total += chunk.length;
              if (total > expandedLimit) {
                stream.destroy();
                fail("Word 解压内容过大，请拆分文档后导入");
                return;
              }
              if (/\.(xml|rels)$/i.test(entry.fileName)) xml.push(chunk);
            });
            stream.on("end", () => {
              if (stopped) return;
              if (xml.length) {
                const content = Buffer.concat(xml)
                  .toString("utf8")
                  .replace(/\0/g, "");
                if (/<!DOCTYPE|<!ENTITY/i.test(content))
                  return fail("不支持包含自定义 XML 实体的文档");
              }
              zip.readEntry();
            });
          });
        });
        zip.on("end", () => {
          if (stopped) return;
          if (
            !names.has("word/document.xml") ||
            !names.has("[Content_Types].xml")
          )
            return fail("文件不是标准 DOCX 文档");
          resolve();
        });
        zip.readEntry();
      },
    );
  });
}

export async function extractWord(buffer: Buffer, name: string) {
  if (!/\.docx$/i.test(name))
    throw new Error(
      "仅支持 Word .docx；旧版 .doc 请在 Word 或 WPS 中另存为 .docx 后导入",
    );
  if (!buffer.length || buffer.length > documentLimit)
    throw new Error("Word 文件上限为 2 MB，请拆分或移除大图片后导入");
  await inspectArchive(buffer);
  let result;
  try {
    result = await mammoth.extractRawText({ buffer });
  } catch {
    throw new Error("无法读取此 Word 文档，请在 Word 或 WPS 中重新另存为 DOCX");
  }
  const text = result.value.trim();
  if (!text)
    throw new Error("Word 中没有可提取的正文文字；扫描件或纯图片文档暂不支持");
  const warnings = [notice];
  if (result.messages.length)
    warnings.push(
      "解析器发现未完整转换的内容，请核对原文：" +
        result.messages
          .slice(0, 10)
          .map((m) => m.message.slice(0, 300))
          .join("；"),
    );
  return { text, warnings };
}
