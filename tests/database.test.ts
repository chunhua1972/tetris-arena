import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createDatabase, call, queryAs } from "./helpers/database";
import type { RoomDto } from "../src/services/roomRepository";
const a = "11111111-1111-4111-8111-111111111111",
  b = "22222222-2222-4222-8222-222222222222",
  c = "33333333-3333-4333-8333-333333333333";
const ca = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  cb = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const stats = {
  score: 1234,
  lines: 4,
  level: 1,
  pieces_locked: 10,
  attacks_sent: 4,
  attacks_received: 1,
  duration_ms: 60000,
};
let db: PGlite;
const request = () => crypto.randomUUID();
async function room() {
  const r = await call<RoomDto>(db, a, "tetris_create_room", {
    p_request_id: request(),
  });
  await call(db, a, "tetris_claim_controller", {
    p_room_id: r.room.id,
    p_connection_id: ca,
    p_request_id: request(),
  });
  return r;
}
async function pair() {
  let r = await room();
  r = await call<RoomDto>(db, b, "tetris_join_room", {
    p_code: r.room.code,
    p_request_id: request(),
  });
  await call(db, b, "tetris_claim_controller", {
    p_room_id: r.room.id,
    p_connection_id: cb,
    p_request_id: request(),
  });
  return r;
}
async function playing() {
  let r = await pair();
  r = await call<RoomDto>(db, a, "tetris_set_ready", {
    p_room_id: r.room.id,
    p_ready: true,
    p_expected_revision: r.room.revision,
    p_request_id: request(),
    p_connection_id: ca,
  });
  r = await call<RoomDto>(db, b, "tetris_set_ready", {
    p_room_id: r.room.id,
    p_ready: true,
    p_expected_revision: r.room.revision,
    p_request_id: request(),
    p_connection_id: cb,
  });
  await db.query(
    "update tetris_matches set start_at=clock_timestamp()-interval '30 seconds' where id=$1",
    [r.match!.id],
  );
  r = await call<RoomDto>(db, a, "tetris_activate_match", {
    p_match_id: r.match!.id,
    p_request_id: request(),
  });
  return r;
}
describe("PostgreSQL migrations, RLS and transactional room lifecycle", () => {
  beforeAll(async () => {
    db = await createDatabase();
  }, 60000);
  beforeEach(async () => {
    await db.exec("truncate auth.users cascade");
    await db.query("insert into auth.users(id) values($1),($2),($3)", [
      a,
      b,
      c,
    ]);
  });
  afterAll(async () => {
    await db?.close();
  });
  it("unaffiliated users cannot read private rooms, results or topics", async () => {
    const r = await pair();
    expect(
      (await queryAs(db, c, "select * from tetris_rooms")).rows,
    ).toHaveLength(0);
    expect(
      (await queryAs(db, c, "select * from tetris_room_players")).rows,
    ).toHaveLength(0);
    await expect(
      call(db, c, "tetris_get_room", { p_room_id: r.room.id }),
    ).rejects.toThrow();
    expect(
      (
        await queryAs<{ member: boolean }>(
          db,
          c,
          "select tetris_topic_member($1) member",
          [`tetris:room:${r.room.id}`],
        )
      ).rows[0].member,
    ).toBe(false);
    expect(
      (
        await queryAs<{ member: boolean }>(
          db,
          a,
          "select tetris_topic_member($1) member",
          [`tetris:room:${r.room.id}`],
        )
      ).rows[0].member,
    ).toBe(true);
    expect(
      (
        await queryAs<{ member: boolean }>(
          db,
          a,
          "select tetris_topic_member($1) member",
          [`tetris:room:${r.room.id}:other`],
        )
      ).rows[0].member,
    ).toBe(false);
  });
  it("direct score/profile writes and anonymous room creation are denied", async () => {
    await expect(
      queryAs(db, a, "update tetris_profiles set is_banned=true"),
    ).rejects.toThrow();
    await expect(
      queryAs(
        db,
        a,
        "insert into tetris_scores(user_id,mode,rules_version,score,lines,level,duration_ms,pieces_locked,client_run_id) values($1,'solo','arena-v1',999,0,1,1,1,$2)",
        [a, request()],
      ),
    ).rejects.toThrow();
    await expect(
      queryAs(db, null, "select tetris_create_room($1)", [request()]),
    ).rejects.toThrow();
    await expect(queryAs(db, a, "select tetris_sweep()")).rejects.toThrow();
  });
  it("deduplicates creation requests and rejects changed payloads", async () => {
    const id = request();
    const first = await call<RoomDto>(db, a, "tetris_create_room", {
      p_request_id: id,
    });
    const second = await call<RoomDto>(db, a, "tetris_create_room", {
      p_request_id: id,
    });
    expect(second.room.id).toBe(first.room.id);
    expect((await db.query("select * from tetris_rooms")).rows).toHaveLength(1);
    await expect(
      call(db, a, "tetris_update_profile", {
        p_request_id: id,
        p_display_name: "Different",
      }),
    ).rejects.toThrow();
  });
  it("only one guest can occupy seat two", async () => {
    const r = await room();
    const results = await Promise.all([
      call<RoomDto | { error: string }>(db, b, "tetris_join_room", {
        p_code: r.room.code,
        p_request_id: request(),
      }),
      call<RoomDto | { error: string }>(db, c, "tetris_join_room", {
        p_code: r.room.code,
        p_request_id: request(),
      }),
    ]);
    expect(results.filter((r) => "room" in r)).toHaveLength(1);
    expect(
      (await db.query("select * from tetris_room_players")).rows,
    ).toHaveLength(2);
  });
  it("two Ready updates and repeated activation produce only one match", async () => {
    const r = await playing();
    await call(db, b, "tetris_activate_match", {
      p_match_id: r.match!.id,
      p_request_id: request(),
    });
    expect((await db.query("select * from tetris_matches")).rows).toHaveLength(
      1,
    );
    expect(r.match!.status).toBe("playing");
    expect(r.match!.piece_seed).not.toBe(r.match!.garbage_seed_1);
  });
  it("a stale Ready revision is rejected without mutating ready state", async () => {
    const r = await pair();
    await call(db, a, "tetris_set_ready", {
      p_room_id: r.room.id,
      p_ready: true,
      p_expected_revision: r.room.revision,
      p_request_id: request(),
      p_connection_id: ca,
    });
    const stale = await call<{ error: string }>(db, b, "tetris_set_ready", {
      p_room_id: r.room.id,
      p_ready: true,
      p_expected_revision: r.room.revision,
      p_request_id: request(),
      p_connection_id: cb,
    });
    expect(stale.error).toBeTruthy();
    expect(
      (
        await db.query<{ ready: boolean }>(
          "select ready from tetris_room_players where user_id=$1",
          [b],
        )
      ).rows[0].ready,
    ).toBe(false);
  });
  it("another tab is read-only until explicit takeover", async () => {
    const r = await room();
    const other = request();
    const denied = await call<{ can_control: boolean }>(
      db,
      a,
      "tetris_claim_controller",
      { p_room_id: r.room.id, p_connection_id: other, p_request_id: request() },
    );
    expect(denied.can_control).toBe(false);
    await expect(
      call(db, a, "tetris_heartbeat", {
        p_room_id: r.room.id,
        p_connection_id: other,
      }),
    ).rejects.toThrow();
    await call(db, a, "tetris_claim_controller", {
      p_room_id: r.room.id,
      p_connection_id: other,
      p_request_id: request(),
      p_take_over: true,
    });
    await expect(
      call(db, a, "tetris_heartbeat", {
        p_room_id: r.room.id,
        p_connection_id: ca,
      }),
    ).rejects.toThrow();
  });
  it("finish reports are idempotent, old rounds fail, and finalization happens once", async () => {
    const r = await playing(),
      id = request();
    const args = {
      p_match_id: r.match!.id,
      p_round_id: r.match!.round_id,
      p_result_report_id: id,
      p_stats: stats,
      p_reason: "top_out",
      p_connection_id: ca,
    };
    await expect(
      call(db, a, "tetris_report_finish", { ...args, p_round_id: request() }),
    ).rejects.toThrow();
    await call(db, a, "tetris_report_finish", args);
    await call(db, a, "tetris_report_finish", args);
    await db.query(
      "update tetris_matches set resolve_after=clock_timestamp()-interval '1 second'",
    );
    await db.query("select tetris_finalize_match($1)", [r.match!.id]);
    await db.query("select tetris_finalize_match($1)", [r.match!.id]);
    const finished = await call<RoomDto>(db, a, "tetris_get_room", {
      p_room_id: r.room.id,
    });
    expect(finished.match!.winner_user_id).toBe(b);
    expect(finished.results.find((p) => p.user_id === a)?.outcome).toBe("loss");
    expect(
      (
        await db.query(
          "select * from tetris_match_players where result_report_id is not null",
        )
      ).rows,
    ).toHaveLength(1);
  });
  it("simultaneous top-outs within the server window settle as a draw", async () => {
    const r = await playing();
    for (const [user, connection] of [
      [a, ca],
      [b, cb],
    ])
      await call(db, user, "tetris_report_finish", {
        p_match_id: r.match!.id,
        p_round_id: r.match!.round_id,
        p_result_report_id: request(),
        p_stats: stats,
        p_reason: "top_out",
        p_connection_id: connection,
      });
    await db.query(
      "update tetris_match_players set top_out_at='2026-10-03T00:00:00Z'::timestamptz + case when seat=2 then interval '50 milliseconds' else interval '0 milliseconds' end",
    );
    await db.query(
      "update tetris_matches set resolve_after=clock_timestamp()-interval '1 second'",
    );
    await db.query("select tetris_sweep()");
    const result = await call<RoomDto>(db, a, "tetris_get_room", {
      p_room_id: r.room.id,
    });
    expect(result.results.every((p) => p.outcome === "draw")).toBe(true);
  });
  it("19-second reconnects survive; after 20 seconds heartbeats cannot rescue the loss", async () => {
    const r = await playing();
    await db.query(
      "update tetris_room_players set last_seen_at=clock_timestamp()-interval '19 seconds' where user_id=$1",
      [a],
    );
    await call(db, a, "tetris_heartbeat", {
      p_room_id: r.room.id,
      p_connection_id: ca,
    });
    await db.query("select tetris_sweep()");
    expect(
      (await call<RoomDto>(db, b, "tetris_get_room", { p_room_id: r.room.id }))
        .match!.status,
    ).toBe("playing");
    await db.query(
      "update tetris_room_players set last_seen_at=clock_timestamp()-interval '21 seconds' where user_id=$1",
      [a],
    );
    await expect(
      call(db, a, "tetris_heartbeat", {
        p_room_id: r.room.id,
        p_connection_id: ca,
      }),
    ).rejects.toThrow();
    await db.query("select tetris_sweep()");
    expect(
      (await call<RoomDto>(db, b, "tetris_get_room", { p_room_id: r.room.id }))
        .match!.winner_user_id,
    ).toBe(b);
  });
  it("rematches have fresh IDs/seeds while preserving previous results", async () => {
    let r = await playing();
    const old = r.match!;
    await call(db, a, "tetris_report_finish", {
      p_match_id: old.id,
      p_round_id: old.round_id,
      p_result_report_id: request(),
      p_stats: stats,
      p_reason: "top_out",
      p_connection_id: ca,
    });
    await db.query(
      "update tetris_matches set resolve_after=clock_timestamp()-interval '1 second'",
    );
    await db.query("select tetris_sweep()");
    r = await call<RoomDto>(db, a, "tetris_get_room", { p_room_id: r.room.id });
    for (const [user, connection] of [
      [a, ca],
      [b, cb],
    ])
      r = await call<RoomDto>(db, user, "tetris_set_rematch", {
        p_room_id: r.room.id,
        p_ready: true,
        p_expected_revision: r.room.revision,
        p_request_id: request(),
        p_connection_id: connection,
      });
    expect(r.match!.id).not.toBe(old.id);
    expect(r.match!.piece_seed).not.toBe(old.piece_seed);
    expect((await db.query("select * from tetris_matches")).rows).toHaveLength(
      2,
    );
  });
  it("stores scores once as unverified and exposes only safe leaderboard columns", async () => {
    const id = request(),
      args = {
        p_client_run_id: id,
        p_mode: "solo",
        p_stats: stats,
        p_rules_version: "arena-v1",
      };
    expect(await call(db, a, "tetris_submit_score", args)).toBe(
      await call(db, a, "tetris_submit_score", args),
    );
    await call(db, a, "tetris_submit_score", {
      ...args,
      p_client_run_id: request(),
      p_stats: { ...stats, score: 999 },
    });
    const rows = await queryAs<Record<string, unknown>>(
      db,
      null,
      "select * from tetris_get_leaderboard('solo','arena-v1',20,0)",
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].validation_status).toBe("unverified");
    expect(Object.keys(rows.rows[0])).not.toContain("user_id");
    expect(Object.keys(rows.rows[0])).not.toContain("client_run_id");
  });
  it("late sync failure cannot overwrite a pending top-out result", async () => {
    const r = await playing();
    await call(db, a, "tetris_report_finish", {
      p_match_id: r.match!.id,
      p_round_id: r.match!.round_id,
      p_result_report_id: request(),
      p_stats: stats,
      p_reason: "top_out",
      p_connection_id: ca,
    });
    await db.query(
      "update tetris_matches set resolve_after=clock_timestamp()-interval '1 second'",
    );
    const result = await call<RoomDto>(db, b, "tetris_report_finish", {
      p_match_id: r.match!.id,
      p_round_id: r.match!.round_id,
      p_result_report_id: request(),
      p_stats: stats,
      p_reason: "sync_failed",
      p_connection_id: cb,
    });
    expect(result.match!.winner_user_id).toBe(b);
    expect(result.match!.status).toBe("finished");
  });
  it("records the winner's stats once without changing an authoritative outcome", async () => {
    const r = await playing();
    await call(db, a, "tetris_report_finish", {
      p_match_id: r.match!.id,
      p_round_id: r.match!.round_id,
      p_result_report_id: request(),
      p_stats: stats,
      p_reason: "top_out",
      p_connection_id: ca,
    });
    await db.query(
      "update tetris_matches set resolve_after=clock_timestamp()-interval '1 second'",
    );
    await db.query("select tetris_sweep()");
    const args = {
      p_match_id: r.match!.id,
      p_round_id: r.match!.round_id,
      p_result_report_id: request(),
      p_stats: stats,
      p_connection_id: cb,
    };
    await call(db, b, "tetris_record_match_stats", args);
    await call(db, b, "tetris_record_match_stats", {
      ...args,
      p_stats: { ...stats, score: 99999 },
    });
    const results = await db.query<{ score: number; outcome: string }>(
      "select score,outcome from tetris_match_players where user_id=$1",
      [b],
    );
    expect(Number(results.rows[0].score)).toBe(stats.score);
    expect(results.rows[0].outcome).toBe("win");
  });
  it("a late client sync report cannot override a server-clock disconnect result", async () => {
    const r = await playing();
    await db.query(
      "update tetris_room_players set last_seen_at=clock_timestamp()-interval '21 seconds' where user_id=$1",
      [a],
    );
    const result = await call<RoomDto>(db, b, "tetris_report_finish", {
      p_match_id: r.match!.id,
      p_round_id: r.match!.round_id,
      p_result_report_id: request(),
      p_stats: stats,
      p_reason: "sync_failed",
      p_connection_id: cb,
    });
    expect(result.match!.winner_user_id).toBe(b);
    expect(result.match!.finish_reason).toBe("disconnect");
  });
  it("the guest can recover the closed-room notice after the owner leaves", async () => {
    const r = await pair();
    await call(db, a, "tetris_leave_room", {
      p_room_id: r.room.id,
      p_request_id: request(),
      p_connection_id: ca,
    });
    expect(
      (await call<RoomDto>(db, b, "tetris_get_room", { p_room_id: r.room.id }))
        .room.status,
    ).toBe("closed");
    await expect(
      call(db, c, "tetris_get_room", { p_room_id: r.room.id }),
    ).rejects.toThrow();
  });
});
