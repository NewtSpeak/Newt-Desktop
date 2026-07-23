#!/usr/bin/env bash
# 生成组件 Release 说明：标签注解 / RELEASE_NOTES.md / commit 列表（含正文额外说明）
# 用法：
#   generate-release-notes.sh <component_display_name> [extra_notes_file]
# 环境变量：
#   VERSION / TAG（可选，默认从 GITHUB_REF_NAME 推断）
# 输出：stdout 为 Markdown；同时写入 RELEASE_BODY.md
set -euo pipefail

COMPONENT="${1:-Component}"
EXTRA_FILE="${2:-}"

if [[ -z "${TAG:-}" ]]; then
  if [[ "${GITHUB_REF_NAME:-}" == v* ]]; then
    TAG="${GITHUB_REF_NAME}"
  elif [[ -n "${VERSION:-}" ]]; then
    TAG="v${VERSION}"
  else
    TAG="v0.0.0"
  fi
fi
VERSION="${VERSION:-${TAG#v}}"

OUT_FILE="${RELEASE_BODY_PATH:-RELEASE_BODY.md}"

# 确定 commit 区间：优先相对本 tag 的上一个 v*；tag 尚未创建时用当前 HEAD 相对上一 tag
if git rev-parse "$TAG" >/dev/null 2>&1; then
  PREV_TAG="$(git describe --tags --abbrev=0 --match 'v*' "${TAG}^" 2>/dev/null || true)"
  RANGE_END="$TAG"
else
  PREV_TAG="$(git describe --tags --abbrev=0 --match 'v*' 2>/dev/null || true)"
  RANGE_END="HEAD"
fi

if [[ -z "${PREV_TAG:-}" ]]; then
  PREV_TAG="$(git rev-list --max-parents=0 HEAD | head -1)"
  RANGE="${PREV_TAG}..${RANGE_END}"
  RANGE_LABEL="自仓库初始提交"
else
  RANGE="${PREV_TAG}..${RANGE_END}"
  RANGE_LABEL="自 ${PREV_TAG}"
fi

{
  echo "## ${COMPONENT} ${TAG}"
  echo
  echo "> 构建：\`${GITHUB_SHA:-$(git rev-parse HEAD)}\` · ${RANGE_LABEL}"
  echo

  # 1) 标签注解（git tag -a -m "..."）
  if git rev-parse "$TAG" >/dev/null 2>&1; then
    TAG_MSG="$(git tag -l --format='%(contents)' "$TAG" 2>/dev/null || true)"
    TAG_MSG="$(printf '%s' "$TAG_MSG" | sed -e 's/[[:space:]]*$//')"
    if [[ -n "$TAG_MSG" ]]; then
      echo "### 版本说明"
      echo
      printf '%s\n' "$TAG_MSG"
      echo
    fi
  fi

  # 2) 手动维护的 RELEASE_NOTES.md
  if [[ -f RELEASE_NOTES.md ]]; then
    echo "### 发布备注（RELEASE_NOTES.md）"
    echo
    cat RELEASE_NOTES.md
    echo
  fi

  # 3) workflow_dispatch 等额外说明文件
  if [[ -n "$EXTRA_FILE" && -f "$EXTRA_FILE" ]]; then
    echo "### 附加说明"
    echo
    cat "$EXTRA_FILE"
    echo
  fi

  # 4) Commit 变更（subject + 正文作为额外注释）
  echo "### 变更记录"
  echo

  COMMITS=()
  while IFS= read -r hash; do
    [[ -n "$hash" ]] && COMMITS+=("$hash")
  done < <(git log "$RANGE" --pretty=format:'%H' --no-merges 2>/dev/null || true)

  if [[ ${#COMMITS[@]} -eq 0 ]]; then
    echo "_（无新 commit）_"
  else
    for hash in "${COMMITS[@]}"; do
      subject="$(git log -1 --pretty=format:'%s' "$hash")"
      body="$(git log -1 --pretty=format:'%b' "$hash" \
        | sed -e 's/[[:space:]]*$//' -e '/^Signed-off-by:/d' -e '/^Co-authored-by:/d')"
      short="$(git rev-parse --short "$hash")"
      echo "- **${subject}** (\`${short}\`)"
      if [[ -n "$body" ]]; then
        while IFS= read -r line; do
          [[ -z "$line" ]] && continue
          echo "  - ${line}"
        done <<< "$body"
      fi
    done
  fi

  echo
  echo "---"
  echo
  echo "_本说明由 CI 根据标签注解、RELEASE_NOTES.md 与 commit 自动生成。_"
} > "$OUT_FILE"

cat "$OUT_FILE"
echo "Wrote $OUT_FILE" >&2
