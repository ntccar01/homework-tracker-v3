const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const root = path.resolve(__dirname, "..");

test("static release has its local assets, CSP and pinned image tool", () => {
  const dom = new JSDOM(fs.readFileSync(path.join(root, "index.html"), "utf8"));
  try {
    const doc = dom.window.document;
    for (const node of doc.querySelectorAll(
      'script[src],link[rel="stylesheet"],a[href]',
    )) {
      const src = node.getAttribute("src") || node.getAttribute("href");
      assert.doesNotMatch(
        src,
        /^(https?:)?\/\//,
        "release resources should be local",
      );
      if (src.startsWith("#")) continue;
      assert.ok(fs.existsSync(path.join(root, src)), "missing asset: " + src);
    }
    const csp = doc.querySelector(
      'meta[http-equiv="Content-Security-Policy"]',
    ).content;
    assert.match(csp, /script-src 'self'/);
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
    for (const node of doc.querySelectorAll("*")) {
      assert.ok(
        ![...node.attributes].some((a) => /^on/i.test(a.name)),
        "inline event handler",
      );
    }
    assert.deepEqual(
      fs.readFileSync(path.join(root, "vendor/html2canvas.min.js")),
      fs.readFileSync(
        path.join(root, "node_modules/html2canvas/dist/html2canvas.min.js"),
      ),
    );
    assert.equal(
      require(path.join(root, "node_modules/html2canvas/package.json")).version,
      "1.4.1",
    );
    assert.ok(fs.existsSync(path.join(root, "vendor/html2canvas-LICENSE.txt")));
  } finally {
    dom.window.close();
  }
});
