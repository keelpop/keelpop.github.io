#!/usr/bin/env bash
# SessionStart hook。標準出力がそのままセッションの文脈に入る。
#
# 目的は「続き」のセッションが、リポジトリを漁って現状を再構築しなくて済むようにすること。
# 41セッションのうち約4分の1が続き物で、毎回ゼロから探索していた。
#
# この hook はリモートのクラウドセッションで有効にならない可能性がある。
# そのため NOW.md とルールは CLAUDE.md からも @ で参照してあり、
# hook が動かなくても文脈には入る。ここが落ちても何も壊れない。
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0

echo "=== リポジトリの現況（自動生成） ==="
echo "ブランチ: $(git rev-parse --abbrev-ref HEAD 2>/dev/null)"

git fetch --quiet --prune origin 2>/dev/null || true

echo
echo "--- 未マージの claude/* ブランチ ---"
found=0
for b in $(git for-each-ref --format='%(refname:short)' refs/remotes/origin/claude 2>/dev/null); do
  ahead=$(git rev-list --count "origin/main..$b" 2>/dev/null || echo 0)
  [ "$ahead" = "0" ] && continue
  found=1
  echo "  $b  (+${ahead}コミット, 最終: $(git log -1 --format=%cr "$b" 2>/dev/null))"
done
[ "$found" = "0" ] && echo "  なし"

echo
echo "--- いま何をしているか (.claude/state/NOW.md) ---"
if [ -f .claude/state/NOW.md ]; then cat .claude/state/NOW.md; else echo "  (まだありません)"; fi

echo
echo "--- 適用中のルール (.claude/rules/00-core.md) ---"
if [ -f .claude/rules/00-core.md ]; then
  grep -E '^### |^rule: ' .claude/rules/00-core.md 2>/dev/null | sed 's/^/  /'
else
  echo "  (まだありません)"
fi

echo
echo "--- サイト検査 ---"
python3 tools/check_site.py 2>&1 | tail -8

echo
echo "このセッションのスコープは NOW.md の「次の一手」1件に限る。"
echo "他の改善を思いついたら、その場で手を出さず NOW.md か INCIDENTS.jsonl に書いて終えること。"
echo "締めるときは /finish-session を使う。"
echo "=== 現況ここまで ==="
exit 0
