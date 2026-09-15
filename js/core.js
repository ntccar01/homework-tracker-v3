/* Shared, side-effect-free classroom data rules. */
(function (root, factory) {
  const core = factory();
  if (typeof module === "object" && module.exports) module.exports = core;
  else root.TrackerCore = core;
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";
  const grades = Object.freeze({
    "A+": 100,
    A: 95,
    "A-": 90,
    "B+": 85,
    B: 80,
    "B-": 75,
    "C+": 70,
    C: 65,
    "C-": 60,
    "D+": 55,
    D: 50,
    "D-": 45,
    E: 40,
  });
  const statuses = ["", "submitted", "late", "missing", "exempt"];
  const labels = {
    "": "未登記",
    submitted: "已繳",
    late: "補交",
    missing: "缺交",
    exempt: "免交",
  };
  function seat(value) {
    const text = String(value == null ? "" : value).trim();
    if (!/^\d{1,3}$/.test(text) || Number(text) < 1)
      throw new Error("座號須為 1–999 的數字");
    return String(Number(text)).padStart(2, "0");
  }
  function safeText(value, label, max = 80) {
    const text = String(value == null ? "" : value).trim();
    if (
      !text ||
      text.length > max ||
      /^[=+\-@]/.test(text) ||
      /[\x00-\x1f]/.test(text)
    ) {
      throw new Error(label + "不可空白、過長或以試算表公式符號開頭");
    }
    return text;
  }
  function record(value = {}) {
    const status = value.status || "";
    if (!statuses.includes(status)) throw new Error("不支援的繳交狀態");
    if (!status) return { status: "", score: "", note: "" };
    if (status === "missing") return { status, score: 0, note: "" };
    if (status === "exempt") return { status, score: "", note: "" };
    const score =
      value.score === "" || value.score == null ? "" : Number(value.score);
    if (score !== "" && (!Number.isFinite(score) || score < 0 || score > 100))
      throw new Error("分數須介於 0–100");
    return { status, score, note: status === "late" ? "補交" : "" };
  }
  function changeStatus(previous, status) {
    const old = record(previous);
    if (old.status === status) return record();
    const scored = ["submitted", "late"].includes(old.status);
    return record({ status, score: scored ? old.score : "" });
  }
  function summarize(students, records) {
    const result = {
      total: students.length,
      submitted: 0,
      late: 0,
      missing: 0,
      exempt: 0,
      unregistered: 0,
    };
    students.forEach((s) => {
      const status = (records[s.seat_num] || {}).status || "";
      result[status || "unregistered"]++;
    });
    result.registered = result.total - result.unregistered;
    result.required = result.total - result.exempt;
    result.rate = result.required
      ? Math.round(((result.submitted + result.late) / result.required) * 100)
      : null;
    return result;
  }
  function parseCSV(text) {
    if (typeof text !== "string" || text.length > 1000000)
      throw new Error("CSV 請限制在 1 MB 內");
    const rows = [];
    let row = [],
      field = "",
      quoted = false,
      closed = false;
    text = text.replace(/^\uFEFF/, "");
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') {
          field += '"';
          i++;
        } else if (ch === '"') {
          quoted = false;
          closed = true;
        } else field += ch;
      } else if (ch === '"') {
        if (field.trim() || closed) throw new Error("CSV 引號格式錯誤");
        field = "";
        quoted = true;
      } else if (ch === "," || ch === "\n" || ch === "\r") {
        row.push(field.trim());
        field = "";
        closed = false;
        if (ch !== ",") {
          if (row.some(Boolean)) rows.push(row);
          row = [];
          if (ch === "\r" && text[i + 1] === "\n") i++;
        }
      } else {
        if (closed && ch.trim()) throw new Error("CSV 引號後有多餘內容");
        if (!closed) field += ch;
      }
    }
    if (quoted) throw new Error("CSV 有未閉合的引號");
    row.push(field.trim());
    if (row.some(Boolean)) rows.push(row);
    if (rows.length < 2) throw new Error("CSV 需要標題列與至少一位學生");
    const headers = rows.shift().map((x) => x.toLowerCase());
    const seatCol = headers.findIndex((x) =>
      ["座號", "seat_num", "num"].includes(x),
    );
    const nameCol = headers.findIndex((x) =>
      ["姓名", "代稱", "name"].includes(x),
    );
    if (seatCol < 0 || nameCol < 0)
      throw new Error(
        "標題須包含「座號」與「姓名」或「代稱」；學號請先轉成座號",
      );
    if (rows.length > 200) throw new Error("單班最多匯入 200 位學生");
    const seen = new Set();
    return rows
      .map((r, i) => {
        if (r.length !== headers.length)
          throw new Error("CSV 第 " + (i + 2) + " 列欄位數不一致");
        const num = seat(r[seatCol]);
        if (seen.has(num)) throw new Error("重複座號：" + num);
        seen.add(num);
        return {
          seat_num: num,
          name: safeText(r[nameCol], "第 " + (i + 2) + " 列代稱"),
        };
      })
      .sort((a, b) => Number(a.seat_num) - Number(b.seat_num));
  }
  function validGasUrl(value) {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "script.google.com" ||
      !/^\/macros\/s\/[\w-]+\/exec$/.test(url.pathname) ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error("請填入完整的 Google Apps Script /exec 部署網址");
    }
    return url.href;
  }
  return {
    grades,
    statuses,
    labels,
    seat,
    safeText,
    record,
    changeStatus,
    summarize,
    parseCSV,
    validGasUrl,
  };
});
