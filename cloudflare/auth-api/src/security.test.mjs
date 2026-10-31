import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, USERNAME_RE, validFeatureId, handleRequest, cleanProfile } from "./index.js";

test("password hashes use per-account salt and verify only the matching password", async () => {
  const first = await hashPassword("RainLane#StrongPassword1");
  const second = await hashPassword("RainLane#StrongPassword1");
  assert.equal(first.iterations, 100_000);
  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.hash, second.hash);
  assert.equal(await verifyPassword("RainLane#StrongPassword1", { password_salt: first.salt, password_hash: first.hash, password_iterations: first.iterations }), true);
  assert.equal(await verifyPassword("RainLane#WrongPassword2", { password_salt: first.salt, password_hash: first.hash, password_iterations: first.iterations }), false);
});

test("account and feature identifiers reject malformed values", () => {
  assert.equal(USERNAME_RE.test("YA_8gT6Pq"), true);
  assert.equal(USERNAME_RE.test("xy"), false);
  assert.equal(USERNAME_RE.test("name/../file"), false);
  assert.equal(validFeatureId("cs2-demo"), true);
  assert.equal(validFeatureId("../comments"), false);
});

test("request JSON is capped even when the caller omits content-length", async () => {
  const oversized = new TextEncoder().encode(JSON.stringify({ username: "YXabcdefgh", password: "x".repeat(17_000) }));
  const body = new ReadableStream({ start(controller) { controller.enqueue(oversized); controller.close(); } });
  const request = new Request("https://local.test/api/register", { method: "POST", body, duplex: "half" });
  const response = await handleRequest(request, {});
  assert.equal(response.status, 400);
});

test("malformed encoded comment identifiers return a client error", async () => {
  const response = await handleRequest(new Request("https://local.test/api/modules/%E0%A4%A/comments"), {});
  assert.equal(response.status, 400);
});

test("public profile layout keeps only supported markup and scoped safe styles", () => {
  const profile = cleanProfile({
    displayName: "雨巷来客", bio: "你好", html: '<h2 class="profile-title">你好</h2><script>alert(1)</script><img src=x onerror=alert(1)>',
    css: '.profile-page h2{color:#123456;background-image:url(https://bad.test);position:fixed}.other h2{color:red}',
  });
  assert.equal(profile.html.includes("<script"), false);
  assert.equal(profile.html.includes("onerror"), false);
  assert.equal(profile.html.includes("<img"), false);
  assert.match(profile.html, /<h2 class="profile-title">你好<\/h2>/);
  assert.equal(profile.css, ".profile-page h2{color:#123456}");
});

test("profile API requires authentication before writing", async () => {
  const write = await handleRequest(new Request("https://local.test/api/profiles/YXabcd2345", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName: "name" }) }), { DB: {} });
  assert.equal(write.status, 401);
});

test("account updates require an authenticated session", async () => {
  const response = await handleRequest(new Request("https://local.test/api/account", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ currentPassword: "CurrentPassword#123", newUsername: "new-name" }),
  }), { DB: {} });
  assert.equal(response.status, 401);
});
