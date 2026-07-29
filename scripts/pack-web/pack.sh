#!/usr/bin/env bash
# 将 build/client 打成可独立部署的前端包
# 用法：VERSION=0.1.0 ./scripts/pack-web/pack.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VERSION="${VERSION:-0.0.0}"
OUT_DIR="${OUT_DIR:-$ROOT/dist-web}"
STAGE="$OUT_DIR/newt-desktop-web-${VERSION}"
ZIP_NAME="newt-desktop-web-${VERSION}.zip"

if [[ ! -f "$ROOT/build/client/index.html" ]]; then
  echo "missing build/client/index.html — run bun run build first" >&2
  exit 1
fi

rm -rf "$STAGE"
mkdir -p "$STAGE"
cp -R "$ROOT/build/client/." "$STAGE/"
cp "$(dirname "$0")/README.deploy.md" "$STAGE/README.md"

mkdir -p "$OUT_DIR"
(
  cd "$OUT_DIR"
  rm -f "$ZIP_NAME"
  # 进 STAGE 父目录打包，使 zip 内带顶层目录
  if command -v zip >/dev/null 2>&1; then
    zip -r "$ZIP_NAME" "newt-desktop-web-${VERSION}"
  else
    python3 - <<PY
import shutil
shutil.make_archive("newt-desktop-web-${VERSION}", "zip", ".", "newt-desktop-web-${VERSION}")
print("created newt-desktop-web-${VERSION}.zip")
PY
  fi
  sha256sum "$ZIP_NAME" | tee "${ZIP_NAME}.sha256"
  ls -lh "$ZIP_NAME"
)
echo "Packed: $OUT_DIR/$ZIP_NAME"
