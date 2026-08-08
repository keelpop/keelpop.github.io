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
#
# 拡張子まで縛るのは、この2つのディレクトリの中身が CLAUDE.md から @ で
# 全セッションに読み込まれるため。無人セッションが任意のファイルを置ける場所に
# してはいけない。
SELF_UPDATABLE = [
    ".claude/state/*.md", ".claude/state/*.jsonl",
    ".claude/rules/*.md",
]

# ここを触る変更は絶対に自動マージしない。
# 保護機構そのものを、保護機構をすり抜けて書き換えられないようにするための一覧。
# この設計が無いと、機械が自分の檻の鍵を作れてしまう。
#
# `**/` 付きが並んでいるのは、fnmatch の `*` が `/` をまたぐとはいえ
# `CLAUDE.md` のような完全一致パターンは `docs/CLAUDE.md` に当たらないため。
# Claude Code はサブディレクトリの CLAUDE.md も読むので、そこが抜けると
# 「機械が自分への指示を人のレビュー無しで配る」経路が開く。
DENY = [
    ".github/*", ".github/**", "**/.github/**",
    ".claude/*", ".claude/**", "**/.claude/**",
    "tools/*", "tools/**", "**/tools/**",
    ".githooks/*", ".githooks/**",
    "CLAUDE.md", "**/CLAUDE.md",
    "CNAME", "**/CNAME",
    ".gitattributes", ".gitignore", ".nojekyll",
    # `**/` を付けたパターンは `/` を1つ以上要求するので、ルート直下には当たらない。
    # 両方書くこと。ALLOW に *.json を足したとき、これが無くて
    # ルートの package-lock.json だけが通り抜けていた。
    "package.json", "**/package.json",
    "package-lock.json", "**/package-lock.json",
    "npm-shrinkwrap.json", "**/npm-shrinkwrap.json",
    "*.lock", "**/*.lock",
    ".env", ".env.*", "**/.env", "**/.env.*",
    "_config.yml", "_layouts/**", "_includes/**", "_posts/**", "_data/**",
]

# 逆に、ここだけなら通してよい。列挙にないパスは既定で止める。
#
# .js を含めてあるのは、除いても防御にならないため。HTML はインラインの
# <script> ごと通るので、同じコードを .js に切り出した瞬間だけ止まるのは
# 一貫していない。実際にブラウザゲームのブランチが breathless/js/audio.js
# だけで永久に保留になり、「全部止まって溜まる」元の状態に戻りかけた。
# ページの中身の危険な書き方（<base href> / meta refresh）は check_site が見る。
#
# tools/ は仕組み専用に予約されている（DENY 側）。サイトの生成スクリプトは
# scripts/ に置くこと。tools/ に置くと毎回保留になる。
# 実際にゲームのレベル生成スクリプトが tools/ に置かれ、それ1本のせいで
# ブランチ全体が止まった。「置き場所が無い」ことが原因の保留は、
# 保留の理由として正当ではないので、置き場所のほうを用意する。
ALLOW = [
    "*.html", "**/*.html",
    "*.css", "**/*.css",
    "*.md", "**/*.md",
    "*.js", "**/*.js",
    "*.json", "**/*.json",
    "**/*.png", "**/*.jpg", "**/*.jpeg", "**/*.gif",
    "**/*.svg", "**/*.webp", "**/*.ico",
    "**/*.woff", "**/*.woff2", "**/*.ttf",
    "**/*.mp3", "**/*.ogg", "**/*.wav",
    "assets/**", "**/assets/**", "data/**",
    "scripts/*", "scripts/**",
    "suno/*", "suno/**",
]

MAX_ADDED = 2000
MAX_FILES = 25
MAX_FILE_BYTES = 5 * 1024 * 1024  # 行数で測れないファイル（画像・バイナリ）用

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def sh(*args):
    return subprocess.run(args, capture_output=True, text=True, cwd=ROOT).stdout


def out(safe, reason):
    # reason はこの後シェルに渡る。引用符が混ざるとコマンド注入や構文エラーになるので、
    # ここで落としておく（拒否されたパスにファイル名がそのまま入るため実際に起こりうる）。
    reason = reason.replace("'", "").replace('"', "").replace("`", "").replace("$", "")
    print("safe=%s" % ("true" if safe else "false"))
    print("reason=%s" % reason)
    sys.exit(0)


def main():
    base = "origin/main"

    # --no-renames が要。git は既定でリネームを1件にまとめ、移動先のパスしか出さない。
    # そのままだと `git mv .github/workflows/autoflow.yml assets/notes.md` が
    # 「assets/notes.md を足しただけ、削除0件、増減0行」に見え、
    # DENY も削除禁止も行数上限も全部すり抜けて保護機構ごと消せる。
    names = [n for n in sh("git", "diff", "--no-renames", "--name-only",
                           "%s...HEAD" % base).split("\n") if n]
    if not names:
        out(False, "main との差分がありません")

    for path in names:
        if any(fnmatch.fnmatch(path, p) for p in SELF_UPDATABLE):
            continue
        if any(fnmatch.fnmatch(path, p) for p in DENY):
            out(False, "保護対象を変更しています: %s（この種の変更は必ず人が見ます）" % path)
        if not any(fnmatch.fnmatch(path, p) for p in ALLOW):
            out(False, "自動マージの対象外のパスです: %s" % path)

    # D も R も止める。R（リネーム）は --no-renames で D+A に分解されるが、念のため。
    deleted = [n for n in sh("git", "diff", "--no-renames", "--diff-filter=DR",
                             "--name-only", "%s...HEAD" % base).split("\n") if n]
    if deleted:
        out(False, "ファイルを削除しています: %s" % ", ".join(deleted))

    added = 0
    for line in sh("git", "diff", "--no-renames", "--numstat", "%s...HEAD" % base).splitlines():
        cols = line.split("\t")
        if cols[0].isdigit():
            added += int(cols[0])
        elif cols[0] == "-" and len(cols) > 2:
            # バイナリ。行数では測れないのでサイズで見る。
            # ここが無いと 60MB の zip が「+0行」として通る。
            blob = sh("git", "rev-parse", "HEAD:%s" % cols[2]).strip()
            size = sh("git", "cat-file", "-s", blob).strip() if blob else ""
            if size.isdigit() and int(size) > MAX_FILE_BYTES:
                out(False, "%s が %.1fMB あります（上限 %dMB）"
                    % (cols[2], int(size) / 1024 / 1024, MAX_FILE_BYTES // 1024 // 1024))

    if added > MAX_ADDED or len(names) > MAX_FILES:
        out(False, "規模が大きすぎます（+%d行 / %dファイル、上限 +%d / %d）"
            % (added, len(names), MAX_ADDED, MAX_FILES))

    # 人が自動マージを止めたいときの手段。リポジトリ直下に .no-automerge を置くだけ。
    # ALLOW に入れていないので、このファイル自体を足す変更も自動マージされない。
    # PR を作らない設計なのでラベルは使えない（gh pr view が必ず失敗する）。
    if os.path.exists(os.path.join(ROOT, ".no-automerge")):
        out(False, ".no-automerge があるので止めました")

    merged = subprocess.run(["git", "merge-tree", "--write-tree", base, "HEAD"],
                            capture_output=True, text=True, cwd=ROOT)
    if merged.returncode != 0:
        out(False, "main と衝突します。rebase が必要です")

    out(True, "全条件クリア（+%d行 / %dファイル）" % (added, len(names)))


if __name__ == "__main__":
    main()
