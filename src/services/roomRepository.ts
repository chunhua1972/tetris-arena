import { z } from "zod";
import { rpc } from "./supabaseClient";
const roomSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  owner_id: z.string().uuid(),
  status: z.enum(["waiting", "countdown", "playing", "finished", "closed"]),
  current_match_id: z.string().uuid().nullable(),
  revision: z.number(),
  expires_at: z.string(),
});
const playerSchema = z.object({
  user_id: z.string().uuid(),
  seat: z.number(),
  ready: z.boolean(),
  rematch_ready: z.boolean(),
  display_name: z.string(),
  controller_connection_id: z.string().uuid().nullable(),
  last_seen_at: z.string(),
});
const matchSchema = z.object({
  id: z.string().uuid(),
  round_id: z.string().uuid(),
  status: z.enum([
    "pending",
    "countdown",
    "playing",
    "resolving",
    "finished",
    "abandoned",
  ]),
  rules_version: z.literal("arena-v1"),
  piece_seed: z.string(),
  garbage_seed_1: z.string(),
  garbage_seed_2: z.string(),
  start_at: z.string(),
  winner_user_id: z.string().uuid().nullable(),
  finish_reason: z.string().nullable(),
});
export const roomDtoSchema = z.object({
  room: roomSchema,
  players: z.array(playerSchema).max(2),
  match: matchSchema.nullable(),
  server_time: z.string(),
  results: z.array(
    z.object({
      user_id: z.string().uuid(),
      outcome: z.enum(["win", "loss", "draw", "abandoned"]).nullable(),
      score: z.number(),
      lines: z.number(),
    }),
  ),
});
export type RoomDto = z.infer<typeof roomDtoSchema>;
export async function fetchRoom(id: string) {
  return roomDtoSchema.parse(await rpc("tetris_get_room", { p_room_id: id }));
}
export async function createRoom() {
  return roomDtoSchema.parse(
    await rpc("tetris_create_room", { p_request_id: crypto.randomUUID() }),
  );
}
export async function joinRoom(code: string) {
  return roomDtoSchema.parse(
    await rpc("tetris_join_room", {
      p_code: code,
      p_request_id: crypto.randomUUID(),
    }),
  );
}
export async function setReady(
  room: RoomDto,
  connectionId: string,
  rematch = false,
) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return roomDtoSchema.parse(
        await rpc(rematch ? "tetris_set_rematch" : "tetris_set_ready", {
          p_room_id: room.room.id,
          p_ready: true,
          p_expected_revision: room.room.revision,
          p_request_id: crypto.randomUUID(),
          p_connection_id: connectionId,
        }),
      );
    } catch (error) {
      if (
        attempt ||
        !(error instanceof Error) ||
        !error.message.includes("房間狀態已更新")
      )
        throw error;
      room = await fetchRoom(room.room.id);
      if (room.match?.status === "countdown") return room;
    }
  }
  throw new Error("無法更新準備狀態");
}
