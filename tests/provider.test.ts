import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { generate } from "../server/provider.js";

test("Chat Completions HTTP SSE supports split chunks without tools", async () => {
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += String(chunk);
    const input = JSON.parse(body) as Record<string, unknown>;
    assert.equal(request.url, "/v1/chat/completions");
    assert.equal(input.stream, true);
    assert.equal(input.tools, undefined);
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.write('data: {"choices":[{"delta":{"content":"你好"}}]}\n');
    response.end("\ndata: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    let result = "";
    for await (const text of generate(
      {
        baseUrl: "http://127.0.0.1:" + address.port + "/v1",
        apiKey: "",
        model: "test",
        mock: false,
      },
      [{ role: "user", content: "你好" }],
      128,
    ))
      result += text;
    assert.equal(result, "你好");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
