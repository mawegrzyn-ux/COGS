#!/bin/bash
# Called by GitHub Actions on every push to main
set -e

APP_DIR="/var/www/menu-cogs"
API_DIR="$APP_DIR/api"
APP_SRC_DIR="$APP_DIR/app"
FRONTEND_DIR="$APP_DIR/frontend"

echo "[deploy] Pulling latest code..."
git -C "$APP_DIR" pull origin main

echo "[deploy] Installing API dependencies..."
cd "$API_DIR" && npm install --production --silent

echo "[deploy] Restarting API..."
pm2 restart menu-cogs-api

echo "[deploy] Installing frontend dependencies..."
cd "$APP_SRC_DIR" && npm install --silent

echo "[deploy] Building React frontend..."
npm run build

echo "[deploy] Deploying frontend build..."
rm -rf "$FRONTEND_DIR"/*
cp -r "$APP_SRC_DIR/dist/"* "$FRONTEND_DIR/"

echo "[deploy] Installing Kanban API dependencies..."
cd "$APP_DIR/kanban/api" && npm install --production --silent

echo "[deploy] Running Kanban DB migrations..."
npm run migrate

echo "[deploy] Restarting Kanban API..."
pm2 restart kanban-api 2>/dev/null || pm2 start ecosystem.config.js

echo "[deploy] Installing Kanban frontend dependencies..."
cd "$APP_DIR/kanban/app" && npm install --silent

echo "[deploy] Building Kanban frontend..."
npm run build

echo "[deploy] Deploying Kanban frontend build..."
mkdir -p "$APP_DIR/kanban/frontend"
rm -rf "$APP_DIR/kanban/frontend"/*
cp -r "$APP_DIR/kanban/app/dist/"* "$APP_DIR/kanban/frontend/"

echo "[deploy] Reloading Nginx..."
sudo nginx -s reload

echo "[deploy] Done ✔"
