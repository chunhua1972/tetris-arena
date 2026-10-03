# 方塊競技場 · Tetris Arena MVP

依父目錄 `DEVplan.md` 實作的獨立 Vite、React、TypeScript 專案。原有 Python 影片下載器未修改。

## 啟動

建議 Node.js 24 LTS，最低 22.12。套件已用 `package-lock.json` 鎖定。

```powershell
cd C:\1150906AI課程\002\tetris-arena
npm ci
npm run dev
```

這台 Codex 電腦也可直接使用內建 Node 執行：

```powershell
.\scripts\start.ps1
```

瀏覽器開啟 `http://localhost:5173`。同 Wi-Fi 的其他裝置可開啟電腦的區網 IP 與 port 5173；這只是開發預覽，正式上線需 HTTPS。

## 已實作功能

- 共用 Arena v1 純規則引擎：10×22（20 可見行）、seeded 7-bag、完整 SRS kick、Ghost、Next 5、Hold、500 ms 鎖定延遲／15 次重設、等級、T-Spin、B2B、Combo、全清、垃圾行抵銷與上限。
- 單人與 AI 免登入；簡單／普通 AI 使用合法動作與同一規則引擎，背景 Worker 搜尋，普通難度加入下一塊搜尋。
- 鍵盤、觸控與長按操作；暫停、切換分頁自動暫停、結果、再玩一局、本機前 100 筆成績、暱稱與難度記憶、JSON replay 下載。
- Supabase 匿名登入、暱稱、私人雙人房、原子占位與 Ready、伺服器倒數、Presence、私有 Broadcast、對手快照、應用層攻擊 ACK／重送／去重、控制分頁租約、重連與重賽。
- 房間與結果由 PostgreSQL RPC 決定；終局報告冪等、150 ms 結算窗口、100 ms 平手判定、20 秒離線期限、5 秒掃描排程。
- 本機榜與雲端休閒榜。雲端只公開必要欄位，每位玩家最佳一筆，成績一律 `unverified`。

未設定 Supabase 時，介面會明示好友對戰尚未啟用；不會建立假的房間、連線或雲端勝負。單人／AI 不依賴 Supabase，載入後即使失去網路仍可遊玩。本版未加入 Service Worker，不能保證離線重新開啟網站。

## Supabase 設定

需要一個由你控制的測試專案。前端僅使用 Project URL 與 **publishable key**；不得放 secret 或 service role key。

1. 在 Supabase Auth 設定啟用 Anonymous Sign-ins，設定正式網站 URL。匿名身分屬於 `authenticated` role；清除瀏覽資料或登出後可能無法恢復。若正式公開開放匿名登入，依 Supabase 官方建議設定 Auth 限流／CAPTCHA。
2. 用 Supabase CLI 登入與連接測試專案：

   ```powershell
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push
   npx supabase functions deploy tetris-submit-finish
   ```

   第一支 migration 建立 schema、grants、RLS、RPC、private channel policies 與 DB Broadcast trigger；第二支啟用 `pg_cron`，**每 5 秒**執行 `tetris_sweep`。若 Cron extension／排程建立失敗，不可略過後宣稱斷線結算完成。
3. Edge Function 的 `verify_jwt = false` 用於支援新金鑰；函式本身會使用 `auth.getUser()` 驗證 Bearer JWT，並用該使用者的 RLS 查詢確認參賽身分後才呼叫管理端 finalizer。管理金鑰只由 Supabase 函式環境讀取，前端不持有。Edge 暫時不可用時，Cron 仍會完成結算，但畫面可能多等一個掃描週期。
4. 將 `.env.example` 複製成 `.env.local`，填入：

   ```dotenv
   VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_PUBLIC_KEY
   ```

   程式也接受舊版 `anon` JWT key，並拒絕 `service_role`／`sb_secret_`。更改 Vite 環境變數後須重啟開發伺服器或重新建置。
5. 確認 Realtime 開啟。前端會使用 `private: true`，頻道為 `tetris:room:<uuid>`；知道房碼／UUID 不代表有授權。可關閉專案的 public channel 存取。
6. 確認排程存在並有成功紀錄：

   ```sql
   select jobname, schedule, active from cron.job where jobname like 'tetris-%';
   select status, return_message, end_time from cron.job_run_details
     where jobid in (select jobid from cron.job where jobname = 'tetris-timeout-sweeper')
     order by end_time desc limit 10;
   ```

7. 使用兩個不同瀏覽器／裝置完成建房、加入、Ready、對戰、終局、重賽與斷線測試，再發布。

