#!/usr/bin/env bash
# このリポジトリで作った「セッションの失敗を機械で防ぐ仕組み」を、別のリポジトリに入れる。
#
#   bash scripts/install-rule-system.sh /path/to/other-repo
#
# 入れるもの:
#   tools/check_site.py          品質とルール系の検査
#   tools/automerge_gate.py      自動マージしてよい変更かの判定
#   tools/test_automerge_gate.py その判定が崩れていないかのテスト
#   tools/session_start.sh       セッション開始時に現況を流し込む
#   .claude/settings.json        上の hook の登録
#   .claude/skills/              /finish-session と /rule-gardener
#   .github/workflows/           検査・自動マージ・夜間の掃除（GitHub にあるときだけ）
#   CLAUDE.md .claude/rules .claude/state   雛形（既にあれば上書きしない）
#
# 既にあるファイルは上書きしない。中身の調整は入れた先でやること。
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DST="${1:-}"

if [ -z "$DST" ]; then
  echo "使い方: bash scripts/install-rule-system.sh /path/to/other-repo" >&2
  exit 1
fi
if [ ! -d "$DST/.git" ]; then
  echo "エラー: $DST は git リポジトリではありません" >&2
  exit 1
fi

DATE=$(date +%Y-%m-%d)
REVIEW=$(date -d '+90 days' +%Y-%m-%d 2>/dev/null || date -v+90d +%Y-%m-%d)

copy() {  # copy <相対パス> — 既にあれば触らない
  local rel="$1"
  if [ -e "$DST/$rel" ]; then
    echo "  そのまま  $rel（既にあります）"
    return
  fi
  mkdir -p "$DST/$(dirname "$rel")"
  cp -R "$SRC/$rel" "$DST/$rel"
  echo "  入れた    $rel"
}

fill() {  # fill <雛形> <置き先> — 既にあれば触らない
  local tpl="$1" rel="$2"
  if [ -e "$DST/$rel" ]; then
    echo "  そのまま  $rel（既にあります）"
    return
  fi
  mkdir -p "$DST/$(dirname "$rel")"
  sed -e "s/__DATE__/$DATE/g" \
      -e "s/__REVIEW__/$REVIEW/g" \
      -e "s|__PROJECT__|$(basename "$DST")|g" \
      "$SRC/scripts/rule-system-templates/$tpl" > "$DST/$rel"
  echo "  作った    $rel"
}

echo "== 仕組みを入れます: $DST"

echo "-- 検査と門"
copy tools/check_site.py
copy tools/automerge_gate.py
copy tools/test_automerge_gate.py
copy tools/session_start.sh
chmod +x "$DST"/tools/*.sh "$DST"/tools/*.py 2>/dev/null || true

echo "-- セッションの手順"
copy .claude/settings.json
copy .claude/skills/finish-session
copy .claude/skills/rule-gardener

echo "-- 憲法・ルール・状態"
fill CLAUDE.md  CLAUDE.md
fill 00-core.md .claude/rules/00-core.md
fill NOW.md     .claude/state/NOW.md
[ -e "$DST/.claude/state/INCIDENTS.jsonl" ] || { : > "$DST/.claude/state/INCIDENTS.jsonl"; echo "  作った    .claude/state/INCIDENTS.jsonl"; }
[ -e "$DST/.claude/state/DECISIONS.md" ] || { printf '# 決定の記録\n\n追記のみ。読むときは grep して該当箇所だけ読む。\n' > "$DST/.claude/state/DECISIONS.md"; echo "  作った    .claude/state/DECISIONS.md"; }

# GitHub にあるリポジトリでなければ Actions は意味が無い。
if git -C "$DST" remote -v 2>/dev/null | grep -q github.com; then
  echo "-- GitHub Actions"
  copy .github/workflows/site-check.yml
  copy .github/workflows/autoflow.yml
  copy .github/workflows/nightly.yml
else
  echo "-- GitHub Actions: 入れません（github.com のリモートが見つかりません）"
  echo "   検査は手で回すことになります: python3 tools/check_site.py"
fi

cat <<'NEXT'

== 入れ終わりました。この3つだけ、入れた先で直してください

1. CLAUDE.md の §2「このリポジトリの事実」
   特に、全文を読ませたくない巨大ファイルを必ず挙げること。
   これが無いと、1ファイル読むだけで数万トークン消えるセッションが生まれます。

2. tools/check_site.py の NOT_THE_SITE
   公開対象ではないディレクトリ（アプリ・下書き等）を並べる。

3. tools/automerge_gate.py の ALLOW
   そのリポジトリで「人が見なくてよい退屈な変更」の置き場所に合わせる。
   直したら必ず python3 tools/test_automerge_gate.py を通すこと。
   期待値も一緒に直さないと、保護が緩んだことに気付けません。

そのあと:
   python3 tools/check_site.py     ERROR が 0 になるまで直す
   python3 tools/test_automerge_gate.py

ルールは最初から書かないこと。実際に起きた失敗を INCIDENTS.jsonl に貯めて、
週次の /rule-gardener に生やさせるのが、この仕組みの効き方です。
NEXT
