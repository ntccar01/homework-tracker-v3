const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM, VirtualConsole } = require("jsdom");
const { root, TOKEN, seeded } = require("./helpers.cjs");
const URL = "https://script.google.com/macros/s/TEST/exec";
const prefix = "hw3.1:";
const scoped = (s) => prefix + encodeURIComponent(URL) + ":" + s;
const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise(setImmediate);
};
async function ui(b = seeded(), stored = {}) {
  const errors = [],
    vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errors.push(e.message));
  const dom = new JSDOM(
    fs.readFileSync(path.join(root, "index.html"), "utf8"),
    {
      url: "https://tracker.test/",
      runScripts: "outside-only",
      pretendToBeVisual: true,
      virtualConsole: vc,
    },
  );
  const w = dom.window;
  w.confirm = () => true;
  w.prompt = () => null;
  const hook = { request: (p) => b.post(p) };
  w.fetch = async (_url, options) => ({
    ok: true,
    type: "cors",
    json: async () => hook.request(JSON.parse(options.body)),
  });
  w.localStorage.setItem(prefix + "url", JSON.stringify(URL));
  w.localStorage.setItem(scoped("catalog"), JSON.stringify(b.catalog()));
  Object.entries(stored).forEach(([k, v]) => w.localStorage.setItem(k, v));
  w.sessionStorage.setItem(
    prefix + "token",
    JSON.stringify({ url: URL, token: TOKEN }),
  );
  for (const file of ["core.js", "api.js", "app.js"])
    vm.runInContext(
      fs.readFileSync(path.join(root, "js", file), "utf8"),
      dom.getInternalVMContext(),
    );
  await new Promise((resolve) =>
    w.document.addEventListener("DOMContentLoaded", resolve),
  );
  const $ = (id) => w.document.getElementById(id);
  $("lock-input").value = "1234";
  $("unlock-btn").click();
  await settle();
  const select = async (id, value) => {
    $(id).value = value;
    $(id).dispatchEvent(new w.Event("change", { bubbles: true }));
    await settle();
  };
  const pick = async (prefix = "input", id = b.id) => {
    for (const [p, v] of [
      ["year", "115"],
      ["class", "C1"],
      ["subject", "Math"],
      ["unit", id],
    ])
      await select(prefix + "-" + p, v);
  };
  return {
    w,
    $,
    b,
    hook,
    errors,
    select,
    pick,
    close: () => w.close(),
    active: () => w.eval("state.active"),
  };
}
test("page boots with semantic selectors, safe literal names and no missing handlers", async (t) => {
  const b = seeded();
  b.manage("importStudents", {
    students: [
      { seat_num: "01", name: "<b>代稱</b>" },
      { seat_num: "02", name: "Learner B" },
      { seat_num: "03", name: "Learner C" },
    ],
  });
  const u = await ui(b);
  t.after(u.close);
  await u.pick();
  assert.equal(u.$("student-list").children.length, 3);
  assert.equal(u.$("student-list").querySelector("b"), null);
  assert.equal(
    u.$("student-list").querySelector(".student-name").textContent,
    "<b>代稱</b>",
  );
  assert.equal(u.$("lock-screen").hidden, true);
  assert.equal(u.$("app-shell").inert, false);
  assert.deepEqual(u.errors, []);
});
test("class management exposes year, subject and assignment rename controls", async (t) => {
  const u = await ui();
  t.after(u.close);
  await u.select("manage-year", "115");
  const classButton = u.$("class-grid").querySelector('[data-action="choose-class"]');
  assert.ok(classButton);
  classButton.click();
  await settle();
  assert.equal(u.$("rename-year").disabled, false);
  assert.ok(
    u.$("subject-list").querySelector('[data-action="rename-subject"]'),
  );
  assert.ok(u.$("subject-list").querySelector('[data-action="rename-unit"]'));
  assert.equal(u.$("rename-class").disabled, false);
});
test("status clicks save drafts; submit and clear survive cloud reload", async (t) => {
  const u = await ui();
  t.after(u.close);
  await u.pick();
  u.$("student-list")
    .querySelector('[data-seat="01"][data-status="missing"]')
    .click();
  assert.equal(u.active().records["01"].score, 0);
  assert.equal(
    u.$("student-list").querySelector(".score-display").textContent,
    "0",
  );
  assert.equal(
    JSON.parse(u.w.localStorage.getItem(scoped("assignment:" + u.b.id))).dirty,
    true,
  );
  u.$("save-assignment").click();
  await settle();
  assert.equal(u.b.view().records[0].status, "missing");
  assert.equal(u.active().dirty, false);
  u.w.document.querySelector('[data-batch=""]').click();
  u.$("save-assignment").click();
  await settle();
  assert.ok(u.b.view().records.every((r) => r.status === ""));
  assert.deepEqual(u.errors, []);
});
test("offline draft is restored on reopen without cloud overwrite", async (t) => {
  const b = seeded(),
    first = await ui(b);
  await first.pick();
  first.$("student-list").querySelector('[data-status="late"]').click();
  const key = scoped("assignment:" + b.id),
    saved = first.w.localStorage.getItem(key);
  first.close();
  const u = await ui(b, {
    [key]: saved,
    [scoped("selection")]: JSON.stringify({
      year: "115",
      class_name: "C1",
      subject: "Math",
      assignment_id: b.id,
    }),
  });
  t.after(u.close);
  assert.equal(u.active().records["01"].status, "late");
  assert.equal(u.active().dirty, true);
  assert.equal(u.active().conflict, false);
  u.hook.request = () => {
    throw new TypeError("offline");
  };
  await u.w.eval("loadAssignment(" + JSON.stringify(b.id) + ")");
  assert.equal(u.active().records["01"].status, "late");
  assert.match(u.$("persistent-error").textContent, /本機快取/);
});
test("failed write preserves dirty draft and never displays success", async (t) => {
  const u = await ui();
  t.after(u.close);
  await u.pick();
  u.$("student-list").querySelector('[data-status="submitted"]').click();
  u.hook.request = (p) =>
    p.action === "saveAssignment"
      ? {
          success: false,
          apiVersion: "3.1",
          code: "WRITE_FAILED",
          error: "Test failed write",
        }
      : u.b.post(p);
  u.$("save-assignment").click();
  await settle();
  assert.equal(u.active().dirty, true);
  assert.equal(u.b.view().records.length, 0);
  assert.match(u.$("persistent-error").textContent, /Test failed write/);
  assert.doesNotMatch(u.$("toast").textContent, /已確認儲存/);
});
test("response lost after committed save is reconciled by reload", async (t) => {
  const u = await ui();
  t.after(u.close);
  await u.pick();
  u.$("student-list").querySelector('[data-status="submitted"]').click();
  u.hook.request = (p) => {
    const r = u.b.post(p);
    if (p.action === "saveAssignment") throw new TypeError("connection lost");
    return r;
  };
  u.$("save-assignment").click();
  await settle();
  assert.equal(u.active().dirty, true);
  u.hook.request = (p) => u.b.post(p);
  u.$("reload-assignment").click();
  await settle();
  assert.equal(u.active().dirty, false);
  assert.equal(u.active().records["01"].status, "submitted");
});
test("switching parent removes old assignment and failed target load never shows old records", async (t) => {
  const u = await ui();
  t.after(u.close);
  await u.pick();
  u.$("student-list").querySelector('[data-status="submitted"]').click();
  await u.select("input-subject", "");
  assert.equal(u.active(), null);
  assert.equal(u.$("assignment-panel").hidden, true);
  u.hook.request = (p) =>
    p.action === "getAssignment"
      ? {
          success: false,
          apiVersion: "3.1",
          code: "NOT_FOUND",
          error: "not found",
        }
      : u.b.post(p);
  await u.pick("input", u.b.id2);
  assert.equal(u.active(), null);
  assert.equal(u.$("assignment-panel").hidden, true);
});
test("slower earlier request cannot replace latest selected assignment", async (t) => {
  const u = await ui();
  t.after(u.close);
  let release;
  u.hook.request = (p) =>
    p.assignment_id === u.b.id
      ? new Promise((r) => {
          release = () => r(u.b.post(p));
        })
      : u.b.post(p);
  const earlier = u.w.eval("loadAssignment(" + JSON.stringify(u.b.id) + ")");
  await settle();
  await u.w.eval("loadAssignment(" + JSON.stringify(u.b.id2) + ")");
  release();
  await earlier;
  assert.equal(u.active().snapshot.assignment.assignment_id, u.b.id2);
});
test("storage failure blocks switching away from an unsaved draft", async (t) => {
  const u = await ui();
  t.after(u.close);
  await u.pick();
  u.w.Storage.prototype.setItem = () => {
    throw new Error("quota");
  };
  u.$("student-list").querySelector('[data-status="submitted"]').click();
  await u.select("input-subject", "");
  assert.equal(u.active().snapshot.assignment.assignment_id, u.b.id);
  assert.equal(u.$("input-subject").value, "Math");
  assert.match(u.$("persistent-error").textContent, /儲存失敗/);
});
test("newer shared draft is not overwritten even before storage event is delivered", async (t) => {
  const u = await ui();
  t.after(u.close);
  await u.pick();
  const key = scoped("assignment:" + u.b.id),
    other = JSON.parse(u.w.localStorage.getItem(key));
  other.localRevision = "ANOTHER_TAB";
  other.records["01"] = { status: "missing", score: 0 };
  u.w.localStorage.setItem(key, JSON.stringify(other));
  u.$("student-list").querySelector('[data-status="submitted"]').click();
  assert.equal(u.active().localConflict, true);
  assert.equal(u.$("save-assignment").disabled, true);
  assert.equal(
    JSON.parse(u.w.localStorage.getItem(key)).localRevision,
    "ANOTHER_TAB",
  );
});
test("single report counts full roster; overview retains missing Unit A cells", async (t) => {
  const b = seeded();
  b.save(
    [
      { seat_num: "01", status: "submitted", score: 0 },
      { seat_num: "02", status: "exempt", score: "" },
      { seat_num: "03", status: "", score: "" },
    ],
    {
      assignment_id: b.id2,
      revision: b.post({ action: "getAssignment", assignment_id: b.id2 })
        .revision,
    },
  );
  const u = await ui(b);
  t.after(u.close);
  await u.pick("report", b.id2);
  u.$("single-report").click();
  await settle();
  assert.match(u.$("report-output").textContent, /全班 3 人/);
  assert.match(u.$("report-output").textContent, /繳交率 50%/);
  u.$("overview-report").click();
  await settle();
  const table = u.$("report-output").querySelector("table");
  assert.equal(table.rows[0].cells[2].textContent, "Unit A");
  assert.equal(table.rows[2].cells[2].textContent, "未登記");
  assert.equal(table.rows[2].cells[3].textContent, "已繳 0");
});
test("tab arrows and lock trap retain keyboard access", async (t) => {
  const u = await ui();
  t.after(u.close);
  u.$("tab-input").dispatchEvent(
    new u.w.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
  );
  assert.equal(u.$("tab-report").getAttribute("aria-selected"), "true");
  u.$("lock-btn").click();
  assert.equal(u.$("app-shell").inert, true);
  u.$("unlock-btn").focus();
  u.$("lock-screen").dispatchEvent(
    new u.w.KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.equal(u.w.document.activeElement.id, "lock-input");
});
test("conflicting local edits retain an independent recovery copy for export", async (t) => {
  const u = await ui();
  t.after(u.close);
  await u.pick();
  u.$("student-list").querySelector('[data-status="submitted"]').click();
  const key = scoped("assignment:" + u.b.id),
    newer = JSON.parse(u.w.localStorage.getItem(key));
  newer.localRevision = "OTHER";
  u.w.localStorage.setItem(key, JSON.stringify(newer));
  u.$("student-list").querySelector('[data-status="late"]').click();
  assert.equal(u.active().localConflict, true);
  const backup = u.w.eval("localDrafts()");
  const recovery = backup.drafts.filter((d) => d.key.includes(":recovery:"));
  assert.equal(recovery.length, 1);
  assert.equal(recovery[0].value.records["01"].status, "late");
});
