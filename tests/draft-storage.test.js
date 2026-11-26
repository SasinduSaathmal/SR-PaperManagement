import assert from "node:assert/strict";
import test from "node:test";
import { loadSharedDrafts, sharedDraftKey, updateSharedDraft } from "../src/sharedMarksApi.js";

function storageFixture() {
  const values = new Map();
  return {
    values,
    failRead: false,
    failWrite: false,
    getItem(key) {
      if (this.failRead) throw Error("Storage unavailable");
      return values.get(key);
    },
    setItem(key, value) {
      if (this.failWrite) throw Error("Storage full");
      values.set(key, value);
    },
  };
}

const draft = (requestId, text = "12") => ({
  requestId, text, version: 0, enrolmentId: requestId, testId: "test",
});

test("failed browser writes preserve all drafts and do not resurrect a synced draft", () => {
  const storage = storageFixture();
  const account = "quota-account";
  updateSharedDraft(account, "first", draft("stored"), undefined, storage);
  storage.failWrite = true;
  updateSharedDraft(account, "first", draft("changed"), "stored", storage);
  updateSharedDraft(account, "second", draft("second"), undefined, storage);
  assert.equal(loadSharedDrafts(account, storage).memoryOnly, true);
  assert.deepEqual(Object.keys(loadSharedDrafts(account, storage).drafts), ["first", "second"]);
  assert.deepEqual(loadSharedDrafts("other-account", storage).drafts, {});

  updateSharedDraft(account, "first", null, "changed", storage);
  assert.equal(loadSharedDrafts(account, storage).drafts.first, undefined);
  storage.failWrite = false;
  updateSharedDraft(account, "second", draft("edited-second"), "second", storage);
  const result = loadSharedDrafts(account, storage);
  assert.deepEqual(result.drafts, { second: draft("edited-second") });
  assert.equal(result.memoryOnly, false);
});

test("memory-only edits survive unavailable reads and preserve another tab's newer draft", () => {
  const storage = storageFixture();
  const account = "read-failure-account";
  updateSharedDraft(account, "first", draft("stored"), undefined, storage);
  storage.failRead = true;
  updateSharedDraft(account, "first", draft("in-memory"), "stored", storage);
  assert.equal(loadSharedDrafts(account, storage).drafts.first.requestId, "in-memory");

  storage.failRead = false;
  storage.setItem(sharedDraftKey(account), JSON.stringify({ first: draft("other-tab") }));
  updateSharedDraft(account, "second", draft("unrelated"), undefined, storage);
  assert.equal(loadSharedDrafts(account, storage).drafts.first.requestId, "in-memory");
  assert.throws(() => updateSharedDraft(account, "first", draft("newer"), "in-memory", storage), /another tab/);
  updateSharedDraft(account, "first", null, "in-memory", storage);
  assert.deepEqual(loadSharedDrafts(account, storage).drafts, {
    first: draft("other-tab"), second: draft("unrelated"),
  });
});
