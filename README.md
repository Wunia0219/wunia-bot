# Cinnamoroll Calendar

Discord Bot 在指定的文字頻道維護一張置頂月曆。月份瀏覽、日期選擇和明細會以個人可見的訊息呈現。

- 點「1–10 日」、「11–20 日」或「21–月底」，再點日期開啟已帶入日期的表單。
- 點「本月明細」逐週查看直式日程和文字，再點日期查看該日的完整時間軸。
- 可見此頻道的成員可新增日程。日程建立者和具有「管理訊息」權限的人可以編輯、改期或取消。
- 圖片和輸入時間使用台北時間。時間接受 `14:30`、`14:30–16:00` 或留白表示全天。跨午夜的安排分兩筆新增。

## Cloudflare 上線

1. 在 Cloudflare Workers 部署 `wrangler.toml` 定義的 `cinnamoroll-calendar`，部署指令為 `npm run deploy`。新 D1 資料庫可執行 `npm run db:migrate` 初始化。
2. 在 Worker 的 Variables and Secrets 新增 `DISCORD_GUILD_ID`、`DISCORD_CHANNEL_ID` 和 Secret `DISCORD_TOKEN`。Bot 需要目標頻道的檢視、傳送、讀取歷史、附加檔案，以及置頂訊息權限。
3. 在 Discord Developer Portal 的 Interactions Endpoint URL 填入 Worker 網址加上 `/interactions`。儲存時 Discord 會送出簽名驗證。成功後 Worker 會設定應用程式圖示與頭像、註冊伺服器指令、更新置頂月曆。

`/health` 可確認 Worker 已上線。Worker 用 D1 保存日程，以 Browser Run 產出 PNG 並快取，同時提供文字明細。若暫時達到圖片服務配額，操作仍會回傳文字版，置頂圖會重試更新。

## Docker Gateway 部署

1. 在 [Discord Developer Portal](https://discord.com/developers/applications) 建立應用程式。在 Installation 設定 Guild Install，使用 `bot` 和 `applications.commands` scopes，並把 Bot 安裝到目標伺服器。
2. 在目標頻道給 Bot 檢視頻道、傳送訊息、讀取訊息歷史、附加檔案、置頂訊息的權限。
3. 在支援常駐 Docker 容器的部署環境建置此專案。將 Bot Token 存在平台的 Secret `DISCORD_TOKEN`，並把持久化磁碟掛在容器的 `/app/data`。執行單一副本。若使用自訂的容器磁碟，請讓容器中的 `node` 使用者（UID 1000）可寫入。備份資料時使用 SQLite 備份，或在停止 Bot 後備份整個資料目錄。

Bot 啟動後會註冊伺服器指令 `/行事曆`，並發布或更新置頂訊息。部署需要的環境變數列在 `.env.example`。

## 開發與驗證

需 Node.js 24 以上。使用 `npm ci` 安裝套件，`npm test` 檢查日期、資料保存與 Discord 元件。Docker 映像會安裝繁體中文 CJK 字型。若在其他 Node 環境啟動，請安裝 Noto Sans CJK TC 或 Microsoft JhengHei 供圖片渲染。

## 圖片

- `assets/app-icon.png` 是 Discord 應用程式圖示（1024 × 1024）。
- `assets/month-mascot.png` 是整月總覽頁首的飛行大耳狗。
- `assets/detail-mascot.png` 是每週明細與單日卡片共用的記事本插畫。

三張插畫以 ImageGen 生成。圖示採淺藍圓形構圖，兩張頁首插畫依同一個角色比例、粉色臉頰與淺藍線條繪製。月份、日期和行程內容每次依資料繪製。
