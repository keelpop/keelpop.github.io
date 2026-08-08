#!/usr/bin/env python3
"""自動マージしてよいブランチかを判定する。GitHub Actions から呼ばれる。

全条件を満たしたときだけ safe=true を出す。1つでも外れたら safe=false と理由。
判定はすべて機械的な事実（触ったパス・行数・削除の有無・衝突の有無）だけを見る。
「良さそうかどうか」は判定しない。人間のレビューの代わりではなく、
"人間のレビューが要らないほど退屈な変更" だけを通すための門。
"""

import fnmatch
import os
import subprocess
import sys

# 週次の棚卸しが書き換える場所。ここだけは DENY より先に許す。
#
# ここを分けないと矛盾する: rule-gardener は .claude/rules と .claude/state を
# 更新するのが仕事なのに、.claude/** が丸ごと DENY だと成果が永久にマージされず、
# Issue だけが毎週積み上がる。だから「ルールと状態」は機械が更新してよく、
# 「ルールを強制する仕組み」（tools / .github / settings.json / skills / 憲法）は
# 触らせない、という粒度にしてある。
# 悪いルールが入っても、それを取り締まる検査そのものは書き換えられない。
SELF_UPDATABLE = [
    ".claude/state/*", ".claude/state/**",
    ".claude/rules/*", ".claude/rules/**",
]

# ここを触る変更は絶対に自動マージしない。
# 保護機構そのものを、保護機構をすり抜けて書き換えられないようにするための一覧。
# この設計が無いと、機械が自分の檻の鍵を作れてしまう。
DENY = [
    ".github/*", ".github/**",
    ".claude/*", ".claude/**",
    "tools/*", "tools/**",
    ".githooks/*", ".githooks/**",
    "CLAUDE.md", "CNAME", ".gitattributes", ".gitignore",
    "**/package.json", "**/package-lock.json", "**/*.lock",
    "**/.env", "**/.env.*",
]

# 逆に、ここだけなら通してよい。列挙にないパスは既定で止める。
ALLOW = [
    "*.html", "**/*.html",
    "*.css", "**/*.css",
    "*.md", "**/*.md",
    "assets/**", "data/**",
    "suno/*", "suno/**",
]

MAX_ADDED = 2000
MAX_FILES = 25


def sh(*args):
    return subprocess.run(args, capture_output=True, text=True).stdout


def out(safe, reason):
    print("safe=%s" % ("true" if safe else "false"))
    print("reason=%s" % reason)
    sys.exit(0)


def main():
    base = "origin/main"
    names = [n for n in sh("git", "diff", "--name-only", "%s...HEAD" % base).split("\n") if n]
    if not names:
        out(False, "main との差分がありません")

    for path in names:
        if any(fnmatch.fnmatch(path, p) for p in SELF_UPDATABLE):
            continue
        if any(fnmatch.fnmatch(path, p) for p in DENY):
            out(False, "保護対象を変更しています: %s（この種の変更は必ず人が見ます）" % path)
        if not any(fnmatch.fnmatch(path, p) for p in ALLOW):
            out(False, "自動マージの対象外のパスです: %s" % path)

    deleted = [n for n in sh("git", "diff", "--diff-filter=D", "--name-only",
                             "%s...HEAD" % base).split("\n") if n]
    if deleted:
        out(False, "ファイルを削除しています: %s" % ", ".join(deleted))

    added = 0
    for line in sh("git", "diff", "--numstat", "%s...HEAD" % base).splitlines():
        col = line.split("\t")[0]
        if col.isdigit():
            added += int(col)
    if added > MAX_ADDED or len(names) > MAX_FILES:
        out(False, "規模が大きすぎます（+%d行 / %dファイル、上限 +%d / %d）"
            % (added, len(names), MAX_ADDED, MAX_FILES))

    # 実際にマージを試して衝突を確かめる（ワークツリーは汚さない）
    merged = subprocess.run(["git", "merge-tree", "--write-tree", base, "HEAD"],
                            capture_output=True, text=True)
    if merged.returncode != 0:
        out(False, "main と衝突します。rebase が必要です")

    branch = os.environ.get("GITHUB_REF_NAME", "")
    if branch:
        labels = sh("gh", "pr", "view", branch, "--json", "labels", "-q", ".labels[].name")
        for stop in ("no-automerge", "needs-human"):
            if stop in labels:
                out(False, "%s ラベルが付いています" % stop)

    out(True, "全条件クリア（+%d行 / %dファイル）" % (added, len(names)))


if __name__ == "__main__":
    main()
