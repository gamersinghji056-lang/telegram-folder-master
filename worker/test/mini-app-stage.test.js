import assert from "node:assert/strict";
import test from "node:test";

import { miniStatusAllowsApp } from "../../src/lib/mini-app-stage.js";

test("Mini App stage gate allows connected sessions into the app", () => {
  assert.equal(miniStatusAllowsApp({ connected: true }), true);
});

test("Mini App stage gate allows explicit server local-dev bypass into the app", () => {
  assert.equal(miniStatusAllowsApp({ connected: false, localDevSessionBypass: true }), true);
});

test("Mini App stage gate sends disconnected non-bypass users to phone linking", () => {
  assert.equal(miniStatusAllowsApp({ connected: false, localDevSessionBypass: false }), false);
  assert.equal(miniStatusAllowsApp({ connected: false }), false);
});

test("Mini App stage gate preserves production behavior for normal status payloads", () => {
  assert.equal(miniStatusAllowsApp({ connected: true, localDevSessionBypass: false }), true);
  assert.equal(miniStatusAllowsApp({ connected: false, localDevSessionBypass: undefined }), false);
});
