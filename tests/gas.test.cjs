const { test } = require("node:test");
const assert = require("node:assert/strict");
const { backend, seeded } = require("./helpers.cjs");
const rows = () =>
  ["01", "02", "03"].map((seat_num) => ({
    seat_num,
    status: "submitted",
    score: 100,
  }));
test("manual setup creates valid independent catalog and empty classes", () => {
  const b = backend();
  b.setup();
  assert.equal(b.catalog().success, true);
  assert.equal(b.manage("addYear").success, true);
  assert.equal(b.manage("addClass", { subjects: [] }).success, true);
  assert.equal(b.catalog().classes[0].class_name, "C1");
  assert.equal(b.catalog().students.length, 0);
  assert.equal(b.manage("addYear", { year: 115 }).code, "DUPLICATE");
});
test("authentication and malformed requests never mutate data", () => {
  const b = seeded(),
    before = b.snapshot(),
    n = b.control.writes;
  assert.equal(
    b.post({ action: "getCatalog", token: "wrong" }).code,
    "UNAUTHORIZED",
  );
  const bad = JSON.parse(
    b.ctx.doPost({ postData: { contents: "{bad" } }).value,
  );
  assert.equal(bad.success, false);
  assert.equal(b.control.writes, n);
  assert.equal(b.snapshot(), before);
});
test("every data route rejects absent or wrong credentials without exposing records", () => {
  const b = seeded(),
    before = b.snapshot(),
    writes = b.control.writes;
  for (const action of [
    "getCatalog",
    "getAssignment",
    "getOverview",
    "exportBackup",
    "saveAssignment",
    "manage",
    "restoreBackup",
    "setupDatabase",
  ]) {
    for (const token of [undefined, "", "wrong", null, {}, []]) {
      const result = b.post({ action, token, assignment_id: b.id });
      assert.equal(result.success, false);
      assert.equal(result.code, "UNAUTHORIZED");
      assert.deepEqual(Object.keys(result).sort(), [
        "apiVersion",
        "code",
        "error",
        "success",
      ]);
    }
  }
  assert.equal(b.snapshot(), before);
  assert.equal(b.control.writes, writes);
});
test("public health response and authenticated exports do not disclose credentials", () => {
  const b = seeded();
  const health = JSON.parse(b.ctx.doGet().value);
  assert.deepEqual(Object.keys(health).sort(), [
    "apiVersion",
    "message",
    "success",
  ]);
  for (const action of [
    "getCatalog",
    "getAssignment",
    "getOverview",
    "exportBackup",
  ]) {
    const result = b.post({
      action,
      assignment_id: b.id,
      year: "115",
      class_name: "C1",
      subject: "Math",
    });
    assert.equal(result.success, true);
    const encoded = JSON.stringify(result);
    assert.ok(!encoded.includes(b.properties.get("API_TOKEN")));
    assert.ok(!encoded.includes(b.properties.get("SPREADSHEET_ID")));
    assert.ok(!encoded.includes('"_backups"'));
  }
});
test("save acknowledgment and reload agree; complete blank snapshot clears old states", () => {
  const b = seeded();
  const result = b.save(rows());
  assert.equal(result.success, true);
  assert.equal(result.saved, 3);
  assert.equal(b.view().records[0].score, 100);
  assert.equal(b.view().date, "2026-09-09");
  const cleared = b.save(rows().map((r) => ({ ...r, status: "", score: "" })));
  assert.equal(cleared.success, true);
  assert.ok(b.view().records.every((r) => r.status === "" && r.score === ""));
});
test("stale snapshot is rejected and retry cannot overwrite another save", () => {
  const b = seeded(),
    rev = b.view().revision;
  assert.equal(b.save(rows()).success, true);
  const result = b.save(
    rows().map((r) => ({ ...r, score: 40 })),
    { revision: rev },
  );
  assert.equal(result.code, "CONFLICT");
  assert.ok(b.view().records.every((r) => r.score === 100));
});
test("full roster, legal scores, valid dates and unique seats are mandatory", () => {
  const b = seeded();
  for (const [records, extra] of [
    [rows().slice(1), {}],
    [[rows()[0], rows()[0], rows()[2]], {}],
    [rows().map((r) => ({ ...r, score: 101 })), {}],
    [rows(), { date: "2026-02-30" }],
  ]) {
    const before = b.snapshot();
    assert.equal(b.save(records, extra).success, false);
    assert.equal(b.snapshot(), before);
  }
});
test("assignment determines year/class even if caller supplies unrelated values", () => {
  const b = seeded();
  assert.equal(
    b.save(rows(), { year: "999", class_name: "Wrong" }).success,
    true,
  );
  assert.ok(
    b.view().records.every((r) => r.year === "115" && r.class_name === "C1"),
  );
});
test("CSV replacements validate before writes and block reuse of historical seats", () => {
  const b = seeded();
  b.save(rows());
  const before = b.snapshot();
  for (const students of [
    [{ name: "Bad" }],
    [{ seat_num: "01", name: "Other" }],
    [
      { seat_num: "01", name: "A" },
      { seat_num: "1", name: "B" },
    ],
  ])
    assert.equal(b.manage("importStudents", { students }).success, false);
  assert.equal(b.snapshot(), before);
});
test("blank-state roster removal cleans associated empty records", () => {
  const b = seeded();
  b.save(rows().map((r) => ({ ...r, status: "", score: "" })));
  assert.equal(
    b.manage("importStudents", {
      students: [{ seat_num: "01", name: "Learner A" }],
    }).success,
    true,
  );
  assert.equal(b.view().records.length, 1);
});
test("class rename cascades and individual student deletion removes records", () => {
  const b = seeded();
  b.save(rows());
  assert.equal(b.manage("renameClass", { new_name: "C2" }).success, true);
  assert.equal(b.view().assignment.class_name, "C2");
  assert.ok(b.view().records.every((r) => r.class_name === "C2"));
  assert.equal(
    b.manage("deleteStudent", { class_name: "C2", seat_num: "01" }).success,
    true,
  );
  assert.equal(b.view().records.length, 2);
});
test("year, subject and unit renames cascade while preserving assignment records", () => {
  const b = seeded();
  const originalId = b.id;
  assert.equal(b.save(rows()).success, true);
  assert.equal(
    b.manage("renameUnit", {
      assignment_id: originalId,
      subject: "Math",
      new_name: "Unit A renamed",
    }).success,
    true,
  );
  assert.equal(b.view().assignment.unit, "Unit A renamed");
  assert.equal(b.view().records[0].status, "submitted");
  assert.equal(b.view().records[0].score, 100);

  assert.equal(
    b.manage("renameSubject", {
      subject: "Math",
      new_name: "Mathematics",
    }).success,
    true,
  );
  assert.equal(b.view().assignment.subject, "Mathematics");
  assert.equal(
    b.catalog().assignments.find((a) => a.assignment_id === originalId).subject,
    "Mathematics",
  );

  assert.equal(b.manage("renameYear", { new_name: "116" }).success, true);
  const view = b.view();
  assert.equal(view.assignment.assignment_id, originalId);
  assert.equal(view.assignment.year, "116");
  assert.ok(view.records.every((r) => r.year === "116"));
  assert.equal(view.records[0].score, 100);
});
test("name renames reject duplicates without changing data", () => {
  const b = seeded();
  assert.equal(b.manage("addSubject", { subject: "Science" }).success, true);
  const before = b.snapshot();
  assert.equal(
    b.manage("renameSubject", {
      subject: "Math",
      new_name: "Science",
    }).code,
    "DUPLICATE",
  );
  assert.equal(
    b.manage("renameUnit", {
      assignment_id: b.id,
      subject: "Math",
      new_name: "Unit B",
    }).code,
    "DUPLICATE",
  );
  assert.equal(
    b.manage("renameYear", { new_name: "115" }).success,
    true,
  );
  assert.equal(b.snapshot(), before);
});
test("overview uses explicit IDs and complete assignment list", () => {
  const b = seeded();
  b.save(rows(), {
    assignment_id: b.id2,
    revision: b.post({ action: "getAssignment", assignment_id: b.id2 })
      .revision,
  });
  const r = b.post({
    action: "getOverview",
    year: 115,
    class_name: "C1",
    subject: "Math",
  });
  assert.equal(r.assignments.length, 2);
  assert.equal(r.students.length, 3);
  assert.ok(r.records.every((r) => r.assignment_id === b.id2));
});
test("write failure restores original data and does not falsely acknowledge", () => {
  const b = seeded(),
    before = b.snapshot();
  let failed = false;
  b.control.fail = (name) => {
    if (name === "records" && !failed) {
      failed = true;
      return true;
    }
    return false;
  };
  const result = b.save(rows());
  assert.equal(result.code, "WRITE_FAILED");
  assert.equal(b.snapshot(), before);
  assert.equal(b.properties.has("PENDING_WRITE"), false);
});
test("failed rollback blocks subsequent requests until reviewed recovery", () => {
  const b = seeded();
  b.control.fail = (n) => n === "records";
  assert.equal(b.save(rows()).code, "RECOVERY_REQUIRED");
  assert.equal(b.catalog().code, "RECOVERY_REQUIRED");
  const id = b.properties.get("PENDING_WRITE");
  b.control.fail = null;
  b.properties.set("RECOVERY_BACKUP_ID", id);
  assert.equal(b.ctx.restoreBackup().success, true);
  assert.equal(b.view().records.length, 0);
  assert.equal(b.properties.has("PENDING_WRITE"), false);
});
test("normal backup restores records and retains a backup of pre-restore state", () => {
  const b = seeded(),
    saved = b.save(rows());
  b.properties.set("RECOVERY_BACKUP_ID", saved.backupId);
  const result = b.ctx.restoreBackup();
  assert.equal(result.success, true);
  assert.ok(result.recoverySafetyId);
  assert.equal(b.view().records.length, 0);
});
test("legacy migration preserves IDs, derives catalog and removes only empty placeholders", () => {
  const b = backend({
    students: [
      ["year", "class_name", "seat_num", "name"],
      [115, "", "", ""],
      [115, "C1", 1, "Learner A"],
    ],
    assignments: [
      ["assignment_id", "year", "class_name", "subject", "unit"],
      [101, 115, "C1", "Math", "Unit A"],
      [102, 115, "C1", "Other", ""],
    ],
    records: [
      [
        "assignment_id",
        "year",
        "class_name",
        "seat_num",
        "status",
        "score",
        "note",
      ],
      ["101", 115, "C1", "01", "exempt", "免交", ""],
    ],
  });
  const result = b.setup();
  assert.equal(result.success, true);
  assert.equal(b.catalog().years.length, 1);
  assert.equal(b.catalog().subjects.length, 2);
  assert.equal(b.catalog().assignments.length, 1);
  assert.equal(
    b.post({ action: "getAssignment", assignment_id: 101 }).records[0].score,
    "",
  );
  b.properties.set("RECOVERY_BACKUP_ID", result.backupId);
  assert.equal(b.ctx.restoreBackup().success, true);
  assert.equal(b.sheets.get("records").rows[1][5], "免交");
  assert.equal(b.setup().success, true);
});
test("migration rejects duplicates before creating or modifying any sheet", () => {
  const b = backend({
    students: [
      ["year", "class_name", "seat_num", "name"],
      [115, "C1", 1, "A"],
      [115, "C1", "01", "B"],
    ],
  });
  const before = b.snapshot();
  assert.throws(() => b.setup(), /重複/);
  assert.equal(b.snapshot(), before);
  assert.equal(b.control.writes, 0);
});
test("unknown columns, formulas and orphan records stop instead of being silently discarded", () => {
  const b = seeded();
  b.sheets.get("students").formulas = [[], ["=1"]];
  assert.equal(b.catalog().code, "SCHEMA");
  b.sheets.get("students").formulas = [];
  b.sheets.get("students").rows[0].push("private_extra");
  assert.equal(b.catalog().code, "SCHEMA");
});
test("backup chunks are round-trippable even for long names near boundaries", () => {
  const b = seeded();
  const data = { sample: 'abc="XYZ"\\'.repeat(5000) };
  const id = b.ctx.backup(data, "test");
  const chunks = b.sheets.get("_backups").rows.filter((r) => r[0] === id);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((r) => String(r[4]).startsWith('"')));
  assert.deepEqual(
    JSON.parse(chunks.map((r) => JSON.parse(r[4])).join("")),
    data,
  );
});
