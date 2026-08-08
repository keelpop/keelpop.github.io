#!/usr/bin/env bash
# ローカルにしかないプロジェクトを、iPhone からも触れる状態にする。
#
#   bash go-online.sh ~/path/to/プロジェクト
#
# やること（この順で、途中で止まったら何も壊さずに終わる）
#   1. 外に出してはいけないものが混ざっていないか調べる  ← ここで止まったら先に進まない
#   2. 大きすぎるファイルが無いか調べる
#   3. .gitignore を用意する
#   4. git の履歴が無ければ作る
#   5. セッションの失敗を防ぐ仕組みを入れる
#   6. GitHub に **非公開** リポジトリを作って push する
#
# 何度実行しても大丈夫。既にあるものは触らない。
# 公開リポジトリは作らない。あとから自分で公開に変えることはできる。
set -uo pipefail

TARGET="${1:-}"
REPO_NAME="${2:-}"
KIT_URL="https://github.com/keelpop/keelpop.github.io"
KIT_DIR="$(mktemp -d)/kit"

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ng()   { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

[ -n "$TARGET" ] || ng "使い方: bash go-online.sh ~/path/to/プロジェクト"
[ -d "$TARGET" ] || ng "そのフォルダが見つかりません: $TARGET"
TARGET="$(cd "$TARGET" && pwd)"
[ -n "$REPO_NAME" ] || REPO_NAME="$(basename "$TARGET" | tr '[:upper:] ' '[:lower:]-' | tr -cd 'a-z0-9._-')"

command -v git >/dev/null    || ng "git が見つかりません。"
command -v python3 >/dev/null || ng "python3 が見つかりません。"

say "== $TARGET を GitHub の非公開リポジトリ '$REPO_NAME' に上げます"

say "-- 道具を取ってきます"
git clone --depth 1 --quiet "$KIT_URL" "$KIT_DIR" || ng "道具の取得に失敗しました。ネットに繋がっていますか。"
for f in tools/scan_secrets.py scripts/install-rule-system.sh; do
  [ -f "$KIT_DIR/$f" ] || ng "道具が揃っていません（$f が無い）。取得先が古い可能性があります。"
done

# ---------------------------------------------------------------- 1. 秘密
say "-- 1/6 外に出してはいけないものが無いか調べます"
if ! python3 "$KIT_DIR/tools/scan_secrets.py" "$TARGET"; then
  cat >&2 <<'STOP'

ここで止めました。まだ何も送信していません。

一度 GitHub に上げたものは、あとから消しても履歴と他人のクローンに残ります。
取り消せない種類の失敗なので、先に上の指摘を片付けてください。
片付いたら、同じコマンドをもう一度実行すれば続きから進みます。
STOP
  exit 1
fi

# ---------------------------------------------------------------- 2. 大物
say "-- 2/6 大きすぎるファイルが無いか調べます"
BIG=$(find "$TARGET" -type f -size +50M -not -path '*/.git/*' -not -path '*/node_modules/*' 2>/dev/null || true)
if [ -n "$BIG" ]; then
  echo "50MB を超えるファイルがあります。GitHub は100MBを超えると受け取りません。" >&2
  echo "$BIG" | sed 's/^/  /' >&2
  ng "これらを消すか .gitignore に入れてから、もう一度実行してください。"
fi
echo "  大きすぎるファイルはありません。"

# ---------------------------------------------------------------- 3. gitignore
say "-- 3/6 .gitignore を用意します"
if [ -e "$TARGET/.gitignore" ]; then
  echo "  既にあります。触りません。"
else
  cat > "$TARGET/.gitignore" <<'IGNORE'
# 秘密・環境ごとの設定
.env
.env.*
*.pem
*.key
credentials.json

# 作業中に勝手にできるもの
.DS_Store
Thumbs.db
__pycache__/
*.pyc
node_modules/
.venv/
IGNORE
  echo "  作りました。"
fi

# ---------------------------------------------------------------- 4. git
say "-- 4/6 git の履歴を確かめます"
cd "$TARGET"
if [ -d .git ]; then
  echo "  既にあります。"
else
  git init -q
  echo "  作りました。"
fi
git config user.name  >/dev/null 2>&1 || git config user.name  "keelpop"
git config user.email >/dev/null 2>&1 || git config user.email "keel00biz@gmail.com"
if [ -z "$(git rev-parse --verify HEAD 2>/dev/null || true)" ]; then
  git add -A && git commit -q -m "Bring the project under version control"
  echo "  最初のコミットを作りました。"
fi
git branch -M main 2>/dev/null || true

# ---------------------------------------------------------------- 5. 仕組み
say "-- 5/6 セッションの失敗を防ぐ仕組みを入れます"
bash "$KIT_DIR/scripts/install-rule-system.sh" "$TARGET" | sed 's/^/  /'
git add -A
git diff --cached --quiet || git commit -q -m "Add the rule system: constitution, state, checker and CI"

# ---------------------------------------------------------------- 6. GitHub
say "-- 6/6 GitHub に上げます"
if git remote get-url origin >/dev/null 2>&1; then
  echo "  origin は既に設定済み: $(git remote get-url origin)"
elif command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
  gh repo create "$REPO_NAME" --private --source=. --remote=origin \
    || ng "リポジトリの作成に失敗しました。同じ名前が既にあるかもしれません。第2引数で別の名前を指定してください。"
  echo "  非公開リポジトリを作りました。"
else
  cat <<MANUAL

  gh コマンドが使えないので、ここだけ手でお願いします。

  1. https://github.com/new を開く
  2. Repository name に  $REPO_NAME
  3. **Private を選ぶ**（Public にしない）
  4. README や .gitignore は追加しない（そのまま Create）
  5. 作れたら、このフォルダで次を実行:

       cd "$TARGET"
       git remote add origin https://github.com/keelpop/$REPO_NAME.git
       git push -u origin main

MANUAL
  exit 0
fi

git push -u origin main || ng "push に失敗しました。上のメッセージを確認してください。"

cat <<DONE

== 終わりました

  https://github.com/keelpop/$REPO_NAME  （非公開）

これで iPhone からも触れます:
  1. claude.ai/code を開く
  2. リポジトリの一覧から $REPO_NAME を選ぶ
  3. 話しかければ、そのまま作業できます

入れた仕組みについて:
  - main への push がそのまま公開される作りではないので、
    「壊したら即公開」の心配はありません。
  - CLAUDE.md の §2「このリポジトリの事実」だけ、あとで書き足してください。
    特に、全文を読ませたくない大きなファイルを挙げておくと、
    毎回のセッションが軽くなります。
DONE
