# Google Apps Script 3.1 設定與復原

本指南先使用獨立測試試算表與代稱名冊。程式更新不等於已發布；前端 3.1 需搭配 GAS 3.1。

## 1. 設定程式與秘密

1. 建立測試試算表，保持共用權限「限制」。可從該試算表「擴充功能 → Apps Script」或建立獨立 GAS 專案。
2. 將 `gas/Code.js` 複製到 GAS 的 `Code.gs`。本機檔名 `.js` 方便語法檢查，在 GAS 編輯器使用 `.gs`。
3. 在 GAS「專案設定 → 指令碼屬性」新增：

| 屬性           | 內容                                                             |
| -------------- | ---------------------------------------------------------------- |
| SPREADSHEET_ID | 試算表網址 `/d/` 與 `/edit` 之間的 ID                            |
| API_TOKEN      | 隨機、至少 24 字元的獨立秘密；建議使用密碼管理器產生 32 字元以上 |

秘密只填入 GAS 的屬性與前端的 Token 欄位，禁止放進原始碼、報告、測試、`.env.example` 或 git。程式以 openById 開啟明確試算表，不依賴目前開啟的表格。

可參照 `gas/appsscript.json` 設定台北時區、V8 runtime 及 Sheets scope；不在 manifest 預設 Web App 公開權限。

## 2. 手動初始化

在 GAS 編輯器執行 `setupDatabase`，完成 Google 授權。函式會檢查現有欄位、重複、公式與關聯，建立缺少的正式清單，先備份再寫入並核對。請先在完整副本操作。doGet／doPost 不會自動執行遷移。

舊版 `students` 的純年度占位列會轉為 years；空單元占位列轉為 subjects。有紀錄的無名稱作業會保留並加「待命名作業」名稱。錯誤或孤兒紀錄不會靜默丟棄；請先在副本核對。新表頭見 [試算表結構](GOOGLE_SHEET_SETUP.md)。

setup 會正規化數字／文字 ID、座號與分數；原始資料另外保存於 `_backups`。這是 V3 表格遷移，不接受 V2 API 物件作為同格式輸入。

## 3. 決定 Web App 的存取方式

目前前端從靜態網站以 `POST`、`text/plain`、`credentials: omit` 呼叫 GAS，Token 在 JSON 本文中，並要求可以讀取 JSON 回覆。`doGet` 只提供版本健康檢查，不提供名冊。Google ContentService 會重新導向至 `script.googleusercontent.com`，前端 CSP 已允許該來源。

**若採用這個靜態前端直接連線方式，端點必須允許未登入 Google 的請求到達 doPost，再由本程式驗證 Token。** GAS 部署通常選「執行身分：我」及「存取者：任何人」。這會建立可從網際網路呼叫的端點，正確 Token 即可讀寫此試算表內的應用資料；必須由資料擁有人明確決定，且不能因此公開试算表共用權限。學校 Workspace 若不允許此設定，請停止，改採 Google 登入的同源介面／後端代理；不要用 no-cors 當作解法。

「只有自己」的 Google 登入保護不能直接與目前 credentials:omit 前端搭配。另建受登入保護的服務需要前後端整合，不是只改下拉選單。此專案沒有自行新增或變更任何實際部署權限。

## 4. 部署與連線驗收

1. 在經確認的測試存取方式下，以「部署 → 新增部署 → 網頁應用程式」發布。
2. 複製 `/exec` 網址；`/dev` 不是正式連線網址。
3. 在前端設定填網址及 Token，點「儲存設定並測試連線」，必須拿到 API 3.1 的有效 catalog。
4. 新建測試年度／空班級／科目／單元，匯入代稱名冊，送出一筆紀錄，再重新載入確認。只看到 GET 健康頁成功不代表可讀寫。
5. 用錯 Token、斷網、清除、兩個裝置同時編輯進行驗收。瀏覽器 Network 必須看見可讀取的 JSON；若變成登入 HTML、opaque、CORS 錯誤，先修部署，前端不能宣稱成功。

GAS 更新後須「管理部署 → 編輯 → 新版本 → 部署」，單純儲存 Code.gs 不會更新現有版本。保留先前版本及測試資料備份，再发布前端。前端發布內容只需 index.html、css、js、vendor 與 docs。

## 5. 備份與中斷復原

每個有變更的寫入先將完整資料快照存至 `_backups`，再设置 `PENDING_WRITE`，批次寫入並讀回核對。正常完成或核對過的還原才清除該標記。若程式逾時或被終止，後續 API 會回 `RECOVERY_REQUIRED`，停止繼續操作。

`_backups` 欄位：backup_id、created_at、action、part、json。json 欄的每段內容**本身是 JSON 編碼字串**：須對每段做一次 JSON.parse，再按 part 從1接起來，最後再 JSON.parse 整份。這可避免某段正好以公式符號開頭。不要手動把分段當一般文字直接貼回。

復原步驟（在測試副本先演練）：

1. 停止使用前端，先另存目前試算表完整副本。記下錯誤與 PENDING_WRITE 的備份 ID。
2. 在 GAS 屬性填入 `RECOVERY_BACKUP_ID`，值為你已核對要還原的完整備份 ID。
3. 在編輯器手動執行 `restoreBackup`。它會先留下目前資料的安全備份，再還原、讀回驗證；成功後清除 PENDING_WRITE 與 RECOVERY_BACKUP_ID。
4. 若還原的是初始化前的 3.0 原始表格，API 可能回 SETUP_REQUIRED／SCHEMA。修正原問題後，在副本重新執行 setupDatabase。
5. 重新整理前端清單，匯出並核對各分頁未送出的草稿。不要直接刪除 PENDING_WRITE 以繞過資料核對。

備份功能不對 HTTP 暴露還原入口。普通「匯出雲端 JSON」只輸出目前主要資料，不含 token 或 `_backups` 歷史；若要保留全部歷史，另存完整試算表副本。

## 6. 容量與安全界線

Sheet 不是具備跨表交易的資料庫。備份、鎖、讀回驗證與中斷標記可降低風險，但外部直接編輯試算表不受 script lock 保護；使用前端期間請避免手動改表。人工更改通常會觸發 revision 衝突或結構驗證。

完整快照會隨使用量增長；每學期封存年度、另存完整試算表並檢查備份容量。程式不自動刪除備份。需要大量班級／多教師／細分權限時，应改用真正的登入與資料庫架構。

本次測試以記憶體試算表模擬，實際 GAS quota、CORS、Google Workspace 政策與瀏覽器功能仍需測試環境確認。

參考：[Google Web Apps](https://developers.google.com/apps-script/guides/web)、[Content Service](https://developers.google.com/apps-script/guides/content)、[Properties](https://developers.google.com/apps-script/guides/properties)、[Lock Service](https://developers.google.com/apps-script/reference/lock/lock-service)。
