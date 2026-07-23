#!/usr/bin/env bash
# 将本组件 Release 资产与说明同步到组织中心发布仓 OwlSpeak/OwlSpeak
# 环境变量：
#   RELEASE_HUB_TOKEN  有目标仓写权限的 PAT（必填）
#   RELEASE_HUB_REPO   默认 OwlSpeak/OwlSpeak
#   TAG                如 v0.1.0
#   COMPONENT_KEY      区块键，如 Owl-SFU / Owl-Server / Owl-Desktop
#   COMPONENT_TITLE    展示名
#   RELEASE_BODY_PATH  本组件说明 Markdown
#   ASSET_GLOBS        空格分隔的资产 glob（相对 cwd）
set -euo pipefail

HUB_REPO="${RELEASE_HUB_REPO:-OwlSpeak/OwlSpeak}"
TAG="${TAG:?TAG required}"
COMPONENT_KEY="${COMPONENT_KEY:?COMPONENT_KEY required}"
COMPONENT_TITLE="${COMPONENT_TITLE:-$COMPONENT_KEY}"
BODY_PATH="${RELEASE_BODY_PATH:-RELEASE_BODY.md}"
TOKEN="${RELEASE_HUB_TOKEN:-}"

if [[ -z "$TOKEN" ]]; then
  echo "::warning::未配置 RELEASE_HUB_TOKEN，跳过同步到 ${HUB_REPO}"
  exit 0
fi

export GH_TOKEN="$TOKEN"

if [[ ! -f "$BODY_PATH" ]]; then
  echo "missing release body: $BODY_PATH" >&2
  exit 1
fi

SECTION_BODY="$(cat "$BODY_PATH")"
BEGIN="<!-- BEGIN:${COMPONENT_KEY} -->"
END="<!-- END:${COMPONENT_KEY} -->"
SECTION="${BEGIN}
## ${COMPONENT_TITLE}

${SECTION_BODY}

${END}"

# 确保 tag 在 hub 上存在（轻量空 commit 不需要；release 可挂游离 tag）
if ! gh release view "$TAG" --repo "$HUB_REPO" >/dev/null 2>&1; then
  echo "Creating hub release ${TAG} on ${HUB_REPO}"
  # 初始 body 仅含本组件区块
  FULL_BODY="# OwlSpeak ${TAG}

统一发布包（桌面端 / 服务端 / SFU / 未来 App）。各组件完成构建后会自动合并到此版本。

${SECTION}
"
  gh release create "$TAG" \
    --repo "$HUB_REPO" \
    --title "OwlSpeak ${TAG}" \
    --notes "$FULL_BODY" \
    --latest=false
else
  echo "Updating hub release ${TAG} section ${COMPONENT_KEY}"
  EXISTING="$(gh release view "$TAG" --repo "$HUB_REPO" --json body -q .body)"
  # 用 python 做区块替换，避免 sed 多行问题
  export EXISTING SECTION BEGIN END FULL_OUT
  FULL_OUT="$(python3 - <<'PY'
import os, re
existing = os.environ.get("EXISTING") or ""
section = os.environ["SECTION"]
begin = os.environ["BEGIN"]
end = os.environ["END"]
pattern = re.compile(
    re.escape(begin) + r".*?" + re.escape(end),
    re.DOTALL,
)
if pattern.search(existing):
    new_body = pattern.sub(section, existing)
else:
    if existing.strip():
        new_body = existing.rstrip() + "\n\n" + section + "\n"
    else:
        new_body = f"# OwlSpeak\n\n{section}\n"
print(new_body)
PY
)"
  gh release edit "$TAG" --repo "$HUB_REPO" --notes "$FULL_OUT"
fi

# 上传资产
shopt -s nullglob
ASSETS=()
if [[ -n "${ASSET_GLOBS:-}" ]]; then
  # shellcheck disable=SC2206
  for g in $ASSET_GLOBS; do
    for f in $g; do
      ASSETS+=("$f")
    done
  done
fi

if [[ ${#ASSETS[@]} -eq 0 ]]; then
  echo "No assets matched ASSET_GLOBS=${ASSET_GLOBS:-}" >&2
else
  echo "Uploading ${#ASSETS[@]} assets to ${HUB_REPO}@${TAG}"
  # --clobber 覆盖同名资产（重跑 CI 安全）
  gh release upload "$TAG" "${ASSETS[@]}" --repo "$HUB_REPO" --clobber
fi

echo "Hub sync done → https://github.com/${HUB_REPO}/releases/tag/${TAG}"
