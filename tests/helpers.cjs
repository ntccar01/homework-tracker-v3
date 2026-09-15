const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const root = path.join(__dirname, "..");
const TOKEN = "TEST_ONLY_TOKEN_NOT_A_REAL_SECRET_123456";
function backend(initial = {}) {
  const sheets = new Map(),
    properties = new Map([
      ["API_TOKEN", TOKEN],
      ["SPREADSHEET_ID", "TEST_SHEET"],
    ]);
  const control = { fail: null, writes: 0, locked: false };
  class Sheet {
    constructor(name, rows = []) {
      this.name = name;
      this.rows = rows.map((r) => [...r]);
      this.maxRows = 1000;
      this.maxColumns = 26;
      this.formulas = [];
    }
    getLastRow() {
      let n = this.rows.length;
      while (n && !this.rows[n - 1].some((v) => v !== "" && v != null)) n--;
      return n;
    }
    getMaxRows() {
      return this.maxRows;
    }
    getMaxColumns() {
      return this.maxColumns;
    }
    insertRowsAfter(_, n) {
      this.maxRows += n;
    }
    insertColumnsAfter(_, n) {
      this.maxColumns += n;
    }
    setFrozenRows() {}
    getDataRange() {
      return this.getRange(
        1,
        1,
        Math.max(1, this.getLastRow()),
        Math.max(1, ...this.rows.map((r) => r.length)),
      );
    }
    getRange(row, col, height = 1, width = 1) {
      const sheet = this;
      return {
        getValues: () =>
          Array.from({ length: height }, (_, i) =>
            Array.from(
              { length: width },
              (_, j) => sheet.rows[row - 1 + i]?.[col - 1 + j] ?? "",
            ),
          ),
        getFormulas: () =>
          Array.from({ length: height }, (_, i) =>
            Array.from(
              { length: width },
              (_, j) => sheet.formulas[row - 1 + i]?.[col - 1 + j] ?? "",
            ),
          ),
        setValues(values) {
          if (
            values.length !== height ||
            values.some((r) => r.length !== width)
          )
            throw Error("Incorrect range size");
          control.writes++;
          if (control.fail?.(sheet.name, values))
            throw Error("Simulated interrupted write");
          values.forEach((r, i) => {
            sheet.rows[row - 1 + i] ??= [];
            r.forEach((v, j) => (sheet.rows[row - 1 + i][col - 1 + j] = v));
          });
        },
      };
    }
  }
  Object.entries(initial).forEach(([name, rows]) =>
    sheets.set(name, new Sheet(name, rows)),
  );
  const props = {
    getProperty: (k) => properties.get(k) || null,
    setProperty: (k, v) => properties.set(k, v),
    deleteProperty: (k) => properties.delete(k),
  };
  const spreadsheet = {
    getSheetByName: (n) => sheets.get(n) || null,
    insertSheet: (n) => {
      const s = new Sheet(n);
      sheets.set(n, s);
      return s;
    },
  };
  const ctx = vm.createContext({
    console,
    Date,
    Set,
    Map,
    PropertiesService: { getScriptProperties: () => props },
    SpreadsheetApp: {
      openById: (id) => {
        if (id !== "TEST_SHEET") throw Error("Unexpected sheet");
        return spreadsheet;
      },
      flush() {},
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => {
          if (control.locked) return false;
          control.locked = true;
          return true;
        },
        waitLock: () => {
          if (control.locked) throw Error("Busy");
          control.locked = true;
        },
        releaseLock: () => {
          control.locked = false;
        },
      }),
    },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      DigestAlgorithm: { SHA_256: "sha256" },
      Charset: { UTF_8: "utf8" },
      computeDigest: (_, s) =>
        Array.from(crypto.createHash("sha256").update(s).digest()),
      formatDate: (d) =>
        new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Taipei",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(d),
    },
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput: (value) => ({
        value,
        setMimeType() {
          return this;
        },
      }),
    },
  });
  vm.runInContext(fs.readFileSync(path.join(root, "gas/Code.js"), "utf8"), ctx);
  const post = (p) =>
    JSON.parse(
      ctx.doPost({
        postData: { contents: JSON.stringify({ token: TOKEN, ...p }) },
      }).value,
    );
  return {
    ctx,
    post,
    sheets,
    properties,
    control,
    setup: () => ctx.setupDatabase(),
    catalog: () => post({ action: "getCatalog" }),
    manage: (operation, p = {}) =>
      post({
        action: "manage",
        operation,
        revision: post({ action: "getCatalog" }).revision,
        year: "115",
        class_name: "C1",
        ...p,
      }),
    snapshot: () =>
      JSON.stringify(
        [...sheets]
          .filter(([n]) => n !== "_backups")
          .map(([n, s]) => [n, s.rows]),
      ),
  };
}
function seeded() {
  const b = backend();
  b.setup();
  for (const [op, p] of [
    ["addYear", {}],
    ["addClass", { subjects: ["Math"] }],
    [
      "importStudents",
      {
        students: [
          { seat_num: "01", name: "Learner A" },
          { seat_num: "02", name: "Learner B" },
          { seat_num: "03", name: "Learner C" },
        ],
      },
    ],
    ["addUnit", { subject: "Math", unit: "Unit A" }],
    ["addUnit", { subject: "Math", unit: "Unit B" }],
  ]) {
    const r = b.manage(op, p);
    if (!r.success) throw Error(JSON.stringify(r));
  }
  b.id = b.catalog().assignments[0].assignment_id;
  b.id2 = b.catalog().assignments[1].assignment_id;
  b.view = () => b.post({ action: "getAssignment", assignment_id: b.id });
  b.save = (records, extra = {}) =>
    b.post({
      action: "saveAssignment",
      assignment_id: b.id,
      revision: b.view().revision,
      date: "2026-09-09",
      records,
      ...extra,
    });
  return b;
}
module.exports = { root, TOKEN, backend, seeded };
