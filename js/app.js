"use strict";
const C = TrackerCore,
  PREFIX = "hw3.1:",
  $ = (id) => document.getElementById(id);
const request = createTrackerApi(fetch.bind(window), C.validGasUrl);
const state = {
  url: "",
  token: "",
  catalog: null,
  active: null,
  manageYear: "",
  manageClass: "",
  csv: null,
  loadId: 0,
  busy: false,
  reportText: "",
  storageOK: true,
  editorId: crypto.randomUUID(),
};
let toastTimer;
function node(tag, text, cls) {
  const e = document.createElement(tag);
  if (text != null) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}
function button(text, action, data = {}, cls = "btn btn-outline btn-sm") {
  const e = node("button", text, cls);
  e.type = "button";
  e.dataset.action = action;
  Object.assign(e.dataset, data);
  return e;
}
function error(message) {
  $("persistent-error").textContent = message;
  $("persistent-error").hidden = !message;
}
function toast(message) {
  $("toast").textContent = message;
  $("toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("show"), 3500);
}
function read(key, fallback = null) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    error("本機快取無法讀取；請保留備份並檢查瀏覽器儲存設定。");
    return fallback;
  }
}
function write(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    state.storageOK = true;
    return true;
  } catch {
    state.storageOK = false;
    error(
      "本機儲存失敗！目前變更只在記憶體，請立即匯出草稿，勿關閉或切換作業。",
    );
    return false;
  }
}
function sourceKey(suffix) {
  return encodeURIComponent(state.url) + ":" + suffix;
}
function api(payload) {
  return request(state.url, state.token, payload);
}
async function run(task, message = "處理中…") {
  if (state.busy) return;
  state.busy = true;
  $("loading-msg").textContent = message;
  $("loading-overlay").hidden = false;
  $("loading-overlay").classList.add("show");
  $("app-shell").inert = true;
  error("");
  try {
    return await task();
  } catch (e) {
    error(e.message);
    toast(e.message);
  } finally {
    state.busy = false;
    $("loading-overlay").hidden = true;
    $("loading-overlay").classList.remove("show");
    $("app-shell").inert = !$("lock-screen").hidden;
  }
}
function download(name, value, type = "application/json") {
  const blob = new Blob(
    [typeof value === "string" ? value : JSON.stringify(value, null, 2)],
    { type },
  );
  const url = URL.createObjectURL(blob),
    a = node("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function localDrafts() {
  const data = {
    schemaVersion: "3.1-drafts",
    exportedAt: new Date().toISOString(),
    drafts: [],
  };
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (
        k.startsWith(PREFIX) &&
        (k.includes(":assignment:") || k.includes(":recovery:"))
      )
        data.drafts.push({
          key: k,
          value: JSON.parse(localStorage.getItem(k)),
        });
    }
  } catch {
    throw new Error("無法讀取所有草稿；請先匯出目前這份草稿");
  }
  if (state.active) data.current = state.active;
  return data;
}
function snapshotRecords(view) {
  const result = Object.create(null);
  view.records.forEach((r) => (result[r.seat_num] = C.record(r)));
  return result;
}
function canonical(active) {
  return JSON.stringify({
    date: active.date,
    records: active.snapshot.students.map((s) => [
      s.seat_num,
      C.record(active.records[s.seat_num]),
    ]),
  });
}
function makeActive(view) {
  if (
    !view.assignment ||
    !Array.isArray(view.students) ||
    !Array.isArray(view.records) ||
    typeof view.revision !== "string"
  )
    throw new Error("雲端作業資料不完整");
  const a = {
    snapshot: view,
    records: snapshotRecords(view),
    date: view.date || "",
    dirty: false,
    conflict: false,
    localConflict: false,
  };
  a.base = canonical(a);
  return a;
}
function persist() {
  if (!state.active) return true;
  // A separate recovery copy per editing session survives racing localStorage writers.
  if (
    state.active.dirty &&
    !write(
      sourceKey(
        "recovery:" +
          state.active.snapshot.assignment.assignment_id +
          ":" +
          state.editorId,
      ),
      state.active,
    )
  )
    return false;
  if (state.active.localConflict) {
    error("另一分頁已有草稿。請先匯出目前內容；暫停覆寫共用草稿。");
    return false;
  }
  const key = sourceKey(
      "assignment:" + state.active.snapshot.assignment.assignment_id,
    ),
    stored = read(key);
  if (
    (stored?.localRevision || null) !== (state.active.localRevision || null)
  ) {
    state.active.conflict = true;
    state.active.localConflict = true;
    error("共用草稿已有較新版本，請匯出目前內容後核對。");
    return false;
  }
  state.active.updatedAt = new Date().toISOString();
  const previous = state.active.localRevision;
  state.active.localRevision = crypto.randomUUID();
  const saved = write(key, state.active);
  if (!saved) state.active.localRevision = previous;
  return saved;
}
function checkpoint() {
  return !state.active || !state.active.dirty || persist();
}
function changed() {
  state.active.dirty = canonical(state.active) !== state.active.base;
  persist();
  renderProgress();
}
function chooseOptions(select, items, placeholder, previous) {
  select.replaceChildren(new Option(placeholder, ""));
  items.forEach(([value, label]) => select.add(new Option(label, value)));
  if (items.some((x) => x[0] === previous)) select.value = previous;
  select.disabled = !items.length;
}
function createSelectors(prefix, container) {
  ["year", "class", "subject", "unit"].forEach((part, i) => {
    const div = node("div", null, "field"),
      label = node("label", ["學年度", "班級", "科目", "作業"][i]),
      select = node("select");
    select.id = prefix + "-" + part;
    label.htmlFor = select.id;
    div.append(label, select);
    container.append(div);
    select.addEventListener("change", () => {
      if (state.busy) {
        if (prefix === "input") restoreSelection();
        return;
      }
      if (prefix === "input" && !checkpoint()) {
        restoreSelection();
        return;
      }
      const next = ["year", "class", "subject", "unit"];
      next.slice(i + 1).forEach((p) => ($(prefix + "-" + p).value = ""));
      populate(prefix);
      if (prefix === "input") {
        state.loadId++;
        state.active = null;
        $("assignment-panel").hidden = true;
        $("input-empty").hidden = false;
        write(sourceKey("selection"), selection(prefix));
        if ($("input-unit").value) loadAssignment($("input-unit").value);
      } else clearReport();
    });
  });
}
function selection(prefix) {
  return {
    year: $(prefix + "-year").value,
    class_name: $(prefix + "-class").value,
    subject: $(prefix + "-subject").value,
    assignment_id: $(prefix + "-unit").value,
  };
}
function populate(prefix) {
  const cat = state.catalog || {
      years: [],
      classes: [],
      subjects: [],
      assignments: [],
    },
    prev = selection(prefix);
  chooseOptions(
    $(prefix + "-year"),
    cat.years.map((y) => [y, y + " 學年度"]),
    "請選擇學年度",
    prev.year,
  );
  const year = $(prefix + "-year").value;
  chooseOptions(
    $(prefix + "-class"),
    cat.classes
      .filter((c) => c.year === year)
      .map((c) => [c.class_name, c.class_name]),
    "請選擇班級",
    prev.class_name,
  );
  const cls = $(prefix + "-class").value;
  chooseOptions(
    $(prefix + "-subject"),
    cat.subjects
      .filter((s) => s.year === year && s.class_name === cls)
      .map((s) => [s.subject, s.subject]),
    "請選擇科目",
    prev.subject,
  );
  const subject = $(prefix + "-subject").value;
  chooseOptions(
    $(prefix + "-unit"),
    cat.assignments
      .filter(
        (a) => a.year === year && a.class_name === cls && a.subject === subject,
      )
      .map((a) => [a.assignment_id, a.unit]),
    "請選擇作業",
    prev.assignment_id,
  );
}
function restoreSelection(saved) {
  saved =
    saved ||
    (state.active && state.active.snapshot.assignment) ||
    read(sourceKey("selection"));
  if (!saved) return;
  ["year", "class", "subject", "unit"].forEach((part, i) => {
    populate("input");
    $("input-" + part).value =
      saved[["year", "class_name", "subject", "assignment_id"][i]] || "";
  });
}
function validateCatalog(data) {
  if (
    !["years", "classes", "subjects", "students", "assignments"].every((k) =>
      Array.isArray(data[k]),
    ) ||
    typeof data.revision !== "string"
  )
    throw new Error("雲端清單格式不正確");
}
async function refreshCatalog() {
  const data = await api({ action: "getCatalog" });
  validateCatalog(data);
  state.catalog = data;
  write(sourceKey("catalog"), data);
  ["input", "report"].forEach(populate);
  renderManage();
  $("connection-status").textContent =
    "已連線 · 清單更新於 " + new Date().toLocaleTimeString("zh-TW");
  if (state.active) {
    const id = state.active.snapshot.assignment.assignment_id,
      a = data.assignments.find((x) => x.assignment_id === id);
    if (
      !a ||
      JSON.stringify(a) !== JSON.stringify(state.active.snapshot.assignment)
    ) {
      state.active.conflict = true;
      renderProgress();
    }
  }
}
async function loadAssignment(id) {
  const seq = ++state.loadId,
    cached = read(sourceKey("assignment:" + id));
  $("input-empty").textContent = "載入作業中…";
  try {
    const view = await api({ action: "getAssignment", assignment_id: id });
    if (seq !== state.loadId) return;
    if (
      !view.assignment ||
      !Array.isArray(view.students) ||
      !Array.isArray(view.records) ||
      !view.revision
    )
      throw new Error("雲端作業資料不完整");
    const fresh = makeActive(view);
    if (cached && cached.dirty) {
      // An earlier write may have succeeded even if its response was lost.
      if (
        canonical(fresh) === canonical(cached) &&
        JSON.stringify(view.students) ===
          JSON.stringify(cached.snapshot.students)
      )
        state.active = fresh;
      else {
        state.active = cached;
        state.active.conflict = cached.snapshot.revision !== view.revision;
      }
    } else state.active = fresh;
    state.active.localRevision = cached?.localRevision || null;
    persist();
    renderAssignment();
  } catch (e) {
    if (seq !== state.loadId) return;
    if (cached && cached.snapshot) {
      state.active = cached;
      renderAssignment();
      error(e.message + "。目前顯示本機快取，尚未核對雲端。");
    } else {
      $("input-empty").textContent = "無法載入作業；請確認連線後重新選擇。";
      error(e.message);
    }
  }
}
function renderRow(student) {
  const rec = C.record(state.active.records[student.seat_num]),
    row = node("div", null, "student-row");
  row.dataset.seat = student.seat_num;
  if (rec.status) row.classList.add("selected-" + rec.status);
  row.append(
    node("div", student.seat_num, "student-num"),
    node("div", student.name, "student-name"),
  );
  const statuses = node("div", null, "status-btns");
  ["submitted", "late", "missing", "exempt"].forEach((s, i) => {
    const btn = button(
      ["✅", "⏰", "❌", "〇"][i],
      "status",
      { seat: student.seat_num, status: s },
      "status-btn",
    );
    btn.setAttribute("aria-label", student.seat_num + " 號 " + C.labels[s]);
    btn.setAttribute("aria-pressed", String(s === rec.status));
    btn.title = C.labels[s];
    if (s === rec.status) btn.classList.add("active-" + s);
    statuses.append(btn);
  });
  row.append(statuses);
  const grade = node("select", null, "grade-select");
  grade.dataset.seat = student.seat_num;
  grade.setAttribute("aria-label", student.seat_num + " 號等第");
  grade.add(new Option("未評分", ""));
  Object.entries(C.grades).forEach(([g, score]) => grade.add(new Option(g, g)));
  grade.value =
    Object.keys(C.grades).find((g) => C.grades[g] === rec.score) || "";
  grade.disabled = !["submitted", "late"].includes(rec.status);
  row.append(
    grade,
    node("div", rec.score === "" ? "—" : String(rec.score), "score-display"),
  );
  return row;
}
function renderAssignment() {
  $("input-empty").hidden = true;
  $("assignment-panel").hidden = false;
  const a = state.active.snapshot.assignment;
  $("assignment-title").textContent =
    a.year + " 學年度 · " + a.class_name + " · " + a.subject + " · " + a.unit;
  $("hw-date").value = state.active.date;
  $("student-list").replaceChildren(
    ...state.active.snapshot.students.map(renderRow),
  );
  renderProgress();
}
function renderProgress() {
  if (!state.active) return;
  const a = state.active,
    totals = C.summarize(a.snapshot.students, a.records);
  $("progress-label").textContent =
    `已登記 ${totals.registered}／${totals.total} 人（免交 ${totals.exempt} 人）`;
  $("progress").value = totals.total
    ? (totals.registered / totals.total) * 100
    : 0;
  $("draft-status").textContent = a.conflict
    ? "雲端或另一分頁已有變更，請匯出草稿後核對；送出已暫停。"
    : a.dirty
      ? state.storageOK
        ? "本機草稿已保留，尚未同步"
        : "尚未保存！請立即匯出草稿"
      : "已載入紀錄，目前沒有未送出的變更";
  $("save-assignment").disabled = a.conflict || !totals.total;
}
async function saveAssignment() {
  if (!state.active || state.active.conflict)
    throw new Error("請先載入並核對作業");
  const a = state.active,
    id = a.snapshot.assignment.assignment_id;
  const result = await api({
    action: "saveAssignment",
    assignment_id: id,
    revision: a.snapshot.revision,
    date: a.date,
    records: a.snapshot.students.map((s) => ({
      seat_num: s.seat_num,
      ...C.record(a.records[s.seat_num]),
    })),
  });
  if (
    !result.revision ||
    result.saved !== a.snapshot.students.length ||
    !Array.isArray(result.records)
  )
    throw new Error("儲存回應不完整，草稿仍保留");
  if (state.active !== a)
    throw new Error("儲存結果已收到，但目前作業已切換；請重新載入核對");
  state.active = makeActive(result);
  state.active.localRevision = a.localRevision;
  persist();
  renderAssignment();
  toast("伺服器已確認儲存 " + result.saved + " 位學生");
  try {
    await refreshCatalog();
  } catch {
    error("作業已確認儲存；班級清單更新失敗，請稍後重新整理清單。");
  }
}
function clearReport() {
  $("report-output").hidden = true;
  $("report-actions").hidden = true;
  state.reportText = "";
}
function table(headers, rows) {
  const tbl = node("table"),
    thead = node("thead"),
    tr = node("tr");
  headers.forEach((h) => tr.append(node("th", h)));
  thead.append(tr);
  tbl.append(thead);
  const body = node("tbody");
  rows.forEach((values) => {
    const r = node("tr");
    values.forEach((v) => r.append(node("td", v)));
    body.append(r);
  });
  tbl.append(body);
  return tbl;
}
async function report(overview) {
  const pick = selection("report");
  if (
    !pick.year ||
    !pick.class_name ||
    !pick.subject ||
    (!overview && !pick.assignment_id)
  )
    throw new Error("請完整選擇要查詢的班級與作業");
  clearReport();
  const data = await api(
    overview
      ? { action: "getOverview", ...pick }
      : { action: "getAssignment", assignment_id: pick.assignment_id },
  );
  const out = $("report-output");
  out.replaceChildren();
  const title = overview
    ? pick.class_name + " · " + pick.subject + " 全班總覽"
    : data.assignment.class_name +
      " · " +
      data.assignment.subject +
      " · " +
      data.assignment.unit;
  out.append(
    node("h2", title),
    node(
      "p",
      pick.year +
        " 學年度 · " +
        (data.date ? "登記日期 " + data.date + " · " : "") +
        "產生於 " +
        new Date().toLocaleString("zh-TW"),
    ),
  );
  if (overview) {
    const map = new Map(
      data.records.map((r) => [
        JSON.stringify([r.assignment_id, r.seat_num]),
        r,
      ]),
    );
    const rates = data.assignments.map((a) => {
      const records = Object.fromEntries(
        data.students.map((s) => [
          s.seat_num,
          map.get(JSON.stringify([a.assignment_id, s.seat_num])),
        ]),
      );
      const stats = C.summarize(data.students, records);
      return stats.rate == null ? "不適用" : stats.rate + "%";
    });
    out.append(
      table(
        ["座號", "代稱", ...data.assignments.map((a) => a.unit)],
        [
          ["", "繳交率（免交不計）", ...rates],
          ...data.students.map((s) => [
            s.seat_num,
            s.name,
            ...data.assignments.map((a) => {
              const r = C.record(
                map.get(JSON.stringify([a.assignment_id, s.seat_num])),
              );
              return C.labels[r.status] + (r.score !== "" ? " " + r.score : "");
            }),
          ]),
        ],
      ),
    );
  } else {
    const records = snapshotRecords(data),
      stats = C.summarize(data.students, records);
    out.append(
      node(
        "p",
        `全班 ${stats.total} 人 · 已繳 ${stats.submitted} · 補交 ${stats.late} · 缺交 ${stats.missing} · 免交 ${stats.exempt} · 未登記 ${stats.unregistered}`,
      ),
    );
    out.append(
      node(
        "p",
        stats.rate == null
          ? "無需繳交學生；繳交率不適用"
          : `繳交率 ${stats.rate}%（已繳＋補交／應繳 ${stats.required} 人；免交不計入）`,
      ),
    );
    out.append(
      table(
        ["座號", "代稱", "狀態", "分數"],
        data.students.map((s) => {
          const r = C.record(records[s.seat_num]);
          return [
            s.seat_num,
            s.name,
            C.labels[r.status],
            r.score === "" ? "—" : r.score,
          ];
        }),
      ),
    );
  }
  out.hidden = false;
  out.classList.add("show");
  $("report-actions").hidden = false;
  state.reportText = Array.from(out.children)
    .map((e) =>
      e.tagName === "TABLE"
        ? Array.from(e.rows)
            .map((r) =>
              Array.from(r.cells)
                .map((c) => c.textContent)
                .join("\t"),
            )
            .join("\n")
        : e.textContent,
    )
    .join("\n");
}
function cancelCSV() {
  state.csv = null;
  $("csv-preview").hidden = true;
  $("csv-file").value = "";
}
function renderManage() {
  const cat = state.catalog;
  if (!cat) return;
  chooseOptions(
    $("manage-year"),
    cat.years.map((y) => [y, y + " 學年度"]),
    "請選擇學年度",
    state.manageYear,
  );
  state.manageYear = $("manage-year").value;
  const classes = cat.classes.filter((c) => c.year === state.manageYear);
  if (!classes.some((c) => c.class_name === state.manageClass))
    state.manageClass = "";
  $("class-grid").replaceChildren(
    ...classes.map((c) => {
      const count = cat.students.filter(
        (s) => s.year === c.year && s.class_name === c.class_name,
      ).length;
      const btn = button(
        c.class_name + " · " + count + " 人",
        "choose-class",
        { className: c.class_name },
        "class-card",
      );
      btn.setAttribute(
        "aria-pressed",
        String(c.class_name === state.manageClass),
      );
      return btn;
    }),
  );
  $("manage-detail").hidden = !state.manageClass;
  $("delete-year").disabled = !state.manageYear;
  if (!state.manageClass) return;
  $("manage-title").textContent =
    state.manageYear + " 學年度 · " + state.manageClass;
  const matches = (r) =>
    r.year === state.manageYear && r.class_name === state.manageClass;
  $("roster-list").replaceChildren(
    ...cat.students
      .filter(matches)
      .sort((a, b) => Number(a.seat_num) - Number(b.seat_num))
      .map((s) => {
        const row = node("div", null, "mgmt-student-row");
        row.append(
          node("span", s.seat_num + " " + s.name),
          button("刪除", "delete-student", { seat: s.seat_num }),
        );
        return row;
      }),
  );
  $("subject-list").replaceChildren(
    ...cat.subjects.filter(matches).map((s) => {
      const card = node("section", null, "subject-card"),
        header = node("div", null, "action-row");
      header.append(
        node("h4", s.subject),
        button("刪除科目", "delete-subject", { subject: s.subject }),
      );
      card.append(header);
      cat.assignments
        .filter((a) => matches(a) && a.subject === s.subject)
        .forEach((a) => {
          const row = node("div", null, "action-row");
          row.append(
            node("span", a.unit),
            button("刪除作業", "delete-unit", {
              assignmentId: a.assignment_id,
              unit: a.unit,
            }),
          );
          card.append(row);
        });
      card.append(button("新增作業", "add-unit", { subject: s.subject }));
      return card;
    }),
  );
}
async function manage(operation, extra = {}) {
  if (!state.catalog) throw new Error("請先連線");
  const result = await api({
    action: "manage",
    operation,
    year: state.manageYear,
    class_name: state.manageClass,
    revision: state.catalog.revision,
    ...extra,
  });
  validateCatalog(result.catalog);
  state.catalog = result.catalog;
  write(sourceKey("catalog"), result.catalog);
  if (operation === "renameClass") state.manageClass = extra.new_name;
  cancelCSV();
  renderManage();
  ["input", "report"].forEach(populate);
  clearReport();
  if (state.active) {
    state.active.conflict = true;
    persist();
    renderProgress();
  }
  toast("已完成，伺服器已核對資料");
}
function ask(label, initial = "") {
  const answer = prompt(label, initial);
  return answer == null ? null : C.safeText(answer, label);
}
function confirmDelete(label) {
  return confirm(
    "確定刪除「" +
      label +
      "」及相關紀錄？\n雲端會先留下備份；一般操作無法直接復原。",
  );
}
function switchTab(name) {
  if (state.busy) return;
  document.querySelectorAll("[data-tab]").forEach((b) => {
    const active = b.dataset.tab === name;
    b.classList.toggle("active", active);
    b.setAttribute("aria-selected", String(active));
    b.tabIndex = active ? 0 : -1;
  });
  ["input", "report", "manage", "settings"].forEach((p) => {
    const active = p === name;
    $("page-" + p).hidden = !active;
    $("page-" + p).classList.toggle("active", active);
  });
}
async function connect() {
  const url = C.validGasUrl($("gas-url").value.trim()),
    token = $("gas-token").value.trim();
  if (token.length < 24)
    throw new Error("Token 至少 24 字元，需與 GAS Script Properties 相同");
  if (!checkpoint()) return;
  const cat = await request(url, token, { action: "getCatalog" });
  validateCatalog(cat);
  state.url = url;
  state.token = token;
  state.catalog = cat;
  state.active = null;
  state.loadId++;
  state.manageYear = "";
  state.manageClass = "";
  cancelCSV();
  write("url", url);
  write(sourceKey("catalog"), cat);
  try {
    sessionStorage.setItem(PREFIX + "token", JSON.stringify({ url, token }));
  } catch {
    error("此分頁無法保存 Token，重新整理後需再輸入。");
  }
  $("assignment-panel").hidden = true;
  $("input-empty").hidden = false;
  $("input-empty").textContent = "請選擇班級與作業。";
  ["input", "report"].forEach(populate);
  renderManage();
  clearReport();
  $("connection-status").textContent = "已連線 · GAS 3.1";
  toast("連線與版本核對成功");
}
async function unlock() {
  const password = read("password", null) || legacy("login_password") || "1234";
  if ($("lock-input").value !== password) {
    $("lock-error").textContent = "密碼不正確";
    $("lock-input").value = "";
    return;
  }
  $("lock-error").textContent = "";
  $("lock-input").value = "";
  $("lock-screen").hidden = true;
  $("app-shell").inert = false;
  $("tab-input").focus();
  await run(async () => {
    if (state.token) {
      try {
        await refreshCatalog();
      } catch (e) {
        error(e.message);
      }
    }
    if (!state.active && $("input-unit").value)
      await loadAssignment($("input-unit").value);
  }, "讀取資料…");
}
function legacy(key) {
  try {
    return localStorage.getItem(PREFIX + "legacy-disabled")
      ? ""
      : localStorage.getItem(key);
  } catch {
    return "";
  }
}
function lock() {
  if (state.busy) return;
  checkpoint();
  $("app-shell").inert = true;
  $("lock-screen").hidden = false;
  $("lock-input").focus();
}
function bind(id, handler) {
  $(id).addEventListener("click", () => run(handler));
}
function boot() {
  state.url = read("url", "") || legacy("gas_url");
  try {
    const saved = JSON.parse(
      sessionStorage.getItem(PREFIX + "token") || "null",
    );
    if (saved && saved.url === state.url) state.token = saved.token;
  } catch {}
  $("gas-url").value = state.url;
  $("gas-token").value = state.token;
  createSelectors("input", $("input-selectors"));
  createSelectors("report", $("report-selectors"));
  state.catalog = read(sourceKey("catalog"));
  if (state.catalog) {
    try {
      validateCatalog(state.catalog);
    } catch {
      state.catalog = null;
    }
  }
  ["input", "report"].forEach(populate);
  renderManage();
  restoreSelection();
  $("grade-guide").textContent = Object.entries(C.grades)
    .map(([g, n]) => g + "＝" + n)
    .join("　");
  $("unlock-btn").addEventListener("click", unlock);
  $("lock-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") unlock();
  });
  $("lock-btn").addEventListener("click", lock);
  $("lock-screen").addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const first = $("lock-input"),
      last = $("unlock-btn");
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
  document.querySelectorAll("[data-tab]").forEach((b, index, list) => {
    b.addEventListener("click", () => switchTab(b.dataset.tab));
    b.addEventListener("keydown", (e) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
      e.preventDefault();
      const i =
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? list.length - 1
            : (index + (e.key === "ArrowRight" ? 1 : -1) + list.length) %
              list.length;
      switchTab(list[i].dataset.tab);
      list[i].focus();
    });
  });
  $("student-list").addEventListener("click", (e) => {
    const b = e.target.closest('[data-action="status"]');
    if (!b || !state.active || state.busy) return;
    state.active.records[b.dataset.seat] = C.changeStatus(
      state.active.records[b.dataset.seat],
      b.dataset.status,
    );
    const student = state.active.snapshot.students.find(
        (s) => s.seat_num === b.dataset.seat,
      ),
      row = renderRow(student),
      old = b.closest(".student-row");
    old.replaceWith(row);
    Array.from(row.querySelectorAll("button"))
      .find((x) => x.dataset.status === b.dataset.status)
      .focus();
    changed();
  });
  $("student-list").addEventListener("change", (e) => {
    if (!e.target.matches(".grade-select") || !state.active || state.busy)
      return;
    const rec = state.active.records[e.target.dataset.seat];
    rec.score = e.target.value ? C.grades[e.target.value] : "";
    e.target
      .closest(".student-row")
      .querySelector(".score-display").textContent =
      rec.score === "" ? "—" : String(rec.score);
    changed();
  });
  $("hw-date").addEventListener("change", () => {
    if (state.active && !state.busy) {
      state.active.date = $("hw-date").value;
      changed();
    }
  });
  document.querySelectorAll("[data-batch]").forEach((b) =>
    b.addEventListener("click", () => {
      if (
        state.busy ||
        !state.active ||
        !confirm("將套用至全班；原有狀態或分數可能變更。繼續？")
      )
        return;
      state.active.snapshot.students.forEach((s) => {
        const prev = C.record(state.active.records[s.seat_num]);
        state.active.records[s.seat_num] = C.record({
          status: b.dataset.batch,
          score: ["submitted", "late"].includes(prev.status) ? prev.score : "",
        });
      });
      changed();
      renderAssignment();
    }),
  );
  bind("save-assignment", async () => {
    try {
      await saveAssignment();
    } catch (e) {
      if (e.code === "CONFLICT") {
        state.active.conflict = true;
        persist();
        renderProgress();
      }
      throw e;
    }
  });
  bind("reload-assignment", async () => {
    if (state.active && checkpoint())
      await loadAssignment(state.active.snapshot.assignment.assignment_id);
  });
  bind("export-draft", () => {
    if (state.active)
      download("作業草稿.json", {
        schemaVersion: "3.1-draft",
        data: state.active,
      });
  });
  bind("discard-draft", async () => {
    if (
      !state.active ||
      !confirm("放棄這份本機草稿並重新載入雲端？請先匯出需要保留的變更。")
    )
      return;
    const id = state.active.snapshot.assignment.assignment_id;
    const view = await api({ action: "getAssignment", assignment_id: id });
    state.active = makeActive(view);
    state.active.localRevision =
      read(sourceKey("assignment:" + id))?.localRevision || null;
    persist();
    renderAssignment();
  });
  bind("single-report", () => report(false));
  bind("overview-report", () => report(true));
  bind("copy-report", async () => {
    if (!navigator.clipboard)
      throw new Error("此瀏覽器不支援直接複製，請使用報表列印或手動選取");
    await navigator.clipboard.writeText(state.reportText);
    toast("報表文字已複製");
  });
  $("print-report").addEventListener("click", () => window.print());
  bind("image-report", async () => {
    if (!window.html2canvas)
      await new Promise((resolve, reject) => {
        const script = node("script");
        script.src = "vendor/html2canvas.min.js";
        script.onload = resolve;
        script.onerror = () => {
          script.remove();
          reject(new Error("圖片工具載入失敗，請改用列印／PDF"));
        };
        document.head.append(script);
      });
    const element = $("report-output");
    if (element.scrollWidth * element.scrollHeight > 12000000)
      throw new Error("報表過大，請改用列印／PDF");
    const canvas = await html2canvas(element, {
      scale: 2,
      backgroundColor: "#ffffff",
      windowWidth: Math.max(1000, element.scrollWidth),
      onclone: (doc) => {
        const e = doc.getElementById("report-output");
        e.style.width = Math.max(800, element.scrollWidth) + "px";
        e.style.maxWidth = "none";
        e.style.overflow = "visible";
      },
    });
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!blob) throw new Error("圖片產生失敗");
    const url = URL.createObjectURL(blob),
      a = node("a");
    a.href = url;
    a.download = "作業報表.png";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $("manage-year").addEventListener("change", () => {
    state.manageYear = $("manage-year").value;
    state.manageClass = "";
    cancelCSV();
    renderManage();
  });
  $("page-manage").addEventListener("click", (e) => {
    const b = e.target.closest("[data-action]");
    if (!b) return;
    run(async () => {
      const d = b.dataset;
      if (d.action === "choose-class") {
        state.manageClass = d.className;
        cancelCSV();
        renderManage();
        return;
      }
      if (d.action === "add-unit") {
        const unit = ask("作業名稱");
        if (unit) await manage("addUnit", { subject: d.subject, unit });
      }
      if (d.action === "delete-unit" && confirmDelete(d.unit))
        await manage("deleteUnit", { assignment_id: d.assignmentId });
      if (
        d.action === "delete-subject" &&
        confirmDelete(d.subject + "科目及所有作業")
      )
        await manage("deleteSubject", { subject: d.subject });
      if (
        d.action === "delete-student" &&
        confirmDelete(d.seat + " 號學生及其作業紀錄")
      )
        await manage("deleteStudent", { seat_num: d.seat });
    });
  });
  bind("add-year", async () => {
    const year = ask("請輸入學年度，例如 115");
    if (year) {
      await manage("addYear", { year });
      state.manageYear = year;
      renderManage();
    }
  });
  bind("delete-year", async () => {
    if (
      state.manageYear &&
      confirmDelete(state.manageYear + " 學年度的所有班級及紀錄")
    ) {
      await manage("deleteYear");
    }
  });
  bind("add-class", async () => {
    const name = C.safeText($("new-class").value, "班級名稱");
    await manage("addClass", {
      class_name: name,
      subjects: $("new-subjects")
        .value.split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean),
    });
    state.manageClass = name;
    renderManage();
    $("new-class").value = "";
    $("new-subjects").value = "";
  });
  bind("rename-class", async () => {
    const name = ask("新班級名稱", state.manageClass);
    if (name) await manage("renameClass", { new_name: name });
  });
  bind("delete-class", async () => {
    if (confirmDelete(state.manageClass + "班級及所有紀錄"))
      await manage("deleteClass");
  });
  bind("add-subject", async () => {
    const subject = ask("科目名稱");
    if (subject) await manage("addSubject", { subject });
  });
  $("csv-file").addEventListener("change", () =>
    run(async () => {
      const file = $("csv-file").files[0];
      if (!file) return;
      state.csv = null;
      $("csv-preview").hidden = true;
      if (!/\.csv$/i.test(file.name) || file.size > 1000000)
        throw new Error("請選擇 1 MB 內的 CSV");
      const target = { year: state.manageYear, class_name: state.manageClass };
      const students = C.parseCSV(await file.text());
      if (
        target.year !== state.manageYear ||
        target.class_name !== state.manageClass
      )
        throw new Error("選擇的班級已變更，請重新匯入");
      state.csv = { ...target, students };
      $("csv-preview-title").textContent =
        `${target.class_name}：共 ${students.length} 位，預覽前 5 位`;
      $("csv-preview-body").replaceChildren(
        ...students.slice(0, 5).map((s) => {
          const r = node("tr");
          r.append(node("td", s.seat_num), node("td", s.name));
          return r;
        }),
      );
      $("csv-preview").hidden = false;
    }),
  );
  bind("confirm-csv", async () => {
    const csv = state.csv;
    if (
      !csv ||
      csv.year !== state.manageYear ||
      csv.class_name !== state.manageClass
    )
      throw new Error("請重新選擇名冊");
    if (
      confirm(
        "以預覽的 " +
          csv.students.length +
          " 位學生取代 " +
          csv.class_name +
          " 名冊？",
      )
    )
      await manage("importStudents", { students: csv.students });
  });
  $("cancel-csv").addEventListener("click", cancelCSV);
  bind("connect", connect);
  bind("refresh-catalog", refreshCatalog);
  bind("change-password", () => {
    const current =
        read("password", null) || legacy("login_password") || "1234",
      pwd = $("new-password").value;
    if ($("old-password").value !== current) throw new Error("目前密碼不正確");
    if (pwd.length < 4 || pwd.length > 64)
      throw new Error("密碼須為 4–64 字元");
    if (!write("password", pwd)) throw new Error("密碼儲存失敗");
    $("old-password").value = "";
    $("new-password").value = "";
    toast("本機密碼已更新");
  });
  bind("export-cloud", async () =>
    download("作業雲端備份.json", await api({ action: "exportBackup" })),
  );
  bind("export-local", () => download("作業本機草稿備份.json", localDrafts()));
  bind("clear-local", () => {
    if (
      !confirm(
        "清除此版本所有本機草稿與設定？請先匯出備份。雲端與 V2.7 資料不會受影響。",
      )
    )
      return;
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith(PREFIX)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
    localStorage.setItem(PREFIX + "legacy-disabled", "true");
    sessionStorage.removeItem(PREFIX + "token");
    state.active = null;
    location.reload();
  });
  window.addEventListener("beforeunload", (e) => {
    if (state.active && state.active.dirty) {
      persist();
      e.preventDefault();
      e.returnValue = "";
    }
  });
  window.addEventListener(
    "offline",
    () =>
      ($("connection-status").textContent =
        "離線 · 已快取作業可繼續登記；請連線後送出"),
  );
  window.addEventListener(
    "online",
    () =>
      ($("connection-status").textContent =
        "網路已恢復 · 請重新整理或送出以核對雲端"),
  );
  window.addEventListener("storage", (e) => {
    if (
      state.active &&
      e.key ===
        PREFIX +
          sourceKey(
            "assignment:" + state.active.snapshot.assignment.assignment_id,
          )
    ) {
      state.active.conflict = true;
      state.active.localConflict = true;
      renderProgress();
      error("另一分頁修改或移除了同一份草稿，請匯出目前內容後核對。");
    }
  });
  $("lock-input").focus();
}
document.addEventListener("DOMContentLoaded", boot);
