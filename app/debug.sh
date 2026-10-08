#!/usr/bin/env bash
# 快速调试启动：node-pty 只在首次/依赖重装/Electron 版本变化时 rebuild；TS 增量编译
# 用法: ./debug.sh            增量编译 + 启动
#       ./debug.sh --no-build 跳过编译直接启动（用现有 dist）
set -u
cd "$(dirname "$0")"

NO_BUILD=0
[ "${1:-}" = "--no-build" ] && NO_BUILD=1

if ! command -v node >/dev/null 2>&1; then
  echo "[debug] 未找到 node，请先安装 Node.js"
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "[debug] 未找到 node_modules，请先执行 npm install"
  exit 1
fi

# 记录当前 Electron 版本，用于判断 node-pty 是否需要重建
ELECTRON_VER=$(node -p "require('electron/package.json').version")
MARKER="node_modules/.pty-electron"
MARKER_VER=""
[ -f "$MARKER" ] && MARKER_VER=$(cat "$MARKER")

if [ -f "node_modules/node-pty/build/Release/pty.node" ] && [ -n "$ELECTRON_VER" ] && [ "$MARKER_VER" = "$ELECTRON_VER" ]; then
  echo "[debug] node-pty 就绪（Electron $ELECTRON_VER），跳过 rebuild"
else
  echo "[debug] 正在为 Electron $ELECTRON_VER 重建 node-pty（仅首次或版本变化时执行，请稍候）..."
  if ! npx electron-rebuild -f -w node-pty; then
    echo "[debug] electron-rebuild 失败，终端功能可能不可用"
    exit 1
  fi
  printf '%s\n' "$ELECTRON_VER" > "$MARKER"
fi

if [ "$NO_BUILD" = "0" ]; then
  echo "[debug] 增量编译 TypeScript..."
  if ! npx tsc -p tsconfig.json --incremental --tsBuildInfoFile dist/.tsbuildinfo; then
    echo "[debug] 编译失败"
    exit 1
  fi
else
  echo "[debug] 跳过编译（--no-build）"
fi

echo "[debug] 启动 Electron..."
npx electron .
