const { test } = require("node:test");
const assert = require("node:assert/strict");
const C = require("../js/core.js"),
  createApi = require("../js/api.js");
test("13 grades and legal zero are preserved", () => {
  assert.equal(Object.keys(C.grades).length, 13);
  assert.equal(C.record({ status: "submitted", score: "0" }).score, 0);
  assert.equal(C.record({ status: "exempt", score: 100 }).score, "");
});
test("status transitions clear inapplicable scores and same click cancels", () => {
  assert.equal(C.changeStatus({ status: "exempt" }, "submitted").score, "");
  assert.equal(C.changeStatus({ status: "missing" }, "late").score, "");
  assert.equal(
    C.changeStatus({ status: "submitted", score: 95 }, "late").score,
    95,
  );
  assert.equal(
    C.changeStatus({ status: "submitted", score: 95 }, "submitted").status,
    "",
  );
});
test("full-roster summary distinguishes unregistered, missing, exempt", () => {
  const roster = ["01", "02", "03", "04"].map((seat_num) => ({ seat_num }));
  const r = C.summarize(roster, {
    "01": { status: "submitted" },
    "02": { status: "exempt" },
  });
  assert.equal(r.total, 4);
  assert.equal(r.unregistered, 2);
  assert.equal(r.registered, 2);
  assert.equal(r.rate, 33);
  assert.equal(
    C.summarize([{ seat_num: "01" }], { "01": { status: "exempt" } }).rate,
    null,
  );
});
test("CSV handles BOM, swapped columns, commas, escaped quotes and CRLF", () => {
  assert.deepEqual(
    C.parseCSV('\uFEFF代稱,座號\r\n"Learner, ""A""",1\r\nLearner B,2'),
    [
      { seat_num: "01", name: 'Learner, "A"' },
      { seat_num: "02", name: "Learner B" },
    ],
  );
});
test("CSV rejects invalid headers, duplicate canonical seats, formulas and broken quoting", () => {
  for (const csv of [
    "學號,姓名\n12345,A",
    "座號,代稱\n1,A\n01,B",
    "座號,代稱\n1,=1+1",
    '座號,代稱\n1,"A',
    "座號,代稱\n1,A,B",
    "座號,代稱\n0,A",
  ])
    assert.throws(() => C.parseCSV(csv));
});
test("GAS URL rejects deceptive host, port, query and credentials", () => {
  const base = "https://script.google.com/macros/s/TEST/exec";
  assert.equal(C.validGasUrl(base), base);
  for (const url of [
    "https://script.google.com.evil.test/macros/s/X/exec",
    base + "?token=x",
    base + "#x",
    "http://script.google.com/macros/s/X/exec",
    "https://script.google.com:444/macros/s/X/exec",
    "https://u@script.google.com/macros/s/X/exec",
  ])
    assert.throws(() => C.validGasUrl(url));
});
test("API POST checks acknowledgment and keeps secret out of URL", async () => {
  let captured;
  const request = createApi(async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      type: "cors",
      json: async () => ({ success: true, apiVersion: "3.1", saved: 3 }),
    };
  }, C.validGasUrl);
  assert.equal(
    (
      await request(
        "https://script.google.com/macros/s/TEST/exec",
        "TEST_TOKEN",
        { action: "saveAssignment" },
      )
    ).saved,
    3,
  );
  assert.equal(new URL(captured.url).search, "");
  assert.equal(captured.init.mode, "cors");
  assert.equal(JSON.parse(captured.init.body).token, "TEST_TOKEN");
});
test("API refuses opaque, HTTP failure, invalid JSON, wrong version and server denial", async () => {
  const responses = [
    { ok: true, type: "opaque" },
    { ok: false },
    {
      ok: true,
      type: "cors",
      json: async () => {
        throw Error("not JSON");
      },
    },
    {
      ok: true,
      type: "cors",
      json: async () => ({ success: true, apiVersion: "3.0" }),
    },
    {
      ok: true,
      type: "cors",
      json: async () => ({
        success: false,
        apiVersion: "3.1",
        code: "CONFLICT",
        error: "stale",
      }),
    },
  ];
  for (const response of responses) {
    const api = createApi(async () => response, C.validGasUrl);
    await assert.rejects(() =>
      api("https://script.google.com/macros/s/TEST/exec", "TEST", {}),
    );
  }
});
test("abort says outcome unconfirmed instead of claiming write failed", async () => {
  const api = createApi(async () => {
    throw new DOMException("aborted", "AbortError");
  }, C.validGasUrl);
  await assert.rejects(
    () => api("https://script.google.com/macros/s/TEST/exec", "TEST", {}),
    /無法確認是否已寫入/,
  );
});
