// Local test fixture only. Executes the real migration/RPCs in embedded PostgreSQL.
// Its Auth and Realtime transports emulate Supabase; it must never be deployed.
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomUUID, randomBytes } from "node:crypto";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { createDatabase, call, queryAs } from "../helpers/database.ts";
const db = await createDatabase();
await db.exec(`
  create function public.tetris_fixture_seed() returns trigger language plpgsql security definer set search_path='' as $$
  declare seed text:=current_setting('tetris.fixture.seed',true);
  begin
    if seed is not null and seed<>'' then new.piece_seed:=seed;perform set_config('tetris.fixture.seed','',false);end if;
    return new;
  end $$;
  revoke all on function public.tetris_fixture_seed() from public,anon,authenticated;
  create trigger tetris_test_seed before insert on public.tetris_matches for each row execute function public.tetris_fixture_seed();
`);
const users = new Map<
  string,
  {
    id: string;
    aud: string;
    role: string;
    is_anonymous: boolean;
    created_at: string;
    app_metadata: Record<string, string>;
    user_metadata: Record<string, unknown>;
  }
>();
interface Message {
  join_ref: string | null;
  ref: string | null;
  topic: string;
  event: string;
  payload: Record<string, unknown>;
}
interface Connection {
  topic: string;
  userId: string;
  key: string;
  joinRef: string | null;
  presence: Record<string, unknown> | null;
}
const connections = new Map<WebSocket, Map<string, Connection>>();
let duplicateAttacks = false,
  dropAckUntil = 0,
  dropNextAck = false;
