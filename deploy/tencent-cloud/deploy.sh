#!/usr/bin/env bash
set -euo pipefail

: "${SERVER:?Set SERVER, for example: SERVER=ubuntu@1.2.3.4}"
: "${APP_DIR:=/opt/tangyou}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

ssh "$SERVER" "sudo mkdir -p '$APP_DIR' && sudo chown \$(id -u):\$(id -g) '$APP_DIR'"

rsync -az --delete \
  --exclude ".git" \
  --exclude "node_modules" \
  --exclude "storage" \
  --exclude ".env" \
  --exclude "deploy/tencent-cloud/.env" \
  "$ROOT_DIR/" "$SERVER:$APP_DIR/"

ssh "$SERVER" "cd '$APP_DIR/deploy/tencent-cloud' && if [ ! -f .env ]; then echo 'Missing deploy/tencent-cloud/.env on server. Copy .env.example to .env and fill secrets first.' >&2; exit 1; fi && sudo docker compose up -d --build"
