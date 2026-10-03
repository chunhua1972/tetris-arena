import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  Gamepad2,
  Globe,
  Home,
  Layers3,
  Monitor,
  Settings2,
  ShieldCheck,
  Sparkles,
  Swords,
  Trophy,
  Users,
  Zap,
} from "lucide-react";
import { GameController } from "../controllers/GameController";
import { GameScreen } from "../components/GameScreen";
import { BoardCanvas } from "../components/BoardCanvas";
import { createGame } from "../domain/gameReducer";
import type { Difficulty, Mode } from "../domain/types";
import {
  bestScore,
  localScores,
  readStorage,
  writeStorage,
} from "../services/storage";
import {
  cloudError,
  ensureUser,
  rpc,
  supabase,
} from "../services/supabaseClient";
import { OnlineLobby } from "../pages/OnlineLobby";
type Page = "home" | "game" | "online" | "leaderboard" | "help";
export function App() {
  const [page, setPage] = useState<Page>(() =>
      window.location.hash.startsWith("#room=") ? "online" : "home",
    ),
    [onlinePlaying, setOnlinePlaying] = useState(false),
    [mode, setMode] = useState<Mode>("solo"),
    [difficulty, setDifficulty] = useState<Difficulty>(() =>
      readStorage("arena:difficulty") === "easy" ? "easy" : "normal",
    ),
    [run, setRun] = useState(0),
    [name, setName] = useState(() => readStorage("arena:name") || "方塊玩家"),
    [editingName, setEditingName] = useState(false),
    [notice, setNotice] = useState("");
  const controller = useMemo(
    () => new GameController(mode, difficulty, crypto.randomUUID()),
    [mode, difficulty, run],
  );
  const start = (next: Mode) => {
    setMode(next);
    setRun((n) => n + 1);
    setPage(next === "online" ? "online" : "game");
  };
  useEffect(() => {
    writeStorage("arena:difficulty", difficulty);
  }, [difficulty]);
  const saveName = () => {
    const clean = name.trim().slice(0, 24);
    if (clean.length < 2) {
      setNotice("暱稱至少需要 2 個字");
      return;
    }
    setName(clean);
    writeStorage("arena:name", clean);
    setEditingName(false);
    setNotice("");
  };
  const nav = [
    ["home", "遊戲大廳", Home],
    ["leaderboard", "休閒排行榜", Trophy],
    ["help", "操作指南", Gamepad2],
  ] as const;
  const leaveGame = () => {
    setOnlinePlaying(false);
    setPage("home");
  };
  const inGame = page === "game" || (page === "online" && onlinePlaying);
  return (
    <div className={`app-shell ${inGame ? "in-game" : ""}`}>
      <header className="app-header">
        <button
          className="brand"
          onClick={() => {
            if (page !== "game" && page !== "online") setPage("home");
          }}
          aria-label="方塊競技場"
        >
          <span className="brand-mark">
            <i />
            <i />
            <i />
            <i />
          </span>
          <span>
            BLOCK<span>ARENA</span>
          </span>
        </button>
        <span className="header-rule">PLAY YOUR NEXT MOVE.</span>
        <div className="header-right">
          <span className="connection-pill">
            <i className={`status-dot ${supabase ? "" : "muted"}`} />
            {supabase ? "雲端已設定" : "本機可玩"}
          </span>
          <div className="avatar">{name.slice(0, 1)}</div>
          {editingName ? (
            <input
              className="name-input"
              aria-label="玩家暱稱"
              value={name}
              maxLength={24}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveName();
              }}
              onBlur={saveName}
              autoFocus
            />
          ) : (
            <button
              className="name-button"
              onClick={() => setEditingName(true)}
              aria-label="編輯玩家暱稱"
            >
              {name}
              <Settings2 size={14} />
            </button>
          )}
        </div>
      </header>
      <div className="app-body">
        {!inGame && (
          <aside className="sidebar">
            <nav aria-label="主選單">
              {nav.map(([id, label, Icon]) => (
                <button
                  key={id}
                  className={`nav-link ${page === id ? "active" : ""}`}
                  onClick={() => setPage(id)}
                  disabled={page === "online"}
                >
                  <Icon size={19} />
                  <span>{label}</span>
                  {page === id && <span className="nav-dot" />}
                </button>
              ))}
            </nav>
            <div className="sidebar-bottom">
              <div className="mini-blocks">
                <i />
                <i />
                <i />
              </div>
              <strong>ONE MORE ROUND.</strong>
              <p>找到節奏，突破自己。</p>
              <span>ARENA v1 · MVP 0.1</span>
            </div>
          </aside>
        )}
        <div className="page-content">
          {notice && (
            <p className="notice" role="status">
              {notice}
            </p>
          )}
          {page === "home" && (
            <HomePage
              onStart={start}
              difficulty={difficulty}
              setDifficulty={setDifficulty}
              onLeaderboard={() => setPage("leaderboard")}
            />
          )}
          {page === "game" && (
            <GameScreen
              key={run}
              controller={controller}
              onBack={leaveGame}
              onRestart={() => setRun((n) => n + 1)}
              playerName={name}
            />
          )}
          {page === "online" && (
            <OnlineLobby
              name={name}
              onBack={leaveGame}
              onPlayingChange={setOnlinePlaying}
            />
          )}
          {page === "leaderboard" && <Leaderboard />}
          {page === "help" && <Help />}
          <footer className="app-footer">
            <span>七種方塊，無限可能。</span>
            <span>
              ARENA v1 <span className="footer-dot">·</span> MADE TO PLAY
            </span>
          </footer>
        </div>
      </div>
    </div>
  );
}
function HomePage({
  onStart,
  difficulty,
  setDifficulty,
  onLeaderboard,
}: {
  onStart: (m: Mode) => void;
  difficulty: Difficulty;
  setDifficulty: (d: Difficulty) => void;
  onLeaderboard: () => void;
}) {
  const demo = useMemo(() => {
    const game = createGame("landing");
    game.active = {
      type: "T",
      rotation: 0,
      x: 4,
      y: 6,
      lastAction: "spawn",
      kickIndex: null,
    };
    const rows = [
      "0000000000",
      "0000000000",
      "0000000000",
      "0000000000",
      "0000000000",
      "0000000000",
      "0000000000",
      "0000000000",
      "0000000000",
      "0000000000",
      "0000000000",
      "0000000000",
      "0000000000",
      "0000000000",
      "0000000000",
      "0000007000",
      "6000007700",
      "6604007550",
      "6224400550",
      "3224471550",
      "3337771111",
    ];
    rows.forEach((r, y) =>
      [...r].forEach((n, x) => (game.board[(y + 1) * 10 + x] = Number(n))),
    );
    return game;
  }, []);
  const records = localScores(),
    best = bestScore("solo");
  return (
    <main className="home-page">
      <div className="section-top">
        <span className="eyebrow">
          <span className="status-dot" /> YOUR NEXT CHALLENGE
        </span>
        <span className="today-label">隨時，來一場。</span>
      </div>
      <section className="hero">
        <div className="hero-copy">
          <div className="hero-tag">
            <Sparkles size={14} />
            讓專注，變成你的超能力
          </div>
          <h1>
            每一格，都是
            <br />
            下一次<span>突破。</span>
          </h1>
          <p>
            旋轉、落下、消除。
            <br />
            找回熟悉的節奏，挑戰全新的對手。
          </p>
          <button className="button primary" onClick={() => onStart("solo")}>
            <PlayIcon />
            快速開始
            <ArrowRight size={18} />
          </button>
          <div className="hero-note">
            <Monitor size={14} />
            <span>鍵盤與觸控皆可玩</span>
            <span className="small-dot" />
            <span>單人免登入</span>
          </div>
        </div>
        <div className="hero-visual" aria-hidden="true">
          <div className="orbit-circle" />
          <div className="hero-board">
            <div className="demo-label">
              <span className="status-dot" />
              IN THE ZONE<span>01</span>
            </div>
            <BoardCanvas state={demo} label="方塊示意圖" />
          </div>
          <div className="floating-score">
            <Zap size={17} />
            <div>
              <strong>PERFECT CLEAR</strong>
              <span>下一次精彩，由你創造。</span>
            </div>
            <span>+2,000</span>
          </div>
          <span className="hero-coordinate">
            10 × 20 / ENDLESS POSSIBILITIES
          </span>
        </div>
      </section>
      <div className="section-title">
        <div>
          <span className="eyebrow">CHOOSE YOUR ARENA</span>
          <h2>今天，想怎麼玩？</h2>
        </div>
        <span className="section-caption">三種模式，找到你的節奏。</span>
      </div>
      <div className="mode-grid">
        <article className="mode-card solo-card">
          <div className="mode-card-top">
            <span className="mode-icon">
              <Layers3 size={25} />
            </span>
            <span className="mode-badge">OFFLINE</span>
          </div>
          <span className="mode-index">01 / SOLO</span>
          <h3>單人挑戰</h3>
          <p>
            一個人，也能玩得很精彩。
            <br />
            挑戰消行與分數，刷新最佳紀錄。
          </p>
          <button className="mode-action" onClick={() => onStart("solo")}>
            開始挑戰
            <ArrowUpRight size={20} />
          </button>
        </article>
        <article className="mode-card ai-card">
          <div className="mode-card-top">
            <span className="mode-icon">
              <Zap size={25} />
            </span>
            <span className="mode-badge">OFFLINE</span>
          </div>
          <span className="mode-index">02 / VS AI</span>
          <h3>AI 對戰</h3>
          <p>
            和 AI 同場較勁。
            <br />
            互送垃圾行，看看誰能撐到最後。
          </p>
          <div className="difficulty-switch" aria-label="AI 難度">
            {(["easy", "normal"] as const).map((d) => (
              <button
                key={d}
                aria-pressed={difficulty === d}
                className={difficulty === d ? "selected" : ""}
                onClick={() => setDifficulty(d)}
              >
                {difficulty === d && <Check size={12} />}{" "}
                {d === "easy" ? "簡單" : "普通"}
              </button>
            ))}
          </div>
          <button className="mode-action" onClick={() => onStart("ai")}>
            挑戰 AI
            <ArrowUpRight size={20} />
          </button>
        </article>
        <article className="mode-card online-card">
          <div className="mode-card-top">
            <span className="mode-icon">
              <Swords size={25} />
            </span>
            <span className="mode-badge">{supabase ? "ONLINE" : "待啟用"}</span>
          </div>
          <span className="mode-index">03 / VS FRIEND</span>
          <h3>好友對戰</h3>
          <p>
            建立私人房間，分享房碼。
            <br />
            與朋友來一場真正的雙人對決。
          </p>
          <div className="friend-note">
            <Users size={14} />
            <span>2 位玩家 · 私人房間</span>
          </div>
          <button className="mode-action" onClick={() => onStart("online")}>
            {supabase ? "前往對戰大廳" : "查看連線設定"}
            <ArrowUpRight size={20} />
          </button>
        </article>
      </div>
      <div className="home-bottom">
        <section className="record-card">
          <div className="record-icon">
            <Trophy size={23} />
          </div>
          <div>
            <span>你的單人最佳紀錄</span>
            <strong>
              {best ? best.toLocaleString() : "等你來創造"}
              <small>{best ? "PTS" : ""}</small>
            </strong>
          </div>
          <button className="text-button" onClick={onLeaderboard}>
            查看紀錄
            <ChevronRight size={16} />
          </button>
        </section>
        <section className="tip-card">
          <span className="tip-icon">
            <Gamepad2 size={22} />
          </span>
          <div>
            <strong>小技巧：先看看落點</strong>
            <p>方塊下方的輪廓是 Ghost。按空白鍵，直接落到底。</p>
          </div>
        </section>
      </div>
      <div className="home-meta">
        <span>
          <ShieldCheck size={14} />
          單人與 AI 不需登入
        </span>
        <span>
          {records.length
            ? `已完成 ${records.length} 場本機挑戰`
            : "準備好你的第一場挑戰"}
        </span>
      </div>
    </main>
  );
}
function PlayIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M4 2.5v11l9-5.5z" />
    </svg>
  );
}
function Leaderboard() {
  const [mode, setMode] = useState<"solo" | "ai">("solo"),
    [cloud, setCloud] = useState(false),
    [rows, setRows] = useState<
      { display_name: string; score: number; lines: number; level: number }[]
    >([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true;
    setError("");
    if (!cloud) {
      setRows(
        localScores()
          .filter((r) => r.mode === mode)
          .slice(0, 20)
          .map((r) => ({ ...r, display_name: "這台裝置" })),
      );
      setLoading(false);
      return;
    }
    setLoading(true);
    rpc<typeof rows>("tetris_get_leaderboard", {
      p_mode: mode,
      p_rules_version: "arena-v1",
      p_limit: 20,
      p_offset: 0,
    })
      .then((data) => {
        if (active) setRows(data);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [mode, cloud]);
  const connect = async () => {
    try {
      await ensureUser();
      setCloud(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "無法連線");
    }
  };
  return (
    <main className="standard-page">
      <span className="eyebrow">A LITTLE FRIENDLY COMPETITION</span>
      <h1>休閒排行榜</h1>
      <p className="page-description">
        留下每一次突破。所有成績均為未驗證成績。
      </p>
      <div className="leaderboard-controls">
        <div className="tabs">
          <button
            className={!cloud ? "selected" : ""}
            onClick={() => setCloud(false)}
          >
            本機紀錄
          </button>
          <button
            className={cloud ? "selected" : ""}
            disabled={!supabase}
            onClick={connect}
          >
            雲端休閒榜
            <Globe size={14} />
          </button>
        </div>
        <div className="tabs">
          <button
            className={mode === "solo" ? "selected" : ""}
            onClick={() => setMode("solo")}
          >
            單人
          </button>
          <button
            className={mode === "ai" ? "selected" : ""}
            onClick={() => setMode("ai")}
          >
            AI
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      <div className="leaderboard-table">
        <div className="table-header">
          <span>排名</span>
          <span>玩家</span>
          <span>分數</span>
          <span>消行</span>
          <span>等級</span>
        </div>
        {loading ? (
          <div className="empty-state">正在讀取成績…</div>
        ) : rows.length ? (
          rows.map((r, i) => (
            <div className="table-row" key={i}>
              <span className={i < 3 ? "rank-top" : ""}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <span>{r.display_name}</span>
              <strong>{r.score.toLocaleString()}</strong>
              <span>{r.lines}</span>
              <span>{r.level}</span>
            </div>
          ))
        ) : (
          <div className="empty-state">
            <Trophy size={40} />
            <h2>第一個紀錄，從你開始</h2>
            <p>完成一場遊戲後，成績就會出現在這裡。</p>
          </div>
        )}
      </div>
      <p className="subtle-note">
        {cloud
          ? "每位玩家顯示最佳一筆成績。匿名帳號的紀錄可能因清除瀏覽資料而無法找回。"
          : "本機紀錄保存於此瀏覽器；清除瀏覽資料會移除紀錄。"}
        規則版本：Arena v1。
      </p>
    </main>
  );
}
function Help() {
  const keys = [
    ["← / A", "向左移動"],
    ["→ / D", "向右移動"],
    ["↓ / S", "軟降，每格加 1 分"],
    ["↑ / X", "順時針旋轉"],
    ["Z", "逆時針旋轉"],
    ["SPACE", "硬降，每格加 2 分"],
    ["C / SHIFT", "保留／交換方塊"],
    ["ESC / P", "暫停單人或 AI 遊戲"],
  ];
  return (
    <main className="standard-page">
      <span className="eyebrow">FIND YOUR FLOW</span>
      <h1>操作指南</h1>
      <p className="page-description">從第一塊開始，慢慢找到你的節奏。</p>
      <div className="help-grid">
        <section className="panel">
          <h2>
            <Gamepad2 size={21} />
            鍵盤控制
          </h2>
          {keys.map(([key, text]) => (
            <div className="help-key" key={key}>
              <kbd>{key}</kbd>
              <span>{text}</span>
            </div>
          ))}
        </section>
        <section className="panel">
          <h2>
            <Layers3 size={21} />
            Arena v1 規則
          </h2>
          <p>
            七種方塊每袋各出現一次。一次保留、一眼預覽五塊，用輪廓判斷落點。
          </p>
          <p>
            每消除 10 行提升一級，速度逐漸加快。堆到隱藏出生區，遊戲就會結束。
          </p>
          <div className="scoring-guide">
            <span>
              1 行<strong>100 分</strong>
            </span>
            <span>
              2 行<strong>300 分</strong>
            </span>
            <span>
              3 行<strong>500 分</strong>
            </span>
            <span>
              4 行<strong>800 分</strong>
            </span>
          </div>
          <p>基礎分數乘以目前等級。T-Spin、連擊與全清可獲得額外分數。</p>
          <p>
            對戰中，消行可產生垃圾行攻擊；你的攻擊會先抵銷待收垃圾，再送給對手。
          </p>
        </section>
      </div>
      <section className="panel help-touch">
        <h2>
          <ArrowDown size={21} />
          手機與平板
        </h2>
        <p>
          使用盤面下方的觸控按鈕，按住左右或軟降可連續操作。單人與 AI
          切換分頁時會自動暫停；好友對戰需保持連線，離線超過 20
          秒會由伺服器判定棄權。
        </p>
        <p>
          線上成績為休閒用的未驗證紀錄。匿名登入在清除瀏覽資料後可能無法恢復。
        </p>
        {cloudError && <p className="notice">{cloudError}</p>}
      </section>
    </main>
  );
}