正式帳號（電子郵件／OAuth）、正式排名／反作弊、公開配對、觀戰與 PWA 不在本版範圍。匿名 Auth 可以保存目前瀏覽器的雲端身分，不能保證跨裝置恢復。

## 驗證

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

`scripts/start.ps1 -Check` 會使用 Codex 內建 Node 執行型別、lint、單元／資料庫測試與建置。Windows E2E 優先使用已安裝的 Chrome；沒有 Chrome 時使用 Playwright Chromium。

- `tests/domain.test.ts`：SRS、seed、Hold、Top out、Ghost、鎖定時間、T-Spin／B2B／Combo、垃圾、分數安全整數及固定 replay。
- `tests/ai.test.ts`：可達落點與合法動作、決定性、固定 40 塊基準局。
- `tests/sync.test.ts`：亂序、ACK、去重、重送窗口、恢復、snapshot、DAS／ARR。
- `tests/controller.test.ts`：最後一塊導致結束的紀錄，以及固定步之間收到垃圾行的紀錄，都可重播成相同終態。
- `tests/database.test.ts`：**真實 PostgreSQL 引擎（PGlite）**執行第一支 migration，使用不同 SQL role／Auth 身分驗證 RLS、RPC 權限、席位、revision、控制權、結算、超時、重賽與榜單。
- `tests/e2e`：桌面／手機 Chromium 與兩個獨立瀏覽器 context。測試伺服器執行同一套 migrations／RPC，Auth 與 Realtime transport 以本機 fixture 模擬。此 fixture **不是實際 Supabase 服務，也不可部署**；不能取代實際 private Realtime、Cron、Edge Function 與實機 Safari 驗收。

本機驗證：58 項單元／資料庫／控制層測試通過；13 項瀏覽器測試通過。手機執行完整雙人對局；故障注入測試只在桌面執行，對應手機重複項目跳過。包含重複攻擊、遺失 ACK、短暫斷線與重賽。型別、ESLint 與正式建置皆通過。

## 部署與剩餘驗收

`npm run build` 產生 `dist/`，可放在支援 HTTPS 的靜態網站主機。發布順序為 DB → Cron → Edge Function → 前端環境變數／build → 兩裝置 smoke test。

正式環境已部署：前端位於 [GitHub Pages](https://chunhua1972.github.io/tetris-arena/)，原始碼位於 [GitHub repository](https://github.com/chunhua1972/tetris-arena)；後端使用 Supabase `Games` 專案（`ap-northeast-1`）。兩個資料庫 migration 已套用並記錄，7 張遊戲資料表和兩個 pg_cron 排程已啟用，`tetris-submit-finish` Edge Function 已發布。Auth 已開啟匿名登入並設定正式網站網址。

正式網站已用兩個隔離的 Chrome 瀏覽器工作階段實測：匿名登入、建立私人房間、輸入房間碼加入、雙方準備、開始對局均成功；兩個對戰畫面都正常顯示。桌面／手機模擬與本機故障注入另見上方測試紀錄。iPhone／iPad Safari、Android 實機及 Edge 的跨平台驗收仍待執行。測試通過不代表防作弊；方塊與分數在客戶端運算，結果與榜單僅供休閒使用。

`.env`、`.env.local` 和其他 `.env.*` 設定檔已加入 `.gitignore`；只有不含值的 `.env.example` 範本提交到 GitHub。GitHub Actions 僅設定前端所需的 Supabase URL 與 publishable key；未提交或暴露任何 Secret／`service_role` key。

## 資料與規則

本機偏好與分數放 `localStorage`；進行中的線上局與最多 32 筆攻擊重送紀錄放 `sessionStorage`。恢復時必須匹配 match／round 並與對手交換序號。紀錄缺失、攻擊缺口超出窗口或無法同步時會中止該局，不能猜測盤面或自稱獲勝。另一分頁必須明確按「接管」才可取得操作租約。

房間等待 30 分鐘、完成後 24 小時過期；請求冪等紀錄 7 天後移除。成績／對局目前持續保留，刪除 Auth user 時透過 FK 連動刪除；正式環境的保留政策須由專案所有者確認。遊戲隨機序列與規則均版本化為 `arena-v1`，更改規則時須更新版本及 replay fixture。

技術參考：[Vite Node 需求](https://vite.dev/guide/)、[Supabase 匿名登入](https://supabase.com/docs/guides/auth/auth-anonymous)、[私有頻道授權](https://supabase.com/docs/guides/realtime/authorization)、[資料庫 Broadcast](https://supabase.com/docs/guides/realtime/broadcast)、[Cron](https://supabase.com/docs/guides/cron/quickstart)、[Edge Auth](https://supabase.com/docs/guides/functions/auth)。
