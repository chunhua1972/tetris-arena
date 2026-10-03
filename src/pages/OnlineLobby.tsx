import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Copy, Globe, Link, Users } from "lucide-react";
import { GameScreen } from "../components/GameScreen";
import { OnlineSession, type OnlineView } from "../services/OnlineSession";
import {
  createRoom,
  joinRoom,
  setReady,
  type RoomDto,
} from "../services/roomRepository";
import {
  cloudError,
  ensureUser,
  rpc,
  supabase,
} from "../services/supabaseClient";
export function OnlineLobby({
  name,
  onBack,
  onPlayingChange,
}: {
  name: string;
  onBack: () => void;
  onPlayingChange: (playing: boolean) => void;
}) {
  const [room, setRoom] = useState<RoomDto | null>(null),
    [userId, setUserId] = useState(""),
    [code, setCode] = useState(
      () =>
        new URLSearchParams(window.location.hash.slice(1)).get("room") ?? "",
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const enter = async (create: boolean) => {
    setBusy(true);
    setError("");
    try {
      const user = await ensureUser();
      await rpc("tetris_update_profile", {
        p_display_name: name,
        p_request_id: crypto.randomUUID(),
      });
      setUserId(user.id);
      const data = await (create ? createRoom() : joinRoom(code));
      setRoom(data);
      window.history.replaceState(null, "", `#room=${data.room.code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "連線失敗");
    } finally {
      setBusy(false);
    }
  };
  if (room)
    return (
      <OnlineRoom
        initial={room}
        userId={userId}
        onPlayingChange={onPlayingChange}
        onBack={() => {
          window.history.replaceState(null, "", window.location.pathname);
          onBack();
        }}
      />
    );
  return (
    <main className="standard-page">
      <span className="eyebrow">BETTER TOGETHER</span>
      <h1>好友對戰</h1>
      <p className="page-description">
        一個房碼，一場對決。與朋友分享你的競技場。
      </p>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {supabase ? (
        <>
          <div className="online-grid">
            <section className="panel">
              <Users size={30} color="#c4f36a" />
              <h2>開一間房間</h2>
              <p>建立私人雙人房，將房碼分享給朋友。雙方準備後，一起開始。</p>
              <button
                className="button primary wide"
                disabled={busy}
                onClick={() => enter(true)}
              >
                {busy ? "連線中…" : "建立私人房間"}
              </button>
            </section>
            <section className="panel">
              <Link size={30} color="#b397f7" />
              <h2>加入朋友的房間</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void enter(false);
                }}
              >
                <label htmlFor="room-code">6 位房間碼</label>
                <input
                  id="room-code"
                  placeholder="ABC234"
                  value={code}
                  maxLength={8}
                  autoCapitalize="characters"
                  autoComplete="off"
                  onChange={(e) =>
                    setCode(
                      e.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ""),
                    )
                  }
                />
                <button
                  className="button secondary wide"
                  disabled={busy || code.length < 6}
                  type="submit"
                >
                  加入房間
                </button>
              </form>
            </section>
          </div>
          <p className="subtle-note">
            首次連線會匿名登入。清除瀏覽資料或登出後，匿名帳號的紀錄可能無法恢復。對戰需全程保持網路，離線逾
            20 秒由伺服器判定棄權。
          </p>
        </>
      ) : (
        <section className="panel setup-card">
          <Globe size={34} />
          <h2>好友對戰尚未啟用</h2>
          <p>
            {cloudError ||
              "單人與 AI 已可直接遊玩。連接 Supabase 後，即可建立好友房間與使用雲端休閒榜。"}
          </p>
          <p>
            線上服務啟用後，即可分享房碼邀請朋友。現在可以先挑戰單人與 AI 模式。
          </p>
          <button className="button secondary" onClick={onBack}>
            <ArrowLeft size={16} />
            返回遊戲大廳
          </button>
        </section>
      )}
    </main>
  );
}
function OnlineRoom({
  initial,
  userId,
  onBack,
  onPlayingChange,
}: {
  initial: RoomDto;
  userId: string;
  onBack: () => void;
  onPlayingChange: (playing: boolean) => void;
}) {
  const connectionId = useRef(crypto.randomUUID()),
    [session, setSession] = useState<OnlineSession | null>(null),
    [view, setView] = useState<OnlineView>({
      room: initial,
      controller: null,
      canControl: false,
      connected: false,
      onlineUsers: [],
      message: "連線中…",
    }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(false),
    [countdown, setCountdown] = useState(3);
  useEffect(() => {
    let active = true;
    const instance = new OnlineSession(
      initial,
      userId,
      connectionId.current,
      () => {
        if (active) {
          setView(instance.view());
          setCountdown(instance.countdown());
        }
      },
    );
    setSession(instance);
    void instance.start().catch((e) => {
      if (active) setError(e.message);
    });
    const timer = setInterval(() => {
      if (active) setCountdown(instance.countdown());
    }, 200);
    return () => {
      active = false;
      clearInterval(timer);
      instance.dispose();
    };
  }, [initial, userId]);
  const leave = async () => {
    if (!session || busy) return;
    setBusy(true);
    try {
      if (view.canControl) await session.leave();
      session.dispose();
      onBack();
    } catch (e) {
      setError(e instanceof Error ? e.message : "離房失敗，請重試");
    } finally {
      setBusy(false);
    }
  };
  const ready = async (rematch = false) => {
    if (!session) return;
    setBusy(true);
    setError("");
    try {
      await setReady(view.room, connectionId.current, rematch);
      await session.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失敗");
      await session.refresh();
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(view.room.room.code);
      setCopied(true);
    } catch {
      setError(`房間碼：${view.room.room.code}，可直接選取複製。`);
    }
  };
  const match = view.room.match,
    me = view.room.players.find((p) => p.user_id === userId),
    opponent = view.room.players.find((p) => p.user_id !== userId);
  useEffect(() => {
    onPlayingChange(Boolean(match && match.status !== "countdown"));
    return () => onPlayingChange(false);
  }, [match?.status, onPlayingChange]);
  if (view.controller && match && match.status !== "countdown")
    return (
      <>
        <GameScreen
          key={match.id}
          controller={view.controller}
          playerName={me?.display_name}
          opponentName={opponent?.display_name ?? "對手"}
          onBack={() => void leave()}
          onRestart={() => void ready(true)}
          onRematch={() => void ready(true)}
          rematchWaiting={
            busy || Boolean(me?.rematch_ready) || !view.canControl
          }
          onlineMessage={error || view.message}
        />
        {!view.canControl && (
          <div className="room-message">
            <button
              className="button secondary"
              onClick={() => void session?.takeOver()}
            >
              接管此分頁操作
            </button>
          </div>
        )}
      </>
    );
  return (
    <main className="standard-page">
      <span className="eyebrow">YOUR PRIVATE ARENA</span>
      <h1>雙人房間</h1>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      <section className="panel room-code-panel">
        <span className="eyebrow" style={{ justifyContent: "center" }}>
          ROOM CODE
        </span>
        <strong className="room-code">{view.room.room.code}</strong>
        <button
          className="text-button"
          style={{ margin: "0 auto" }}
          onClick={copy}
        >
          {copied ? <Check size={15} /> : <Copy size={15} />}{" "}
          {copied ? "已複製房碼" : "複製房碼"}
        </button>
        <p>將房碼分享給朋友，雙方準備後就會開始。</p>
      </section>
      <div className="room-seats">
        {[1, 2].map((seat) => {
          const p = view.room.players.find((p) => p.seat === seat);
          return (
            <section
              className={`seat-card ${p?.ready || match?.status === "countdown" ? "ready" : ""}`}
              key={seat}
            >
              <div className="seat-avatar">
                {p ? p.display_name.slice(0, 1) : "＋"}
              </div>
              <strong>{p?.display_name ?? "等待朋友加入"}</strong>
              <span>
                {p
                  ? match?.status === "countdown"
                    ? "準備完成"
                    : p.ready
                      ? "準備完成"
                      : view.onlineUsers.includes(p.user_id)
                        ? "已連線 · 尚未準備"
                        : "等待連線"
                  : "將房碼分享給朋友"}
              </span>
            </section>
          );
        })}
      </div>
      {match?.status === "countdown" ? (
        <>
          <span className="countdown-number" role="status">
            {countdown || "GO"}
          </span>
          <p className="room-message">雙方已準備，等待伺服器開局。</p>
        </>
      ) : (
        <div className="room-actions">
          {view.room.room.status === "closed" ? null : view.canControl ? (
            <button
              className="button primary"
              disabled={busy || me?.ready || !view.connected || !opponent}
              onClick={() => ready()}
            >
              {me?.ready
                ? "等待對手準備"
                : !opponent
                  ? "等待朋友加入"
                  : "我準備好了"}
            </button>
          ) : (
            <button
              className="button secondary"
              disabled={!session || busy}
              onClick={() => void session?.takeOver()}
            >
              接管此分頁操作
            </button>
          )}
          <button className="button secondary" onClick={leave} disabled={busy}>
            離開房間
          </button>
        </div>
      )}
      <p className="room-message" role="status">
        {view.message}
      </p>
    </main>
  );
}
