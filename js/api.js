(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else root.createTrackerApi = factory;
})(
  typeof globalThis === "object" ? globalThis : this,
  function (fetcher, validateUrl) {
    "use strict";
    return async function request(url, token, payload) {
      url = validateUrl(url);
      if (!token) throw new Error("請至設定輸入本次分頁的 API Token");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      try {
        const response = await fetcher(url, {
          method: "POST",
          mode: "cors",
          credentials: "omit",
          redirect: "follow",
          headers: { "Content-Type": "text/plain;charset=UTF-8" },
          body: JSON.stringify({ ...payload, token }),
          signal: controller.signal,
        });
        if (!response.ok || response.type === "opaque")
          throw new Error("伺服器未回傳可驗證的成功回應");
        let data;
        try {
          data = await response.json();
        } catch {
          throw new Error("回應不是 JSON；請檢查 GAS 部署存取權與版本");
        }
        if (data.apiVersion !== "3.1")
          throw new Error("GAS 版本不符；請先更新後端至 3.1");
        if (data.success !== true) {
          const error = new Error(data.error || "操作失敗");
          error.code = data.code;
          throw error;
        }
        return data;
      } catch (error) {
        if (error.name === "AbortError")
          throw new Error(
            "連線逾時，無法確認是否已寫入；草稿保留，請重新載入雲端核對",
          );
        if (error instanceof TypeError)
          throw new Error(
            "無法確認雲端結果；請檢查網路與 GAS 跨來源存取，草稿仍保留",
          );
        throw error;
      } finally {
        clearTimeout(timer);
      }
    };
  },
);
