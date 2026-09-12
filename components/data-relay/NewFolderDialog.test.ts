import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const source = fs.readFileSync(path.join(import.meta.dirname, "NewFolderDialog.tsx"), "utf8");

test("path list row menu includes a destructive delete action", () => {
  assert.match(source, /variant === "row"/);
  assert.match(source, /sftp\.context\.delete/);
  assert.match(source, /className="text-destructive focus:text-destructive"/);
});

test("delete confirm dialog shows host and full path", () => {
  assert.match(source, /sftp\.deleteConfirm\.single/);
  assert.match(source, /sftp\.deleteConfirm\.host/);
  assert.match(source, /sftp\.deleteConfirm\.path/);
  assert.match(source, /break-all font-mono/);
});
