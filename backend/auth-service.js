const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");

const DEFAULT_TOKEN_TTL_DAYS = 30;
const SCRYPT_KEY_LENGTH = 64;

class AuthService {
  constructor({ storageDir }) {
    this.storageDir = storageDir;
    this.usersPath = path.join(storageDir, "users.json");
    this.sessionsPath = path.join(storageDir, "sessions.json");
    this.required = process.env.AUTH_REQUIRED === "1";
    this.inviteCode = process.env.AUTH_INVITE_CODE || "";
    this.tokenTtlDays = Number(process.env.AUTH_TOKEN_TTL_DAYS || DEFAULT_TOKEN_TTL_DAYS);
  }

  getStatus(user) {
    return {
      required: this.required,
      invite_required: this.required,
      authenticated: Boolean(user),
      user: user ? publicUser(user) : null,
    };
  }

  async requireUser(req) {
    if (!this.required) {
      return null;
    }

    const user = await this.userFromRequest(req);
    if (!user) {
      throw new AuthError(401, "login required");
    }
    return user;
  }

  async userFromRequest(req) {
    const token = bearerToken(req.headers.authorization);
    if (!token) return null;

    const sessions = await this.readJson(this.sessionsPath, []);
    const tokenHash = hashToken(token);
    const session = sessions.find((item) => item.token_hash === tokenHash);
    if (!session || new Date(session.expires_at).getTime() <= Date.now()) {
      return null;
    }

    const users = await this.readJson(this.usersPath, []);
    return users.find((user) => user.id === session.user_id) || null;
  }

  async register({ name, password, inviteCode }) {
    if (!this.required) {
      throw new AuthError(400, "auth is not enabled");
    }
    if (!this.inviteCode) {
      throw new AuthError(500, "AUTH_INVITE_CODE is not configured");
    }
    if (String(inviteCode || "").trim() !== this.inviteCode) {
      throw new AuthError(403, "invite code is invalid");
    }

    const normalizedName = normalizeName(name);
    validatePassword(password);
    const users = await this.readJson(this.usersPath, []);
    if (users.some((user) => user.name === normalizedName)) {
      throw new AuthError(409, "user already exists");
    }

    const user = {
      id: `user_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`,
      name: normalizedName,
      password: hashPassword(password),
      created_at: new Date().toISOString(),
    };
    users.push(user);
    await this.writeJson(this.usersPath, users);
    return this.createSession(user);
  }

  async login({ name, password }) {
    if (!this.required) {
      throw new AuthError(400, "auth is not enabled");
    }

    const normalizedName = normalizeName(name);
    const users = await this.readJson(this.usersPath, []);
    const user = users.find((item) => item.name === normalizedName);
    if (!user || !verifyPassword(password, user.password)) {
      throw new AuthError(401, "name or password is wrong");
    }
    return this.createSession(user);
  }

  async logout(req) {
    const token = bearerToken(req.headers.authorization);
    if (!token) return;

    const tokenHash = hashToken(token);
    const sessions = await this.readJson(this.sessionsPath, []);
    await this.writeJson(
      this.sessionsPath,
      sessions.filter((session) => session.token_hash !== tokenHash),
    );
  }

  async createSession(user) {
    const token = crypto.randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + this.tokenTtlDays * 24 * 60 * 60 * 1000).toISOString();
    const sessions = await this.readJson(this.sessionsPath, []);
    sessions.push({
      token_hash: hashToken(token),
      user_id: user.id,
      created_at: new Date().toISOString(),
      expires_at: expiresAt,
    });
    await this.writeJson(this.sessionsPath, sessions);
    return {
      token,
      expires_at: expiresAt,
      user: publicUser(user),
    };
  }

  async readJson(filePath, fallback) {
    try {
      return JSON.parse(await fs.readFile(filePath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return fallback;
      throw error;
    }
  }

  async writeJson(filePath, value) {
    await fs.mkdir(this.storageDir, { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
  }
}

class AuthError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function normalizeName(name) {
  const normalized = String(name || "").trim().replace(/\s+/g, "");
  if (normalized.length < 2 || normalized.length > 24) {
    throw new AuthError(400, "name must be 2-24 characters");
  }
  return normalized;
}

function validatePassword(password) {
  if (String(password || "").length < 6) {
    throw new AuthError(400, "password must be at least 6 characters");
  }
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("base64url");
  const hash = crypto.scryptSync(String(password), salt, SCRYPT_KEY_LENGTH).toString("base64url");
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [method, salt, expected] = String(stored || "").split(":");
  if (method !== "scrypt" || !salt || !expected) {
    return false;
  }
  const actual = crypto.scryptSync(String(password), salt, SCRYPT_KEY_LENGTH).toString("base64url");
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function bearerToken(header) {
  const match = String(header || "").match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
  };
}

module.exports = {
  AuthError,
  AuthService,
};