const send = (socket: WebSocket, message: Message) => {
  if (socket.readyState === WebSocket.OPEN)
    socket.send(
      JSON.stringify([
        message.join_ref,
        message.ref,
        message.topic,
        message.event,
        message.payload,
      ]),
    );
};
function notify(
  topic: string,
  event: string,
  payload: unknown,
  except?: WebSocket,
) {
  for (const [socket, channels] of connections)
    if (socket !== except && channels.has(topic))
      send(socket, {
        join_ref: channels.get(topic)!.joinRef,
        ref: null,
        topic,
        event: "broadcast",
        payload: { type: "broadcast", event, payload },
      });
}
function presence(topic: string) {
  const state: Record<string, { metas: Record<string, unknown>[] }> = {};
  for (const channels of connections.values()) {
    const c = channels.get(topic);
    if (c?.presence)
      state[c.key] = { metas: [{ ...c.presence, phx_ref: c.key }] };
  }
  for (const [socket, channels] of connections)
    if (channels.has(topic))
      send(socket, {
        join_ref: channels.get(topic)!.joinRef,
        ref: null,
        topic,
        event: "presence_state",
        payload: state,
      });
}
async function flush() {
  const rows = await db.query<{ topic: string; payload: unknown }>(
    "delete from realtime.messages returning topic,payload",
  );
  for (const row of rows.rows)
    notify(`realtime:${row.topic}`, "room_changed", row.payload);
}
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, content-profile, accept-profile, prefer, x-client-info, x-supabase-api-version",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};
function respond(res: ServerResponse, value: unknown, status = 200) {
  res.writeHead(status, headers);
  res.end(JSON.stringify(value));
}
async function body(req: IncomingMessage) {
  let value = "";
  for await (const chunk of req) {
    value += chunk.toString();
    if (value.length > 20000) throw new Error("too_large");
  }
  return value ? JSON.parse(value) : {};
}
function decode(raw: RawData, isBinary: boolean): Message {
  const bytes = Buffer.isBuffer(raw) ? raw : Buffer.concat(raw as Buffer[]);
  if (!isBinary) {
    const [join_ref, ref, topic, event, payload] = JSON.parse(bytes.toString());
    return { join_ref, ref, topic, event, payload };
  }
  if (bytes[0] !== 3) throw new Error("unsupported binary fixture frame");
  let offset = 7;
  const read = (size: number) => {
    const value = bytes.subarray(offset, offset + size).toString();
    offset += size;
    return value;
  };
  const join_ref = read(bytes[1]),
    ref = read(bytes[2]),
    topic = read(bytes[3]),
    event = read(bytes[4]);
  read(bytes[5]);
  return {
    join_ref,
    ref,
    topic,
    event: "broadcast",
    payload: {
      type: "broadcast",
      event,
      payload: JSON.parse(bytes.subarray(offset).toString()),
    },
  };
}
const server = createServer((req, res) => {
  void (async () => {
    if (req.method === "OPTIONS") {
      respond(res, {});
      return;
    }
    const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    if (path === "/health") {
      respond(res, { ready: true });
      return;
    }
    if (path === "/__test/chaos") {
      const args = await body(req);
      duplicateAttacks = Boolean(args.duplicateAttacks);
      dropNextAck = Boolean(args.dropNextAck);
      dropAckUntil = 0;
      respond(res, { ok: true });
      return;
    }
    if (path === "/__test/seed") {
      const args = await body(req);
      await db.query("select set_config('tetris.fixture.seed',$1,false)", [
        String(args.seed),
      ]);
      respond(res, { ok: true });
      return;
    }
    if (path === "/auth/v1/signup") {
      const id = randomUUID(),
        now = new Date().toISOString(),
        claims = {
          sub: id,
          exp: Math.floor(Date.now() / 1000) + 3600,
          role: "authenticated",
          aud: "authenticated",
        };
      const token = [
        Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url"),
        Buffer.from(JSON.stringify(claims)).toString("base64url"),
        randomBytes(32).toString("base64url"),
      ].join(".");
      const user = {
        id,
        aud: "authenticated",
        role: "authenticated",
        is_anonymous: true,
        created_at: now,
        app_metadata: { provider: "anonymous" },
        user_metadata: {},
      };
      users.set(token, user);
      await db.query("insert into auth.users(id) values($1)", [id]);
      respond(res, {
        access_token: token,
        expires_in: 3600,
        expires_at: claims.exp,
        refresh_token: randomUUID(),
        token_type: "bearer",
        user,
      });
      return;
    }
    const user = users.get(
      (req.headers.authorization ?? "").replace(/^Bearer /, ""),
    );
    if (path === "/auth/v1/user") {
      respond(res, user ?? { error: "unauthorized" }, user ? 200 : 401);
      return;
    }
    if (path.startsWith("/rest/v1/rpc/")) {
      const name = path.split("/").at(-1)!;
      const args = await body(req);
      if (name === "tetris_get_leaderboard" && !user) {
        const result = await queryAs(
          db,
          null,
          "select * from public.tetris_get_leaderboard($1,$2,$3,$4)",
          [args.p_mode, args.p_rules_version, args.p_limit, args.p_offset],
        );
        respond(res, result.rows);
        return;
      }
      if (!user) {
        respond(res, { message: "unauthorized" }, 401);
        return;
      }
      if (name === "tetris_get_leaderboard") {
        const result = await queryAs(
          db,
          user.id,
          "select * from public.tetris_get_leaderboard($1,$2,$3,$4)",
          [args.p_mode, args.p_rules_version, args.p_limit, args.p_offset],
        );
        respond(res, result.rows);
        return;
      }
      respond(res, await call(db, user.id, name, args));
      await flush();
      return;
    }
    if (path === "/functions/v1/tetris-submit-finish" && user) {
      const args = await body(req);
      const member = await queryAs(
        db,
        user.id,
        "select id from public.tetris_matches where id=$1",
        [args.match_id],
      );
      if (!member.rows.length) {
        respond(res, { error: "forbidden" }, 403);
        return;
      }
      setTimeout(() => {
        void db
          .query("select public.tetris_finalize_match($1)", [args.match_id])
          .then(flush);
      }, 170);
      respond(res, { scheduled: true });
      return;
    }
    respond(res, { error: "not_found" }, 404);
  })().catch((error) => respond(res, { message: error.message }, 400));
});
const wss = new WebSocketServer({ server });
wss.on("connection", (socket) => {
  connections.set(socket, new Map());
  socket.on("message", (raw, isBinary) => {
    void (async () => {
      const message = decode(raw, isBinary),
        { topic, event, payload } = message;
      const reply = (status = "ok") =>
        send(socket, {
          ...message,
          event: "phx_reply",
          payload: { status, response: { postgres_changes: [] } },
        });
      if (event === "heartbeat") {
        reply();
        return;
      }
      if (event === "phx_join") {
        const user = users.get(String(payload.access_token));
        const member = user
          ? (
              await queryAs<{ allowed: boolean }>(
                db,
                user.id,
                "select public.tetris_topic_member($1) allowed",
                [topic.replace(/^realtime:/, "")],
              )
            ).rows[0].allowed
          : false;
        if (!user || !member) {
          reply("error");
          return;
        }
        const config = payload.config as { presence?: { key?: string } };
        connections.get(socket)!.set(topic, {
          topic,
          userId: user.id,
          key: config.presence?.key ?? randomUUID(),
          joinRef: message.ref,
          presence: null,
        });
        reply();
        presence(topic);
        return;
      }
      const connection = connections.get(socket)?.get(topic);
      if (!connection) {
        reply("error");
        return;
      }
      if (event === "phx_leave") {
        connections.get(socket)!.delete(topic);
        reply();
        presence(topic);
        return;
      }
      if (event === "presence") {
        connection.presence =
          payload.event === "track"
            ? (payload.payload as Record<string, unknown>)
            : null;
        reply();
        presence(topic);
        return;
      }
      if (event === "broadcast") {
        const envelope = payload.payload as { kind?: string };
        if (envelope?.kind === "attack_ack" && dropNextAck) {
          dropNextAck = false;
          dropAckUntil = Date.now() + 1100;
        }
        if (envelope?.kind !== "attack_ack" || Date.now() >= dropAckUntil) {
          notify(topic, String(payload.event), payload.payload, socket);
          if (duplicateAttacks && envelope?.kind === "attack")
            notify(topic, String(payload.event), payload.payload, socket);
        }
        reply();
        return;
      }
      reply();
    })().catch(() => socket.close());
  });
  socket.on("close", () => {
    const topics = [...(connections.get(socket)?.keys() ?? [])];
    connections.delete(socket);
    topics.forEach(presence);
  });
});
setInterval(() => {
  void db
    .query("select public.tetris_sweep()")
    .then(flush)
    .catch(() => {});
}, 250).unref();
server.listen(54329, "127.0.0.1", () =>
  console.log("Local PostgreSQL/Auth/Realtime test fixture ready on 54329"),
);
