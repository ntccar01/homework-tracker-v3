# Google Apps Script 設定指南

## 步驟 1：建立 GAS 專案

1. 前往 [script.google.com](https://script.google.com)
2. 點擊「+ 新增專案」
3. 將專案命名為：**作業登記系統 API**

## 步驟 2：連結 Google Sheet

1. 在 GAS 編輯器中，點擊「資源」→「關聯試算表」
2. 選擇刚才建立的「作業登記系統 v3.0」試算表
3. 點擊「選取」

## 步驟 3：貼上程式碼

將 `gas/Code.js` 的內容完整複製貼上到 GAS 編輯器的 `Code.gs` 中。

## 步驟 4：設定 TOKEN

在 GAS 編輯器中：
1. 找到程式碼第 3 行的 `const TOKEN = 'your_secret_token_here';`
2. 將 `your_secret_token_here` 改為您自訂的金鑰（例如：`mytoken2025`）
3. 記下這個 TOKEN，後續前端設定會用到

## 步驟 5：設定 API 網址

1. 點擊右上角「部署」→「新增部署」
2. 類型選「網頁應用程式」
3. 描述：`作業登記 API`
4. 「誰可以存取」選「自己」
5. 點擊「部署」
6. 複製產生的「網頁應用程式 URL」
7. 此 URL 格式為：`https://script.google.com/macros/s/[DEPLOY_ID]/exec`

## 步驟 6：測試連線

在瀏覽器中開啟以下網址測試（替換 [DEPLOY_ID] 和 [YOUR_TOKEN]）：

```
https://script.google.com/macros/s/[DEPLOY_ID]/exec?action=getYears&token=[YOUR_TOKEN]
```

若正常，應回傳 JSON 格式的年份列表。

## 步驟 7：更新前端設定

將取得的網址和 TOKEN 填入前端設定頁面：
- GAS 網址：完整 URL（含 `/exec`）
- API Token：您設定的 TOKEN

## ⚠️ 注意事項

1. **每次修改 GAS 程式碼後**，需重新部署：
   - 部署 → 管理部署作業 → 編輯 → 版本 → 新增版本 → 部署

2. **CORS 設定**：GAS 預設允許跨域，若有問題請在 `doGet` 函數中加入：
   ```javascript
   return ContentService
     .createTextOutput(JSON.stringify(result))
     .setMimeType(ContentService.MimeType.JSON);
   ```

3. **除錯**：可在 GAS 編輯器中點擊「執行」→「doGet」測試
