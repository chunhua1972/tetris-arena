import { createServer } from "vite";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
const server = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
});
try {
  const { replayRun } = await server.ssrLoadModule("/src/domain/replay.ts");
  const replay = JSON.parse(
    await readFile(
      new URL("../tests/fixtures/arena-v1.json", import.meta.url),
      "utf8",
    ),
  );
  const game = replayRun(replay);
  console.log(
    createHash("sha256")
      .update(JSON.stringify({ ...game, board: Array.from(game.board) }))
      .digest("hex"),
  );
} finally {
  await server.close();
}
