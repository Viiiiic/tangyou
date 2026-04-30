const fs = require("fs/promises");
const http = require("http");
const path = require("path");
const { HttpError, ScanService } = require("./backend/scan-service");
const { TtsProvider } = require("./backend/tts-provider");
const { getVisionStatus } = require("./backend/vision-adapter");

const PORT = Number(process.env.PORT || 4173);
const ROOT = __dirname;
const STORAGE_DIR = path.join(ROOT, "storage");
const TTS_DIR = path.join(STORAGE_DIR, "tts");

const ttsProvider = new TtsProvider({ storageDir: TTS_DIR });
const scanService = new ScanService({
  storageDir: STORAGE_DIR,
  ttsProvider,
});

const server = http.createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (error) {
    sendError(res, error);
  }
});

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "OPTIONS") {
    return sendOptions(res, req);
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    return sendJson(res, 200, {
      ok: true,
      service: "tangyou-backend",
      vision: getVisionStatus(),
      tts: ttsProvider.getStatus(),
    });
  }

  if (req.method === "POST" && url.pathname === "/api/meal-scans") {
    const body = await readJsonBody(req);
    const job = await scanService.createScan({
      image: body.image,
      filename: body.filename,
      scenario: body.scenario,
    });
    return sendJson(res, 202, job);
  }

  const scanMatch = url.pathname.match(/^\/api\/meal-scans\/([^/]+)$/);
  if (req.method === "GET" && scanMatch) {
    return sendJson(res, 200, scanService.getScan(scanMatch[1]));
  }

  if (req.method === "GET" && url.pathname.startsWith("/tts/")) {
    const filename = path.basename(url.pathname);
    return sendFile(res, path.join(TTS_DIR, filename), "audio/mpeg");
  }

  if (req.method === "GET" || req.method === "HEAD") {
    const filePath = resolveStaticPath(url.pathname);
    return sendFile(res, filePath, contentType(filePath), req.method === "HEAD");
  }

  throw new HttpError(405, "method not allowed");
}

function resolveStaticPath(pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const normalized = path.normalize(decodeURIComponent(requested)).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(ROOT, normalized);
  if (!filePath.startsWith(ROOT)) {
    throw new HttpError(403, "forbidden");
  }
  return filePath;
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 14 * 1024 * 1024) {
      throw new HttpError(413, "request body too large");
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new HttpError(400, "invalid JSON");
  }
}

async function sendFile(res, filePath, type, headOnly = false) {
  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": type.startsWith("audio/") ? "public, max-age=31536000, immutable" : "no-store",
    });
    if (!headOnly) {
      res.end(data);
    } else {
      res.end();
    }
  } catch {
    throw new HttpError(404, "not found");
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...corsHeaders(),
  });
  res.end(JSON.stringify(payload));
}

function sendOptions(res) {
  res.writeHead(204, {
    ...corsHeaders(),
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  });
  res.end();
}

function corsHeaders() {
  const origin = process.env.ALLOWED_ORIGINS || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
  };
}

function sendError(res, error) {
  const statusCode = error.statusCode || 500;
  sendJson(res, statusCode, {
    error: statusCode === 500 ? "internal server error" : error.message,
  });
  if (statusCode === 500) {
    console.error(error);
  }
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".mp3": "audio/mpeg",
  };
  return types[ext] || "application/octet-stream";
}

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`糖友后端已启动: http://localhost:${PORT}`);
    console.log("MiniMax TTS:", ttsProvider.getStatus().configured ? "enabled" : "not configured, using browser fallback");
  });
}

module.exports = {
  server,
  scanService,
};
