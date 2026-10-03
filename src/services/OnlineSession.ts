import type { RealtimeChannel } from "@supabase/supabase-js";
import { z } from "zod";
import { GameController } from "../controllers/GameController";
import { createGame } from "../domain/gameReducer";
import { PIECES, type GameState, type GameEffect } from "../domain/types";
import {
  decodeSnapshot,
  belongsToRound,
  encodeSnapshot,
  roomEventSchema,
  snapshotSchema,
  type RoomEvent,
} from "./eventSchemas";
import { fetchRoom, roomDtoSchema, type RoomDto } from "./roomRepository";
import { rpc, supabase } from "./supabaseClient";
import { AttackSynchronizer } from "./syncManager";
const checkpointSchema = z.object({
  matchId: z.string().uuid(),
  roundId: z.string().uuid(),
  savedAt: z.number(),
  sync: z.unknown(),
  game: z.object({
    ...snapshotSchema.shape,
    next: z.array(z.enum(PIECES)).min(5).max(13),
    rulesVersion: z.literal("arena-v1"),
    seed: z.string(),
    holdUsed: z.boolean(),
    pieceRng: z.number().int().nonnegative().max(0xffffffff),
    garbageRng: z.number().int().nonnegative().max(0xffffffff),
    lastHole: z.number().int().min(-1).max(9),
    holeRepeats: z.number().int().min(0).max(2),
    combo: z.number().int().min(-1),
    backToBack: z.boolean(),
    pendingGarbage: z
      .array(
        z.object({
          attackId: z.string(),
          holes: z.array(z.number().int().min(0).max(9)).min(1).max(12),
        }),
      )
      .max(512),
    receivedAttackIds: z.array(z.string()).max(512),
    gravityMs: z.number().min(0),
    groundedMs: z.number().min(0),
    lockResets: z.number().int().min(0).max(15),
    attacksSent: z.number().int().nonnegative(),
    attacksReceived: z.number().int().nonnegative(),
    lastClear: z.string(),
    scoreOverflow: z.boolean(),
    topOutReason: z
      .enum(["block_out", "lock_out", "garbage_overflow"])
      .optional(),
  }),
});
export interface OnlineView {
  room: RoomDto;
  controller: GameController | null;
  canControl: boolean;
  connected: boolean;
  onlineUsers: string[];
  message: string;
}
export class OnlineSession {
  room: RoomDto;
  controller: GameController | null = null;
  canControl = false;
  connected = false;
  onlineUsers: string[] = [];
  message = "正在連接私人房間…";
  private channel: RealtimeChannel | null = null;
  private disposed = false;
  private timers: ReturnType<typeof setInterval>[] = [];
  private unsubscribeAuth: (() => void) | null = null;
  private sync: AttackSynchronizer | null = null;
  private pendingSync: string | null = null;
  private syncSince = 0;
  private lastSyncSent = 0;
  private lastSnapshotTick = -1;
  private lastSnapshotAt = 0;
  private lastSendAt = 0;
  private offset = 0;
  private seq = 0;
  private finishReportId = crypto.randomUUID();
  private finishReason: string | null = null;
  private reporting = false;
  private reported = false;
  private activating = false;
  private recordedStats = false;
  constructor(
    initial: RoomDto,
    readonly userId: string,
    readonly connectionId: string,
    private changed: () => void,
  ) {
    this.room = initial;
  }
  view(): OnlineView {
    return {
      room: this.room,
      controller: this.controller,
      canControl: this.canControl,
      connected: this.connected,
      onlineUsers: this.onlineUsers,
      message: this.message,
    };
  }
  private publish() {
    if (!this.disposed) this.changed();
  }
  private checkpointKey() {
    return `arena:match:${this.room.room.id}:${this.userId}`;
  }
  private checkpoint() {
    if (
      !this.controller ||
      !this.sync ||
      !this.room.match ||
      !this.canControl ||
      this.sync.hasGap
    )
      return;
    try {
      sessionStorage.setItem(
        this.checkpointKey(),
        JSON.stringify({
          matchId: this.room.match.id,
          roundId: this.room.match.round_id,
          savedAt: Date.now(),
          game: {
            ...this.controller.player,
            board: Array.from(this.controller.player.board).join(""),
          },
          sync: this.sync.export(),
        }),
      );
    } catch {
      /* Reconnection remains possible without reloading the page. */
    }
  }
  private accept(dto: RoomDto, sentAt = Date.now()) {
    if (this.disposed || dto.room.revision < this.room.room.revision) return;
    this.offset = Date.parse(dto.server_time) - (sentAt + Date.now()) / 2;
    const previous = this.room.match;
    this.room = dto;
    if (dto.room.status === "closed") {
      this.canControl = false;
      this.controller?.freeze(true);
      this.message = "房間已關閉，請返回大廳。";
      this.publish();
      return;
    }
    const me = dto.players.find((p) => p.user_id === this.userId);
    if (
      me?.controller_connection_id &&
      me.controller_connection_id !== this.connectionId
    ) {
      this.canControl = false;
      this.controller?.freeze(true);
      this.message = "另一個分頁正在操作此房間。";
    }
    if (
      (dto.match && dto.match.id !== previous?.id) ||
      (dto.match && !this.controller)
    )
      this.prepareMatch();
    if (previous?.status === "countdown" && dto.match?.status === "playing")
      this.requestSync();
    const match = dto.match;
    if (match && this.controller) {
      if (match.status === "resolving") {
        this.controller.freeze(true);
        this.message = "結算中，等待伺服器確認結果…";
      } else if (match.status === "finished" || match.status === "abandoned") {
        const result = dto.results.find(
          (r) => r.user_id === this.userId,
        )?.outcome;
        this.controller.setOnlineOutcome(result ?? "abandoned");
        if (!this.recordedStats && this.canControl) {
          this.recordedStats = true;
          const game = this.controller.player;
          void rpc("tetris_record_match_stats", {
            p_match_id: match.id,
            p_round_id: match.round_id,
            p_result_report_id: this.finishReportId,
            p_connection_id: this.connectionId,
            p_stats: {
              score: game.score,
              lines: game.lines,
              level: game.level,
              pieces_locked: game.lockIndex,
              attacks_sent: game.attacksSent,
              attacks_received: game.attacksReceived,
            },
          }).catch(() => {
            this.recordedStats = false;
          });
        }
        this.pendingSync = null;
        this.message =
          match.status === "abandoned"
            ? "本局同步中止，未計入勝負。"
            : "對局已結束。";
      }
    }
    this.publish();
  }
  private prepareMatch() {
    const match = this.room.match;
    if (!match) return;
    this.controller?.stop();
    this.lastSnapshotTick = -1;
    this.lastSnapshotAt = 0;
    this.lastSendAt = 0;
    this.seq = 0;
    this.finishReportId = crypto.randomUUID();
    this.reported = false;
    this.recordedStats = false;
    this.reporting = false;
    this.finishReason = null;
    const seat =
      this.room.players.find((p) => p.user_id === this.userId)?.seat ?? 1;
    this.controller = new GameController(
      "online",
      "normal",
      match.piece_seed,
      seat === 1 ? match.garbage_seed_1 : match.garbage_seed_2,
    );
    this.controller.setOpponent(createGame(match.piece_seed));
    this.controller.freeze(true);
    this.sync = new AttackSynchronizer(
      (attack) => {
        this.controller?.receiveGarbage({
          attackId: attack.attackId,
          holes: attack.holes,
        });
      },
      (id) => {
        void this.send({
          kind: "attack_ack",
          payload: {
            attackId: id,
            receivedAtTick: this.controller?.player.tick ?? 0,
          },
        });
      },
    );
    this.controller.onEffect((effect) => this.effect(effect));
    this.controller.onSuspended(() => this.requestSync());
    if (match.status === "playing" || match.status === "resolving") {
      try {
        const checkpoint = checkpointSchema.parse(
          JSON.parse(sessionStorage.getItem(this.checkpointKey()) ?? "null"),
        );
        if (
          checkpoint.matchId !== match.id ||
          checkpoint.roundId !== match.round_id ||
          Date.now() - checkpoint.savedAt > 20000
        )
          throw new Error("stale checkpoint");
        this.controller.player = {
          ...checkpoint.game,
          board: new Uint8Array([...checkpoint.game.board].map(Number)),
        } as GameState;
        this.sync.restore(checkpoint.sync);
        if (this.controller.player.phase === "finished")
          this.finishReason = "top_out";
      } catch {
        if (match.status === "playing") {
          this.message = "此局無法從本機恢復，正在中止同步。";
          this.finishReason = "sync_failed";
        }
      }
    }
    if (match.status === "countdown") this.message = "雙方已準備，倒數開始…";
    else if (match.status === "playing" && !this.finishReason)
      this.requestSync();
  }
  async start() {
    if (!supabase) return;
    const claim = await rpc<{ can_control: boolean }>(
      "tetris_claim_controller",
      {
        p_room_id: this.room.room.id,
        p_connection_id: this.connectionId,
        p_request_id: crypto.randomUUID(),
        p_take_over: false,
      },
    );
    if (this.disposed) return;
    this.canControl = claim.can_control;
    const sentAt = Date.now();
    this.accept(await fetchRoom(this.room.room.id), sentAt);
    if (this.disposed) return;
    await supabase.realtime.setAuth();
    if (this.disposed) return;
    this.channel = supabase.channel(`tetris:room:${this.room.room.id}`, {
      config: {
        private: true,
        broadcast: { ack: true, self: false },
        presence: { key: this.connectionId },
      },
    });
    this.channel.on("broadcast", { event: "room_changed" }, () => {
      void this.refresh();
    });
    this.channel.on("broadcast", { event: "arena_event" }, ({ payload }) =>
      this.receive(payload),
    );
    this.channel.on("presence", { event: "sync" }, () => {
      const ids = new Set<string>();
      for (const values of Object.values(this.channel?.presenceState() ?? {}))
        for (const value of values) {
          const p = value as unknown as { userId?: string };
          if (
            p.userId &&
            this.room.players.some((player) => player.user_id === p.userId)
          )
            ids.add(p.userId);
        }
      this.onlineUsers = [...ids];
      this.publish();
    });
    this.channel.subscribe((status) => {
      if (this.disposed) return;
      if (status === "SUBSCRIBED") {
        this.connected = true;
        void this.channel?.track({
          userId: this.userId,
          seat: this.room.players.find((p) => p.user_id === this.userId)?.seat,
          connectionId: this.connectionId,
          enteredAt: new Date().toISOString(),
        });
        this.message = this.canControl
          ? "房間連線正常。"
          : "另一個分頁正在操作此房間。";
        void this.refresh();
        if (this.room.match?.status === "playing") this.requestSync();
      } else if (
        status === "CHANNEL_ERROR" ||
        status === "TIMED_OUT" ||
        status === "CLOSED"
      ) {
        this.connected = false;
        this.controller?.freeze(true);
        this.message = "連線中斷，正在重連（20 秒內可恢復）…";
        if (!this.syncSince) this.syncSince = Date.now();
      }
      this.publish();
    });
    const auth = supabase.auth.onAuthStateChange((event, session) => {
      if (this.disposed) return;
      if (event === "TOKEN_REFRESHED" && session)
        void supabase?.realtime
          .setAuth(session.access_token)
          .then(() => this.requestSync());
      if (event === "SIGNED_OUT") {
        this.canControl = false;
        this.connected = false;
        this.controller?.freeze(true);
        this.message = "已登出，無法繼續線上對戰。";
        this.publish();
      }
    });
    this.unsubscribeAuth = () => auth.data.subscription.unsubscribe();
    this.timers.push(
      setInterval(() => {
        void this.refresh();
      }, 2000),
      setInterval(() => {
        if (this.canControl && this.connected && !document.hidden)
          void this.heartbeat();
      }, 5000),
      setInterval(() => this.pulse(), 250),
    );
    this.publish();
  }
  async takeOver() {
    await rpc("tetris_claim_controller", {
      p_room_id: this.room.room.id,
      p_connection_id: this.connectionId,
      p_request_id: crypto.randomUUID(),
      p_take_over: true,
    });
    this.canControl = true;
    await this.refresh();
    this.requestSync();
    this.publish();
  }
  async refresh() {
    if (this.disposed) return;
    const sentAt = Date.now();
    try {
      this.accept(await fetchRoom(this.room.room.id), sentAt);
    } catch (e) {
      if (!this.disposed) {
        this.requestSync();
        this.message = "連線暫時中斷，正在重新同步…";
        if (this.room.match?.status !== "playing")
          this.message = e instanceof Error ? e.message : "無法更新房間";
        this.controller?.freeze(true);
        this.publish();
      }
    }
  }
  private async heartbeat() {
    try {
      await rpc("tetris_heartbeat", {
        p_room_id: this.room.room.id,
        p_connection_id: this.connectionId,
      });
    } catch {
      this.requestSync();
      this.controller?.freeze(true);
      this.message = "心跳暫時中斷，正在重新確認房間。";
      await this.refresh();
      this.publish();
    }
  }
  private async send(event: { kind: RoomEvent["kind"]; payload: unknown }) {
    if (
      !this.channel ||
      this.channel.state !== "joined" ||
      !this.connected ||
      !this.room.match ||
      !this.canControl ||
      this.disposed
    )
      return;
    const payload = {
      v: 1,
      eventId: crypto.randomUUID(),
      roomId: this.room.room.id,
      matchId: this.room.match.id,
      roundId: this.room.match.round_id,
      senderId: this.userId,
      connectionId: this.connectionId,
      seq: event.kind === "snapshot" ? 0 : ++this.seq,
      sentAt: new Date().toISOString(),
      ...event,
    };
    try {
      const result = await this.channel.send({
        type: "broadcast",
        event: "arena_event",
        payload,
      });
      if (result !== "ok") {
        this.controller?.freeze(true);
        this.message = "訊息傳送失敗，正在重新同步…";
        this.requestSync();
      }
    } catch {
      this.requestSync();
    }
  }
  private effect(effect: GameEffect) {
    if (effect.type === "ATTACK" && this.sync) {
      try {
        const attack = this.sync.create(
          effect.packet.holes,
          effect.lockIndex,
          crypto.randomUUID(),
        );
        this.checkpoint();
        void this.send({ kind: "attack", payload: attack });
      } catch {
        this.finishReason = "sync_failed";
        this.controller?.freeze(true);
      }
    }
    if (effect.type === "GAME_OVER") {
      this.finishReason = "top_out";
      this.controller?.freeze(true);
    }
    if (effect.type === "LOCK") this.checkpoint();
  }
  private receive(raw: unknown) {
    if (
      this.disposed ||
      !this.room.match ||
      !this.sync ||
      !this.controller ||
      !this.canControl ||
      !["countdown", "playing", "resolving"].includes(this.room.match.status)
    )
      return;
    if (!raw || typeof raw !== "object" || JSON.stringify(raw).length > 2048)
      return;
    const parsed = roomEventSchema.safeParse(raw);
    if (!parsed.success) return;
    const event = parsed.data;
    const opponent = this.room.players.find((p) => p.user_id !== this.userId);
    if (
      !opponent ||
      !opponent.controller_connection_id ||
      !belongsToRound(event, {
        roomId: this.room.room.id,
        matchId: this.room.match.id,
        roundId: this.room.match.round_id,
        opponentId: opponent.user_id,
        connectionId: opponent.controller_connection_id,
      })
    )
      return;
    try {
      if (event.kind === "attack") {
        this.sync.receive(event.payload);
        this.checkpoint();
        if (this.sync.hasGap) {
          this.requestSync();
          this.message = "攻擊訊息等待補齊，正在同步…";
        }
      } else if (event.kind === "attack_ack") {
        this.sync.ack(event.payload.attackId);
        this.checkpoint();
      } else if (
        event.kind === "snapshot" &&
        event.payload.tick > this.lastSnapshotTick
      ) {
        this.lastSnapshotTick = event.payload.tick;
        this.lastSnapshotAt = Date.now();
        this.controller.setOpponent(decodeSnapshot(event.payload));
      } else if (event.kind === "game_over") {
        this.controller.freeze(true);
        this.message = "對手已回報結束，等待伺服器判定…";
        void this.refresh();
      } else if (event.kind === "resync_request") {
        for (const attack of this.sync.resendFrom(event.payload.nextAttackSeq))
          void this.send({ kind: "attack", payload: attack });
        if (!event.payload.response) {
          void this.send({
            kind: "snapshot",
            payload: encodeSnapshot(this.controller.player),
          });
          void this.send({
            kind: "resync_request",
            payload: {
              requestId: event.payload.requestId,
              nextAttackSeq: this.sync.nextExpected,
              response: true,
            },
          });
        } else if (
          event.payload.requestId === this.pendingSync &&
          !this.sync.hasGap
        ) {
          this.pendingSync = null;
          this.syncSince = 0;
          if (this.room.match.status === "playing" && !this.finishReason) {
            this.controller.freeze(false);
            this.message = "已同步，對戰進行中。";
          }
        }
      }
      this.publish();
    } catch {
      this.finishReason = "sync_failed";
      this.controller.freeze(true);
      this.message = "同步無法恢復，本局中止。";
      this.publish();
    }
  }
  requestSync() {
    if (
      this.disposed ||
      !this.controller ||
      !this.canControl ||
      this.room.match?.status !== "playing"
    )
      return;
    this.controller.freeze(true);
    if (!this.pendingSync) {
      this.pendingSync = crypto.randomUUID();
      this.syncSince = Date.now();
    }
    this.lastSyncSent = 0;
    this.message = "正在同步對局，請稍候…";
    this.publish();
  }
  private pulse() {
    if (this.disposed) return;
    const match = this.room.match;
    if (!match || !this.controller || !this.canControl) return;
    const now = Date.now();
    if (
      match.status === "countdown" &&
      now + this.offset >= Date.parse(match.start_at) &&
      !this.activating
    ) {
      this.activating = true;
      void rpc("tetris_activate_match", {
        p_match_id: match.id,
        p_request_id: crypto.randomUUID(),
      })
        .then((data) => {
          if (!this.disposed) {
            this.accept(roomDtoSchema.parse(data));
            this.requestSync();
          }
        })
        .catch(() => {
          this.message = "等待伺服器確認開局…";
        })
        .finally(() => {
          this.activating = false;
        });
    }
    if (match.status !== "playing" && match.status !== "resolving") return;
    if (this.pendingSync && this.connected && now - this.lastSyncSent >= 1000) {
      this.lastSyncSent = now;
      void this.send({
        kind: "resync_request",
        payload: {
          requestId: this.pendingSync,
          nextAttackSeq: this.sync?.nextExpected ?? 1,
          response: false,
        },
      });
    }
    if (this.syncSince && now - this.syncSince > 19000) {
      this.finishReason = "sync_failed";
      this.controller.freeze(true);
    }
    if (this.connected) {
      for (const attack of this.sync?.retries(now) ?? [])
        void this.send({ kind: "attack", payload: attack });
      if (now - this.lastSendAt >= 250) {
        this.lastSendAt = now;
        void this.send({
          kind: "snapshot",
          payload: encodeSnapshot(this.controller.player),
        });
        this.checkpoint();
      }
    }
    if (
      !this.pendingSync &&
      !this.finishReason &&
      match.status === "playing" &&
      this.lastSnapshotAt &&
      now - this.lastSnapshotAt > 5000
    ) {
      this.requestSync();
      this.message = "對手連線中斷，等待重連…";
    } else if (
      !this.pendingSync &&
      !this.finishReason &&
      this.lastSnapshotAt &&
      now - this.lastSnapshotAt > 2000
    ) {
      this.message = "對手畫面延遲，對局仍在進行。";
      this.publish();
    }
    if (
      this.finishReason &&
      !this.reporting &&
      !this.reported &&
      this.connected
    )
      void this.reportFinish();
  }
  private async reportFinish() {
    if (!supabase || !this.room.match || !this.controller || !this.finishReason)
      return;
    this.reporting = true;
    const match = this.room.match,
      game = this.controller.player;
    const args = {
      p_match_id: match.id,
      p_round_id: match.round_id,
      p_result_report_id: this.finishReportId,
      p_reason: this.finishReason,
      p_connection_id: this.connectionId,
      p_stats: {
        score: game.score,
        lines: game.lines,
        level: game.level,
        pieces_locked: game.lockIndex,
        attacks_sent: game.attacksSent,
        attacks_received: game.attacksReceived,
      },
    };
    try {
      const data = await rpc("tetris_report_finish", args);
      this.reported = true;
      this.accept(roomDtoSchema.parse(data));
      void this.send({
        kind: "game_over",
        payload: { reason: this.finishReason },
      });
      void supabase.functions
        .invoke("tetris-submit-finish", { body: { match_id: match.id } })
        .then(() => this.refresh())
        .catch(() => this.refresh());
    } catch (e) {
      this.message = `結果尚未確認，將重試：${e instanceof Error ? e.message : "連線失敗"}`;
      this.publish();
    } finally {
      this.reporting = false;
    }
  }
  async leave() {
    await rpc("tetris_leave_room", {
      p_room_id: this.room.room.id,
      p_request_id: crypto.randomUUID(),
      p_connection_id: this.connectionId,
    });
  }
  countdown() {
    return (
      Math.max(
        0,
        Math.ceil(
          (Date.parse(this.room.match?.start_at ?? "") -
            (Date.now() + this.offset)) /
            1000,
        ),
      ) || 0
    );
  }
  dispose() {
    this.checkpoint();
    this.disposed = true;
    this.timers.forEach(clearInterval);
    this.timers = [];
    this.controller?.stop();
    this.unsubscribeAuth?.();
    if (this.channel) {
      void this.channel.untrack();
      void supabase?.removeChannel(this.channel);
      this.channel = null;
    }
  }
}
