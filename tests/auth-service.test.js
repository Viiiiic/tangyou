const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { AuthService } = require("../backend/auth-service");

test("invite registration creates a bearer session and login reuses the account", async () => {
  const restore = withEnv({
    AUTH_REQUIRED: "1",
    AUTH_INVITE_CODE: "family-only",
  });
  const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "tangyou-auth-test-"));

  try {
    const auth = new AuthService({ storageDir });
    const registered = await auth.register({
      name: "妈妈",
      password: "secret1",
      inviteCode: "family-only",
    });
    const loggedIn = await auth.login({
      name: "妈妈",
      password: "secret1",
    });

    assert.equal(registered.user.name, "妈妈");
    assert.ok(registered.token);
    assert.ok(loggedIn.token);
    assert.notEqual(loggedIn.token, registered.token);
  } finally {
    await fs.rm(storageDir, { recursive: true, force: true });
    restore();
  }
});

test("meal scan auth rejects missing bearer token when auth is required", async () => {
  const restore = withEnv({
    AUTH_REQUIRED: "1",
    AUTH_INVITE_CODE: "family-only",
  });
  const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "tangyou-auth-test-"));

  try {
    const auth = new AuthService({ storageDir });
    await assert.rejects(
      () => auth.requireUser({ headers: {} }),
      /login required/,
    );
  } finally {
    await fs.rm(storageDir, { recursive: true, force: true });
    restore();
  }
});

function withEnv(values) {
  const original = {};
  for (const key of Object.keys(values)) {
    original[key] = process.env[key];
    process.env[key] = values[key];
  }

  return () => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}
