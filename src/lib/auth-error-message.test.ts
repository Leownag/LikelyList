import assert from "node:assert/strict";
import test from "node:test";
import { signInErrorMessage } from "./auth-error-message";

test("the failure that broke sign-in is blamed on us, not on the address", () => {
  // The real response, verbatim: Supabase accepted the request and its SMTP failed.
  const message = signInErrorMessage({
    code: "unexpected_failure",
    status: 500,
    message: "Error sending confirmation email",
  });
  assert.match(message, /fault on our side/);
  assert.doesNotMatch(message, /confirmation email/);
});

test("an empty error body never reaches the screen as `{}`", () => {
  // auth-js falls back to JSON.stringify(body) when there is no msg field, which is
  // how two braces ended up being shown to a reader as the reason they could not log in.
  for (const raw of ["{}", "[]", "", "   ", '{"code":500}']) {
    const message = signInErrorMessage({ message: raw });
    assert.doesNotMatch(message, /[{}]/, `leaked braces for ${JSON.stringify(raw)}`);
    assert.ok(message.length > 20);
  }
});

test("the common recoverable failures say what to do", () => {
  assert.match(
    signInErrorMessage({ code: "over_email_send_rate_limit", status: 429 }),
    /Wait a few minutes/,
  );
  assert.match(
    signInErrorMessage({ code: "otp_expired", message: "Email link is invalid or has expired" }),
    /ask for a new one/,
  );
  // No code at all — older GoTrue throttling only says it in prose.
  assert.match(
    signInErrorMessage({ message: "For security purposes, you can only request this after 47 seconds." }),
    /too soon/i,
  );
});

test("a readable message we have no mapping for is passed through", () => {
  assert.equal(
    signInErrorMessage({ message: "Signups not allowed for this instance" }),
    "Signups not allowed for this instance",
  );
});
