// Homework Tracker 3.1. Copy to Code.gs. Secrets belong in Script Properties.
const API_VERSION = "3.1";
const TABLES = {
  years: ["year"],
  classes: ["year", "class_name"],
  subjects: ["year", "class_name", "subject"],
  students: ["year", "class_name", "seat_num", "name"],
  assignments: ["assignment_id", "year", "class_name", "subject", "unit"],
  records: [
    "assignment_id",
    "year",
    "class_name",
    "seat_num",
    "status",
    "score",
    "note",
    "date",
  ],
  _backups: ["backup_id", "created_at", "action", "part", "json"],
};
function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(
    ContentService.MimeType.JSON,
  );
}
function doGet() {
  return jsonResponse({
    success: true,
    apiVersion: API_VERSION,
    message: "Use authenticated POST for data.",
  });
}
function doPost(e) {
  let lock,
    locked = false;
  try {
    const body = e && e.postData && e.postData.contents;
    if (!body || body.length > 2000000) fail("BAD_REQUEST", "請求空白或過大");
    const p = JSON.parse(body),
      token = PropertiesService.getScriptProperties().getProperty("API_TOKEN");
    if (!token || token.length < 24 || token === "your_secret_token_here")
      fail("CONFIG", "伺服器尚未設定有效 Token");
    if (!p || typeof p !== "object" || Array.isArray(p))
      fail("BAD_REQUEST", "請求格式不正確");
    if (p.token !== token) fail("UNAUTHORIZED", "Token 不正確或已失效");
    lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) fail("BUSY", "另一個操作正在進行，請稍後再試");
    locked = true;
    if (PropertiesService.getScriptProperties().getProperty("PENDING_WRITE"))
      fail(
        "RECOVERY_REQUIRED",
        "先前寫入尚未完成核對，請停止操作並依復原指南處理",
      );
    const db = readDB();
    let result;
    switch (p.action) {
      case "getCatalog":
        result = catalog(db);
        break;
      case "getAssignment":
        result = assignmentView(db, p.assignment_id);
        break;
      case "getOverview":
        result = overview(db, p);
        break;
      case "exportBackup":
        result = {
          schemaVersion: API_VERSION,
          data: db,
          exportedAt: new Date().toISOString(),
        };
        break;
      case "saveAssignment":
        result = saveAssignment(db, p);
        break;
      case "manage":
        result = manage(db, p);
        break;
      default:
        fail("BAD_ACTION", "不支援的操作，請更新前端與 GAS 至同一版本");
    }
    return jsonResponse(
      Object.assign({ success: true, apiVersion: API_VERSION }, result),
    );
  } catch (error) {
    return jsonResponse({
      success: false,
      apiVersion: API_VERSION,
      code: error.appCode || "SERVER_ERROR",
      error: error.appCode
        ? error.message
        : "伺服器處理失敗；請檢查 GAS 執行紀錄與試算表設定",
    });
  } finally {
    if (locked) lock.releaseLock();
  }
}
function fail(code, message) {
  const error = new Error(message);
  error.appCode = code;
  throw error;
}
function spreadsheet() {
  const id =
    PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (!id) fail("CONFIG", "請設定 SPREADSHEET_ID");
  return SpreadsheetApp.openById(id);
}
function text(value, label, max = 80) {
  const v = String(value == null ? "" : value).trim();
  if (!v || v.length > max || /^[=+\-@]/.test(v) || /[\x00-\x1f]/.test(v))
    fail("INVALID", label + "格式不正確");
  return v;
}
function yearValue(value) {
  const v = text(value, "學年度", 4);
  if (!/^\d{3,4}$/.test(v)) fail("INVALID", "學年度須為 3–4 位數字");
  return v;
}
function seatValue(value) {
  const v = String(value == null ? "" : value).trim();
  if (!/^\d{1,3}$/.test(v) || Number(v) < 1) fail("INVALID", "座號須為 1–999");
  return String(Number(v)).padStart(2, "0");
}
function dateValue(value) {
  if (!value) return "";
  if (value instanceof Date)
    return Utilities.formatDate(value, "Asia/Taipei", "yyyy-MM-dd");
  const s = String(value),
    d = new Date(s);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(s) ||
    !Number.isFinite(d.getTime()) ||
    d.toISOString().slice(0, 10) !== s
  )
    fail("INVALID", "日期格式不正確");
  return s;
}
function readDB() {
  const db = {},
    ss = spreadsheet();
  Object.keys(TABLES)
    .filter((n) => n !== "_backups")
    .forEach((name) => {
      const sheet = ss.getSheetByName(name);
      if (!sheet) fail("SETUP_REQUIRED", "請先在 GAS 手動執行 setupDatabase");
      const rows = sheet.getDataRange().getValues(),
        headers = TABLES[name];
      if (rows.some((r) => r.slice(headers.length).some((v) => v !== "")))
        fail("SCHEMA", "資料表 " + name + " 有額外欄位，請先在副本核對");
      if (
        sheet
          .getDataRange()
          .getFormulas()
          .some((row) => row.some(Boolean))
      )
        fail("SCHEMA", "資料表 " + name + " 含公式，請先在副本整理成純資料");
      if (!headers.every((h, i) => rows[0] && rows[0][i] === h))
        fail("SCHEMA", "工作表 " + name + " 欄位與 3.1 不符");
      db[name] = rows
        .slice(1)
        .filter((r) => r.some((v) => v !== ""))
        .map((row) => {
          const obj = {};
          headers.forEach(
            (h, i) =>
              (obj[h] =
                h === "score"
                  ? row[i]
                  : h === "date"
                    ? dateValue(row[i])
                    : String(row[i] == null ? "" : row[i])),
          );
          if (obj.seat_num) obj.seat_num = seatValue(obj.seat_num);
          if (name === "records") normalizeRecord(obj);
          return obj;
        });
    });
  validateDB(db);
  return db;
}
function normalizeRecord(r) {
  if (!["", "submitted", "late", "missing", "exempt"].includes(r.status))
    fail("INVALID", "紀錄含未知狀態");
  if (r.status === "missing") r.score = 0;
  else if (!r.status || r.status === "exempt") r.score = "";
  else if (r.score !== "" && r.score != null) {
    r.score = Number(r.score);
    if (!Number.isFinite(r.score) || r.score < 0 || r.score > 100)
      fail("INVALID", "歷史分數不正確，請先在副本核對");
  } else r.score = "";
}
function validateDB(db) {
  const pair = (r) => JSON.stringify([r.year, r.class_name]),
    triple = (r) => JSON.stringify([r.year, r.class_name, r.subject]);
  const years = new Set(),
    classes = new Set(),
    subjects = new Set(),
    students = new Set(),
    assignments = new Map(),
    records = new Set();
  const unique = (set, key, label) => {
    if (set.has(key)) fail("DUPLICATE", label + "有重複資料，請先在副本核對");
    set.add(key);
  };
  for (const name of Object.keys(TABLES).filter((n) => n !== "_backups"))
    if (!Array.isArray(db[name])) fail("SCHEMA", "缺少資料表 " + name);
  db.years.forEach((r) => unique(years, yearValue(r.year), "學年度"));
  db.classes.forEach((r) => {
    if (!years.has(r.year)) fail("SCHEMA", "班級學年度不存在");
    text(r.class_name, "班級");
    unique(classes, pair(r), "班級");
  });
  db.subjects.forEach((r) => {
    if (!classes.has(pair(r))) fail("SCHEMA", "科目所屬班級不存在");
    text(r.subject, "科目");
    unique(subjects, triple(r), "科目");
  });
  db.students.forEach((r) => {
    if (!classes.has(pair(r))) fail("SCHEMA", "學生所屬班級不存在");
    text(r.name, "學生代稱");
    seatValue(r.seat_num);
    unique(
      students,
      JSON.stringify([r.year, r.class_name, r.seat_num]),
      "學生座號",
    );
  });
  db.assignments.forEach((r) => {
    text(r.assignment_id, "作業識別碼");
    text(r.unit, "作業名稱");
    if (!subjects.has(triple(r))) fail("SCHEMA", "作業所屬科目不存在");
    if (assignments.has(r.assignment_id)) fail("DUPLICATE", "作業識別碼重複");
    assignments.set(r.assignment_id, r);
  });
  db.records.forEach((r) => {
    const a = assignments.get(r.assignment_id);
    if (
      !a ||
      a.year !== r.year ||
      a.class_name !== r.class_name ||
      !students.has(JSON.stringify([r.year, r.class_name, r.seat_num]))
    )
      fail("SCHEMA", "紀錄與班級或名冊關聯不符，請先核對孤兒紀錄");
    unique(records, JSON.stringify([r.assignment_id, r.seat_num]), "作業紀錄");
    normalizeRecord(r);
    dateValue(r.date);
    if (r.note) text(r.note, "備註", 300);
  });
}
function digest(value) {
  return Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    JSON.stringify(value),
    Utilities.Charset.UTF_8,
  )
    .map((b) => ((b + 256) % 256).toString(16).padStart(2, "0"))
    .join("");
}
function catalog(db) {
  return {
    years: db.years.map((x) => x.year).sort((a, b) => Number(b) - Number(a)),
    classes: db.classes,
    subjects: db.subjects,
    students: db.students,
    assignments: db.assignments,
    revision: digest(db),
  };
}
function assignmentView(db, id) {
  const assignment = db.assignments.find((x) => x.assignment_id === String(id));
  if (!assignment) fail("NOT_FOUND", "作業不存在或已被刪除");
  const students = db.students
    .filter(
      (s) =>
        s.year === assignment.year && s.class_name === assignment.class_name,
    )
    .sort((a, b) => Number(a.seat_num) - Number(b.seat_num));
  const rows = db.records.filter(
    (r) => r.assignment_id === assignment.assignment_id,
  );
  return {
    assignment,
    students,
    records: rows,
    date: rows[0] ? rows[0].date : "",
    revision: digest({ assignment, students, rows }),
  };
}
function overview(db, p) {
  const year = yearValue(p.year),
    cls = text(p.class_name, "班級"),
    subject = text(p.subject, "科目");
  const assignments = db.assignments.filter(
    (a) => a.year === year && a.class_name === cls && a.subject === subject,
  );
  const students = db.students
    .filter((s) => s.year === year && s.class_name === cls)
    .sort((a, b) => Number(a.seat_num) - Number(b.seat_num));
  const ids = new Set(assignments.map((a) => a.assignment_id));
  return {
    assignments,
    students,
    records: db.records.filter((r) => ids.has(r.assignment_id)),
  };
}
function writeTable(name, objects) {
  const sheet = spreadsheet().getSheetByName(name),
    headers = TABLES[name];
  const rows = [headers].concat(
    objects.map((obj) => headers.map((h) => (obj[h] == null ? "" : obj[h]))),
  );
  const length = Math.max(rows.length, sheet.getLastRow());
  while (rows.length < length) rows.push(headers.map(() => ""));
  if (sheet.getMaxRows() < length)
    sheet.insertRowsAfter(sheet.getMaxRows(), length - sheet.getMaxRows());
  if (sheet.getMaxColumns() < headers.length)
    sheet.insertColumnsAfter(
      sheet.getMaxColumns(),
      headers.length - sheet.getMaxColumns(),
    );
  sheet.getRange(1, 1, length, headers.length).setValues(rows);
}
function backup(db, action) {
  const sheet = spreadsheet().getSheetByName("_backups");
  if (!sheet) fail("SETUP_REQUIRED", "缺少備份工作表");
  const json = JSON.stringify(db),
    id = Utilities.getUuid(),
    now = new Date().toISOString(),
    chunks = [];
  // Each chunk is itself JSON encoded: it never starts with a formula marker.
  for (let i = 0; i < json.length; i += 12000)
    chunks.push([
      id,
      now,
      action,
      chunks.length + 1,
      JSON.stringify(json.slice(i, i + 12000)),
    ]);
  const last = sheet.getLastRow();
  if (sheet.getMaxRows() < last + chunks.length)
    sheet.insertRowsAfter(
      sheet.getMaxRows(),
      last + chunks.length - sheet.getMaxRows(),
    );
  sheet.getRange(last + 1, 1, chunks.length, 5).setValues(chunks);
  SpreadsheetApp.flush();
  if (
    JSON.stringify(
      sheet.getRange(last + 1, 1, chunks.length, 5).getValues(),
    ) !== JSON.stringify(chunks)
  )
    fail("VERIFY", "備份核對失敗，尚未修改主要資料");
  return id;
}
function commitDB(before, after, action) {
  validateDB(after);
  const names = Object.keys(before).filter(
    (name) => JSON.stringify(before[name]) !== JSON.stringify(after[name]),
  );
  if (!names.length) return "";
  const backupId = backup(before, action);
  const props = PropertiesService.getScriptProperties();
  props.setProperty("PENDING_WRITE", backupId);
  try {
    names.forEach((name) => writeTable(name, after[name]));
    SpreadsheetApp.flush();
    const verified = readDB();
    if (names.some((name) => digest(verified[name]) !== digest(after[name])))
      fail("VERIFY", "寫入後資料核對失敗");
  } catch (error) {
    try {
      names.forEach((name) => writeTable(name, before[name]));
      SpreadsheetApp.flush();
      if (digest(readDB()) !== digest(before))
        throw new Error("restore mismatch");
      props.deleteProperty("PENDING_WRITE");
    } catch (rollbackError) {
      fail(
        "RECOVERY_REQUIRED",
        "操作未完成，請停止寫入；備份編號：" + backupId,
      );
    }
    fail("WRITE_FAILED", "操作未完成，已嘗試還原原資料；備份編號：" + backupId);
  }
  props.deleteProperty("PENDING_WRITE");
  return backupId;
}
function saveAssignment(db, p) {
  const view = assignmentView(db, p.assignment_id);
  if (!p.revision || p.revision !== view.revision)
    fail("CONFLICT", "雲端作業或名冊已變更；請先保留草稿並重新載入");
  if (!Array.isArray(p.records) || p.records.length !== view.students.length)
    fail("INVALID", "必須送出完整名冊，包含未登記狀態");
  const allowed = new Set(view.students.map((s) => s.seat_num)),
    seen = new Set(),
    date = dateValue(p.date);
  const rows = p.records.map((r) => {
    const num = seatValue(r.seat_num);
    if (!allowed.has(num) || seen.has(num)) fail("INVALID", "座號不存在或重複");
    seen.add(num);
    const status = String(r.status || "");
    if (!["", "submitted", "late", "missing", "exempt"].includes(status))
      fail("INVALID", "狀態不正確");
    let score = r.score === "" || r.score == null ? "" : Number(r.score);
    if (status === "missing") score = 0;
    else if (!status || status === "exempt") score = "";
    else if (
      score !== "" &&
      (!Number.isFinite(score) || score < 0 || score > 100)
    )
      fail("INVALID", "分數須介於 0–100");
    return {
      assignment_id: view.assignment.assignment_id,
      year: view.assignment.year,
      class_name: view.assignment.class_name,
      seat_num: num,
      status,
      score,
      note: status === "late" ? "補交" : "",
      date,
    };
  });
  const next = JSON.parse(JSON.stringify(db));
  next.records = db.records
    .filter((r) => r.assignment_id !== view.assignment.assignment_id)
    .concat(rows);
  const backupId = commitDB(db, next, "saveAssignment");
  return Object.assign(assignmentView(next, p.assignment_id), {
    saved: rows.length,
    backupId,
  });
}
function requireClass(db, year, cls) {
  if (!db.classes.some((c) => c.year === year && c.class_name === cls))
    fail("NOT_FOUND", "班級不存在");
}
function requireSubject(db, year, cls, subject) {
  if (
    !db.subjects.some(
      (s) => s.year === year && s.class_name === cls && s.subject === subject,
    )
  )
    fail("NOT_FOUND", "科目不存在");
}
function manage(db, p) {
  if (!p.revision || p.revision !== digest(db))
    fail("CONFLICT", "資料已由其他操作更新，請重新整理後再試");
  const next = JSON.parse(JSON.stringify(db)),
    year = yearValue(p.year);
  const cls = p.class_name ? text(p.class_name, "班級") : "",
    subject = p.subject ? text(p.subject, "科目") : "";
  if (p.operation !== "addYear" && !next.years.some((y) => y.year === year))
    fail("NOT_FOUND", "學年度不存在");
  switch (p.operation) {
    case "addYear":
      if (next.years.some((y) => y.year === year))
        fail("DUPLICATE", "學年度已存在");
      next.years.push({ year });
      break;
    case "addClass": {
      text(cls, "班級");
      if (next.classes.some((c) => c.year === year && c.class_name === cls))
        fail("DUPLICATE", "班級已存在");
      if (!Array.isArray(p.subjects) || p.subjects.length > 30)
        fail("INVALID", "科目清單不正確");
      const subjects = Array.from(
        new Set(p.subjects.map((s) => text(s, "科目"))),
      );
      next.classes.push({ year, class_name: cls });
      subjects.forEach((s) =>
        next.subjects.push({ year, class_name: cls, subject: s }),
      );
      break;
    }
    case "renameYear": {
      const name = yearValue(p.new_name);
      if (name !== year && next.years.some((y) => y.year === name))
        fail("DUPLICATE", "新學年度已存在");
      next.years.forEach((r) => {
        if (r.year === year) r.year = name;
      });
      ["classes", "students", "subjects", "assignments", "records"].forEach(
        (table) =>
          next[table].forEach((r) => {
            if (r.year === year) r.year = name;
          }),
      );
      break;
    }
    case "renameClass": {
      requireClass(next, year, cls);
      const name = text(p.new_name, "新班級名稱");
      if (
        name !== cls &&
        next.classes.some((c) => c.year === year && c.class_name === name)
      )
        fail("DUPLICATE", "新班級名稱已存在");
      ["classes", "students", "subjects", "assignments", "records"].forEach(
        (table) =>
          next[table].forEach((r) => {
            if (r.year === year && r.class_name === cls) r.class_name = name;
          }),
      );
      break;
    }
    case "renameSubject": {
      requireClass(next, year, cls);
      requireSubject(next, year, cls, subject);
      const name = text(p.new_name, "新科目名稱");
      if (
        name !== subject &&
        next.subjects.some(
          (s) =>
            s.year === year && s.class_name === cls && s.subject === name,
        )
      )
        fail("DUPLICATE", "新科目名稱已存在");
      next.subjects.forEach((s) => {
        if (s.year === year && s.class_name === cls && s.subject === subject)
          s.subject = name;
      });
      next.assignments.forEach((a) => {
        if (a.year === year && a.class_name === cls && a.subject === subject)
          a.subject = name;
      });
      break;
    }
    case "addSubject":
      requireClass(next, year, cls);
      text(subject, "科目");
      if (
        next.subjects.some(
          (s) =>
            s.year === year && s.class_name === cls && s.subject === subject,
        )
      )
        fail("DUPLICATE", "科目已存在");
      next.subjects.push({ year, class_name: cls, subject });
      break;
    case "addUnit": {
      if (
        !next.subjects.some(
          (s) =>
            s.year === year && s.class_name === cls && s.subject === subject,
        )
      )
        fail("NOT_FOUND", "科目不存在");
      const unit = text(p.unit, "作業名稱");
      if (
        next.assignments.some(
          (a) =>
            a.year === year &&
            a.class_name === cls &&
            a.subject === subject &&
            a.unit === unit,
        )
      )
        fail("DUPLICATE", "作業名稱已存在");
      next.assignments.push({
        assignment_id: Utilities.getUuid(),
        year,
        class_name: cls,
        subject,
        unit,
      });
      break;
    }
    case "renameUnit": {
      requireClass(next, year, cls);
      requireSubject(next, year, cls, subject);
      const assignment = next.assignments.find(
        (a) =>
          a.assignment_id === String(p.assignment_id) &&
          a.year === year &&
          a.class_name === cls &&
          a.subject === subject,
      );
      if (!assignment) fail("NOT_FOUND", "作業不屬於此科目");
      const name = text(p.new_name, "新作業名稱");
      if (
        name !== assignment.unit &&
        next.assignments.some(
          (a) =>
            a.year === year &&
            a.class_name === cls &&
            a.subject === subject &&
            a.unit === name,
        )
      )
        fail("DUPLICATE", "新作業名稱已存在");
      assignment.unit = name;
      break;
    }
    case "importStudents": {
      requireClass(next, year, cls);
      if (
        !Array.isArray(p.students) ||
        !p.students.length ||
        p.students.length > 200
      )
        fail("INVALID", "名冊須有 1–200 人");
      const seen = new Set();
      const roster = p.students.map((s) => {
        const num = seatValue(s.seat_num);
        if (seen.has(num)) fail("DUPLICATE", "名冊座號重複");
        seen.add(num);
        return {
          year,
          class_name: cls,
          seat_num: num,
          name: text(s.name, "學生代稱"),
        };
      });
      const old = next.students.filter(
        (s) => s.year === year && s.class_name === cls,
      );
      const hasHistory = next.records.some(
        (r) => r.year === year && r.class_name === cls && r.status,
      );
      if (
        hasHistory &&
        old.some(
          (s) =>
            !roster.some((n) => n.seat_num === s.seat_num && n.name === s.name),
        )
      )
        fail(
          "ROSTER_HISTORY",
          "此班已有紀錄，不能用匯入移除或改派原座號；請保留原學生並新增座號，或建立新班級",
        );
      next.records = next.records.filter(
        (r) =>
          !(r.year === year && r.class_name === cls && !seen.has(r.seat_num)),
      );
      next.students = next.students
        .filter((s) => !(s.year === year && s.class_name === cls))
        .concat(roster);
      break;
    }
    case "deleteStudent": {
      requireClass(next, year, cls);
      const num = seatValue(p.seat_num);
      next.students = next.students.filter(
        (s) => !(s.year === year && s.class_name === cls && s.seat_num === num),
      );
      next.records = next.records.filter(
        (r) => !(r.year === year && r.class_name === cls && r.seat_num === num),
      );
      break;
    }
    case "deleteYear":
    case "deleteClass":
    case "deleteSubject":
    case "deleteUnit": {
      if (p.operation !== "deleteYear") requireClass(next, year, cls);
      if (
        p.operation === "deleteUnit" &&
        !next.assignments.some(
          (a) =>
            a.assignment_id === p.assignment_id &&
            a.year === year &&
            a.class_name === cls,
        )
      )
        fail("NOT_FOUND", "作業不屬於此班");
      const matches = (r) =>
        r.year === year &&
        (p.operation === "deleteYear" ||
          (r.class_name === cls &&
            (p.operation === "deleteClass" ||
              (p.operation === "deleteSubject"
                ? r.subject === subject
                : r.assignment_id === p.assignment_id))));
      const ids = new Set(
        next.assignments.filter(matches).map((a) => a.assignment_id),
      );
      next.assignments = next.assignments.filter((a) => !matches(a));
      next.records = next.records.filter(
        (r) =>
          !ids.has(r.assignment_id) &&
          !(p.operation === "deleteYear" && r.year === year) &&
          !(
            p.operation === "deleteClass" &&
            r.year === year &&
            r.class_name === cls
          ),
      );
      if (p.operation !== "deleteUnit")
        next.subjects = next.subjects.filter((s) => !matches(s));
      if (["deleteYear", "deleteClass"].includes(p.operation)) {
        next.students = next.students.filter((s) => !matches(s));
        next.classes = next.classes.filter((c) => !matches(c));
      }
      if (p.operation === "deleteYear")
        next.years = next.years.filter((y) => y.year !== year);
      break;
    }
    default:
      fail("BAD_ACTION", "不支援的管理操作");
  }
  const backupId = commitDB(db, next, p.operation);
  return { catalog: catalog(next), backupId };
}
// Run manually on a COPY of the spreadsheet first. Setup is never invoked by a request.
function setupDatabase() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty("PENDING_WRITE"))
      fail("RECOVERY_REQUIRED", "請先完成先前操作的復原");
    const ss = spreadsheet(),
      raw = {},
      rawHeaders = {};
    Object.keys(TABLES)
      .filter((n) => n !== "_backups")
      .forEach((name) => {
        const sheet = ss.getSheetByName(name);
        if (!sheet || !sheet.getLastRow()) {
          raw[name] = [];
          rawHeaders[name] = TABLES[name];
          return;
        }
        const rows = sheet.getDataRange().getValues(),
          headers = TABLES[name],
          width =
            name === "records" && rows[0][7] !== "date" ? 7 : headers.length;
        if (
          sheet
            .getDataRange()
            .getFormulas()
            .some((row) => row.some(Boolean))
        )
          fail("SCHEMA", "原資料含公式，初始化已停止");
        if (
          !headers.slice(0, width).every((h, i) => rows[0] && rows[0][i] === h)
        )
          fail("SCHEMA", "原資料表 " + name + " 標題不符，已停止初始化");
        if (rows.some((r) => r.slice(width).some((v) => v !== "")))
          fail("SCHEMA", "原資料有額外欄位，初始化已停止");
        rawHeaders[name] = headers.slice(0, width);
        raw[name] = rows
          .slice(1)
          .filter((r) => r.some((v) => v !== ""))
          .map((row) =>
            row
              .slice(0, width)
              .map((v) => (v instanceof Date ? dateValue(v) : v)),
          );
      });
    const existingBackup = ss.getSheetByName("_backups");
    if (
      existingBackup &&
      !TABLES._backups.every(
        (h, i) => existingBackup.getDataRange().getValues()[0][i] === h,
      )
    )
      fail("SCHEMA", "備份表標題不符");
    const db = {};
    Object.keys(raw).forEach((name) => {
      db[name] = raw[name].map((row) => {
        const obj = {};
        TABLES[name].forEach(
          (h, i) =>
            (obj[h] =
              h === "score"
                ? row[i] == null
                  ? ""
                  : row[i]
                : h === "date"
                  ? dateValue(row[i])
                  : String(row[i] == null ? "" : row[i])),
        );
        if (obj.seat_num) obj.seat_num = seatValue(obj.seat_num);
        if (name === "records") normalizeRecord(obj);
        return obj;
      });
    });
    const addUnique = (table, obj) => {
      if (
        !db[table].some((r) => Object.keys(obj).every((k) => r[k] === obj[k]))
      )
        db[table].push(obj);
    };
    db.students
      .concat(db.assignments)
      .concat(db.records)
      .forEach((r) => {
        if (r.year) addUnique("years", { year: r.year });
        if (r.year && r.class_name)
          addUnique("classes", { year: r.year, class_name: r.class_name });
      });
    db.assignments.forEach((a) => {
      if (a.subject)
        addUnique("subjects", {
          year: a.year,
          class_name: a.class_name,
          subject: a.subject,
        });
    });
    db.students = db.students.filter((s) => {
      if (!s.class_name && !s.seat_num && !s.name) return false; // Legacy addYear placeholder only.
      if (!s.class_name || !s.seat_num)
        fail("SCHEMA", "原名冊有不完整學生資料，初始化已停止");
      return true;
    });
    db.assignments.forEach((a) => {
      text(a.assignment_id, "作業識別碼");
      yearValue(a.year);
      text(a.class_name, "班級");
      text(a.subject, "科目");
    });
    const recordIds = new Set(db.records.map((r) => r.assignment_id));
    db.assignments = db.assignments.filter(
      (a) => a.unit || recordIds.has(a.assignment_id),
    );
    db.assignments.forEach((a) => {
      if (!a.unit) a.unit = "待命名作業 " + a.assignment_id;
    });
    validateDB(db);
    Object.keys(TABLES).forEach((name) => {
      let sheet = ss.getSheetByName(name);
      if (!sheet) sheet = ss.insertSheet(name);
      if (!sheet.getLastRow()) {
        sheet.getRange(1, 1, 1, TABLES[name].length).setValues([TABLES[name]]);
        sheet.setFrozenRows(1);
      }
    });
    const snapshot = { kind: "raw-v3", headers: rawHeaders, rows: raw },
      backupId = backup(snapshot, "before-3.1-setup");
    props.setProperty("PENDING_WRITE", backupId);
    try {
      Object.keys(db).forEach((name) => writeTable(name, db[name]));
      SpreadsheetApp.flush();
      if (digest(readDB()) !== digest(db)) fail("VERIFY", "初始化後核對失敗");
      props.deleteProperty("PENDING_WRITE");
    } catch (e) {
      try {
        restoreRaw(snapshot);
        props.deleteProperty("PENDING_WRITE");
      } catch {
        fail("RECOVERY_REQUIRED", "初始化中斷，請用備份 " + backupId + " 復原");
      }
      fail("WRITE_FAILED", "初始化未完成，已還原原資料；備份 " + backupId);
    }
    return { success: true, apiVersion: API_VERSION, backupId };
  } finally {
    lock.releaseLock();
  }
}
function restoreRaw(snapshot) {
  Object.keys(snapshot.rows).forEach((name) => {
    const headers = snapshot.headers[name],
      rows = [headers].concat(snapshot.rows[name]),
      sheet = spreadsheet().getSheetByName(name);
    const width = Math.max(TABLES[name].length, headers.length),
      height = Math.max(sheet.getLastRow(), rows.length);
    while (rows.length < height) rows.push([]);
    const padded = rows.map((r) =>
      Array.from({ length: width }, (_, i) => (r[i] == null ? "" : r[i])),
    );
    if (sheet.getMaxRows() < height)
      sheet.insertRowsAfter(sheet.getMaxRows(), height - sheet.getMaxRows());
    if (sheet.getMaxColumns() < width)
      sheet.insertColumnsAfter(
        sheet.getMaxColumns(),
        width - sheet.getMaxColumns(),
      );
    sheet.getRange(1, 1, height, width).setValues(padded);
    SpreadsheetApp.flush();
    if (
      JSON.stringify(sheet.getRange(1, 1, height, width).getValues()) !==
      JSON.stringify(padded)
    )
      fail("VERIFY", "原始資料復原核對失敗");
  });
}
// Manual recovery only. Set RECOVERY_BACKUP_ID in Script Properties after reviewing the backup.
function restoreBackup() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const props = PropertiesService.getScriptProperties(),
      id = props.getProperty("RECOVERY_BACKUP_ID");
    if (!id) fail("CONFIG", "請指定 RECOVERY_BACKUP_ID");
    const sheet = spreadsheet().getSheetByName("_backups");
    if (!sheet) fail("SETUP_REQUIRED", "找不到備份表");
    const parts = sheet
      .getDataRange()
      .getValues()
      .slice(1)
      .filter((r) => r[0] === id)
      .sort((a, b) => Number(a[3]) - Number(b[3]));
    if (!parts.length || parts.some((r, i) => Number(r[3]) !== i + 1))
      fail("INVALID", "備份分段缺漏或重複");
    const saved = JSON.parse(parts.map((r) => JSON.parse(r[4])).join(""));
    // Retain the current tables before restoring, including an interrupted state.
    const headers = {},
      rows = {};
    Object.keys(TABLES)
      .filter((n) => n !== "_backups")
      .forEach((name) => {
        const values = spreadsheet()
          .getSheetByName(name)
          .getDataRange()
          .getValues();
        headers[name] = values[0];
        rows[name] = values.slice(1);
      });
    const recoverySafetyId = backup(
      { kind: "raw-v3", headers, rows },
      "before-manual-restore",
    );
    props.setProperty("PENDING_WRITE", id);
    if (saved.kind === "raw-v3") restoreRaw(saved);
    else {
      validateDB(saved);
      Object.keys(saved).forEach((name) => writeTable(name, saved[name]));
      SpreadsheetApp.flush();
      if (digest(readDB()) !== digest(saved))
        fail("VERIFY", "備份復原核對失敗");
    }
    props.deleteProperty("PENDING_WRITE");
    props.deleteProperty("RECOVERY_BACKUP_ID");
    return { success: true, restoredBackupId: id, recoverySafetyId };
  } finally {
    lock.releaseLock();
  }
}
