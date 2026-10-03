import { useEffect, useState, useSyncExternalStore } from "react";
import {
  ArrowLeft,
  Download,
  Pause,
  Play,
  RotateCcw,
  Trophy,
  WifiOff,
} from "lucide-react";
import { BoardCanvas } from "./BoardCanvas";
import { PiecePreview } from "./PiecePreview";
import { TouchControls } from "./TouchControls";
import type { GameController } from "../controllers/GameController";
import {
  bestScore,
  saveLocalScore,
  type LocalScore,
} from "../services/storage";
import { ensureUser, rpc, supabase } from "../services/supabaseClient";
import { STEP_MS } from "../domain/rules/arenaV1";
export function GameScreen({
  controller,
  onBack,
  onRestart,
  onlineMessage,
  opponentName = "ARENA BOT",
  playerName = "你",
  ready = true,
  onRematch,
  rematchWaiting = false,
}: {
  controller: GameController;
  onBack: () => void;
  onRestart: () => void;
  onlineMessage?: string;
  opponentName?: string;
  playerName?: string;
  ready?: boolean;
  onRematch?: () => void;
  rematchWaiting?: boolean;
}) {
  const view = useSyncExternalStore(
      controller.subscribe,
      controller.getSnapshot,
    ),
    game = view.player,
    opponent = view.opponent;
  const [runId] = useState(() => crypto.randomUUID()),
    [saved, setSaved] = useState<LocalScore | null>(null),
    [upload, setUpload] = useState(""),
    [uploading, setUploading] = useState(false),
    [leavePrompt, setLeavePrompt] = useState(false);
  const finished =
    controller.mode === "online"
      ? Boolean(view.outcome)
      : game.phase === "finished" || Boolean(view.outcome);
  useEffect(() => {
    if (ready) controller.start();
    return () => controller.stop();
  }, [controller, ready]);
  useEffect(() => {
    if (finished && controller.mode !== "online")
      setSaved(
        saveLocalScore(
          game,
          controller.mode,
          controller.difficulty,
          view.outcome === "abandoned" ? null : view.outcome,
          runId,
        ),
      );
  }, [finished, controller, game, runId, view.outcome]);
  const duration = Math.floor((game.tick * STEP_MS) / 1000),
    time = `${Math.floor(duration / 60)
      .toString()
      .padStart(2, "0")}:${(duration % 60).toString().padStart(2, "0")}`;
  const duel = controller.mode !== "solo";
  const title =
    controller.mode === "solo"
      ? "單人挑戰"
      : controller.mode === "ai"
        ? `AI 對戰 · ${controller.difficulty === "easy" ? "簡單" : "普通"}`
        : "好友對戰";
  const paused = game.phase === "paused";
  const askLeave = () => {
    if (!finished && ready) {
      if (controller.mode !== "online" && !paused) controller.togglePause();
      setLeavePrompt(true);
    } else onBack();
  };
  const downloadReplay = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(controller.replay, null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `arena-${runId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const uploadScore = async () => {
    if (!saved || uploading) return;
    setUploading(true);
    try {
      await ensureUser();
      await rpc("tetris_submit_score", {
        p_client_run_id: saved.id,
        p_mode: saved.mode,
        p_rules_version: "arena-v1",
        p_difficulty: saved.mode === "ai" ? saved.difficulty : null,
        p_outcome: saved.outcome,
        p_stats: saved,
      });
      setUpload("已上傳至休閒榜");
    } catch (e) {
      setUpload(e instanceof Error ? e.message : "上傳失敗，成績仍保留在本機");
    } finally {
      setUploading(false);
    }
  };
  return (
    <main className="game-page">
      <div className="game-heading">
        <button
          className="icon-button"
          aria-label="返回大廳"
          onClick={askLeave}
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <span className="eyebrow">LET’S PLAY</span>
          <h1>{title}</h1>
        </div>
        <div className="game-tools">
          <span className="time-label">{time}</span>
          {controller.mode !== "online" && (
            <button
              className="icon-button"
              aria-label={paused ? "繼續遊戲" : "暫停遊戲"}
              onClick={() => controller.togglePause()}
              disabled={finished}
            >
              {paused ? <Play size={19} /> : <Pause size={19} />}
            </button>
          )}
        </div>
      </div>
      <div className="game-stats" aria-label="目前遊戲數據">
        <div>
          <span>分數</span>
          <strong data-testid="score">{game.score.toLocaleString()}</strong>
        </div>
        <div>
          <span>等級</span>
          <strong>{String(game.level).padStart(2, "0")}</strong>
        </div>
        <div>
          <span>消除行數</span>
          <strong>{String(game.lines).padStart(2, "0")}</strong>
        </div>
        <div>
          <span>{controller.mode === "online" ? "送出攻擊" : "最佳紀錄"}</span>
          <strong>
            {(controller.mode === "online"
              ? game.attacksSent
              : bestScore(controller.mode)
            ).toLocaleString()}
          </strong>
        </div>
      </div>
      <div className={`arena-stage ${duel ? "duel" : ""}`}>
        <section className="player-panel" aria-label="你的盤面">
          <div className="player-label">
            <i className="status-dot" />
            <strong>{playerName}</strong>
            <span>PLAYER 01</span>
          </div>
          <div className="board-layout">
            <aside className="piece-rail">
              <div className={`rail-box ${game.holdUsed ? "used" : ""}`}>
                <h2>
                  HOLD <kbd>C</kbd>
                </h2>
                <PiecePreview type={game.hold} />
              </div>
              <div className="garbage-meter">
                <span>待收攻擊</span>
                <strong>
                  {game.pendingGarbage.reduce((n, p) => n + p.holes.length, 0)}
                </strong>
                <div>
                  {Array.from({ length: 12 }, (_, i) => (
                    <i
                      key={i}
                      className={
                        i <
                        game.pendingGarbage.reduce(
                          (n, p) => n + p.holes.length,
                          0,
                        )
                          ? "filled"
                          : ""
                      }
                    />
                  ))}
                </div>
              </div>
            </aside>
            <div className="board-shell">
              <BoardCanvas
                controller={controller}
                label="玩家盤面，10 欄 × 20 列"
              />
              {(paused || view.suspended || !ready) && !finished && (
                <div className="board-overlay">
                  <span className="overlay-glyph">
                    {paused ? <Pause /> : <WifiOff />}
                  </span>
                  <strong>
                    {paused ? "喘口氣，再出發" : onlineMessage || "準備中"}
                  </strong>
                  {paused && (
                    <button
                      className="button primary"
                      onClick={() => controller.togglePause()}
                    >
                      <Play size={16} />
                      繼續遊戲
                    </button>
                  )}
                </div>
              )}
            </div>
            <aside className="piece-rail next-rail">
              <div className="rail-box">
                <h2>
                  NEXT <span>5</span>
                </h2>
                <div className="next-pieces">
                  {game.next.slice(0, 5).map((type, i) => (
                    <PiecePreview key={i} type={type} />
                  ))}
                </div>
              </div>
              {game.lastClear && (
                <div className="clear-label">
                  {game.lastClear}
                  {game.combo > 0 && <span>{game.combo} COMBO</span>}
                </div>
              )}
            </aside>
          </div>
        </section>
        {duel && (
          <>
            <div className="versus-mark">
              VS<span>ARENA v1</span>
            </div>
            <section className="opponent-panel" aria-label="對手盤面">
              <div className="player-label">
                <i className="status-dot purple" />
                <strong>{opponentName}</strong>
                <span>
                  {controller.mode === "ai" ? "AI OPPONENT" : "PLAYER 02"}
                </span>
              </div>
              <div className="board-shell">
                <BoardCanvas
                  controller={controller}
                  opponent
                  label="對手盤面"
                />
                {!opponent && (
                  <div className="board-overlay">
                    <span>等待對手</span>
                  </div>
                )}
              </div>
              <div className="opponent-stats">
                <span>
                  分數{" "}
                  <strong>{opponent?.score.toLocaleString() ?? "0"}</strong>
                </span>
                <span>
                  消行 <strong>{opponent?.lines ?? 0}</strong>
                </span>
              </div>
            </section>
          </>
        )}
      </div>
      {onlineMessage && (
        <p className="online-status" role="status">
          {onlineMessage}
        </p>
      )}
      <TouchControls
        input={controller.input}
        disabled={finished || paused || view.suspended || !ready}
      />
      <div className="keyboard-help">
        <span>
          <kbd>←</kbd>
          <kbd>→</kbd> 移動
        </span>
        <span>
          <kbd>↑</kbd>
          <kbd>Z</kbd> 旋轉
        </span>
        <span>
          <kbd>↓</kbd> 軟降
        </span>
        <span>
          <kbd>SPACE</kbd> 硬降
        </span>
        <span>
          <kbd>C</kbd> 保留
        </span>
        {controller.mode !== "online" && (
          <span>
            <kbd>ESC</kbd> 暫停
          </span>
        )}
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {finished
          ? `遊戲結束，${view.outcome === "win" ? "獲勝" : view.outcome === "loss" ? "落敗" : view.outcome === "draw" ? "平手" : ""}。分數 ${game.score}`
          : paused
            ? "遊戲已暫停"
            : (onlineMessage ?? "")}
      </p>
      {finished && (
        <div className="modal-backdrop">
          <section
            className="result-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="result-title"
          >
            <div className="result-icon">
              <Trophy size={36} />
            </div>
            <span className="eyebrow">
              {view.outcome === "win"
                ? "VICTORY"
                : view.outcome === "draw"
                  ? "DRAW"
                  : view.outcome === "abandoned"
                    ? "MATCH INTERRUPTED"
                    : "WELL PLAYED"}
            </span>
            <h2 id="result-title">
              {view.outcome === "win"
                ? "漂亮的一局！"
                : view.outcome === "loss"
                  ? "下一局，再挑戰"
                  : view.outcome === "draw"
                    ? "勢均力敵，平手！"
                    : view.outcome === "abandoned"
                      ? "本局同步中止"
                      : "每一局，都是進步"}
            </h2>
            <p>
              {controller.mode === "online"
                ? view.outcome === "abandoned"
                  ? "伺服器已中止本局，未計入勝負。"
                  : "本局結果已由伺服器確認。"
                : "成績已保存在這台裝置。"}
            </p>
            <div className="result-score">
              {game.score.toLocaleString()}
              <span>POINTS</span>
            </div>
            <div className="result-details">
              <span>{game.lines} 行</span>
              <span>等級 {game.level}</span>
              <span>{time}</span>
            </div>
            <button
              className="button primary wide"
              disabled={rematchWaiting}
              onClick={onRematch ?? onRestart}
            >
              <RotateCcw size={18} />
              {rematchWaiting ? "等待對手同意" : "再玩一局"}
            </button>
            <button className="button secondary wide" onClick={onBack}>
              返回大廳
            </button>
            {supabase && controller.mode !== "online" && (
              <button
                className="text-button"
                onClick={uploadScore}
                disabled={uploading || upload === "已上傳至休閒榜"}
              >
                {uploading ? "上傳中…" : "上傳至休閒榜"}
              </button>
            )}
            {supabase && controller.mode !== "online" && (
              <p className="subtle-note">
                雲端成績以此瀏覽器的匿名帳號保存；清除瀏覽資料後可能無法找回。
              </p>
            )}
            {upload && <p role="status">{upload}</p>}
            <button className="text-button" onClick={downloadReplay}>
              <Download size={14} />
              下載本局重播紀錄
            </button>
          </section>
        </div>
      )}
      {leavePrompt && (
        <div className="modal-backdrop">
          <section
            className="result-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="leave-title"
          >
            <h2 id="leave-title">離開這一局？</h2>
            <p>
              {controller.mode === "online"
                ? "離開後會依對戰規則判定棄權。"
                : "目前尚未結束的進度不會存入紀錄。"}
            </p>
            <button
              className="button primary wide"
              onClick={() => {
                setLeavePrompt(false);
                if (
                  controller.mode !== "online" &&
                  controller.player.phase === "paused"
                )
                  controller.togglePause();
              }}
            >
              繼續遊戲
            </button>
            <button className="button secondary wide" onClick={onBack}>
              離開並返回大廳
            </button>
          </section>
        </div>
      )}
    </main>
  );
}
