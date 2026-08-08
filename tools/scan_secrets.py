#!/usr/bin/env python3
"""外に出してはいけないものが混ざっていないか調べる。

    python3 tools/scan_secrets.py [調べたいフォルダ]

**push する前に必ず通すこと。** 一度 GitHub に上げた秘密は、
あとから消しても履歴と他人のクローンに残る。取り消せない種類の失敗なので、
誤検知が多少うるさくても止める側に倒してある。

見つかったら exit 1。中身は伏せて、場所と種類だけを出す。
"""

import os
import re
import subprocess
import sys

# 見つけたら止めるもの。名前だけで分かるファイル。
BAD_NAMES = re.compile(
    r"^(\.env(\..*)?|id_rsa|id_ed25519|.*\.pem|.*\.p12|.*\.pfx|.*\.keystore"
    r"|credentials\.json|service-account.*\.json|\.netrc|\.npmrc|\.pypirc)$",
    re.I,
)

# `.env.example` の類は「値を伏せた雛形」で、リポジトリに入れるのが普通。
# 名前で止めない。中身は他と同じように調べるので、誤って本物を書いていれば捕まる。
TEMPLATE_ENV = re.compile(r"^\.env\.(example|sample|template|tpl|dist|local\.example)$", re.I)

# 中身のパターン。(名前, 正規表現)
PATTERNS = [
    ("Anthropic の APIキー", re.compile(r"sk-ant-[A-Za-z0-9_\-]{20,}")),
    ("OpenAI の APIキー", re.compile(r"\bsk-[A-Za-z0-9]{32,}")),
    ("GitHub のトークン", re.compile(r"\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}")),
    ("GitHub の PAT", re.compile(r"\bgithub_pat_[A-Za-z0-9_]{50,}")),
    ("AWS のアクセスキー", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("Google の APIキー", re.compile(r"\bAIza[0-9A-Za-z_\-]{35}\b")),
    ("Slack のトークン", re.compile(r"\bxox[baprs]-[0-9A-Za-z\-]{10,}")),
    ("秘密鍵", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("パスワードの直書き", re.compile(r"""(?i)\bpass(word|wd)\s*[:=]\s*["'][^"'\s]{8,}["']""")),
    ("APIキーの直書き", re.compile(r"""(?i)\bapi[_\-]?key\s*[:=]\s*["'][^"'\s]{16,}["']""")),
    ("トークンの直書き", re.compile(r"""(?i)\b(secret|token)\s*[:=]\s*["'][^"'\s]{20,}["']""")),
]

SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv", "dist", "build"}
BINARY_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".mp3", ".mp4",
              ".ogg", ".wav", ".zip", ".gz", ".pdf", ".woff", ".woff2", ".ttf",
              ".psd", ".ai", ".mov", ".exe", ".dll", ".so", ".dylib"}
MAX_BYTES = 2 * 1024 * 1024  # これ以上のテキストは読まない


def target_files(root):
    """調べるべきファイルの一覧。

    git リポジトリなら「git が実際に送るもの」だけを見る。
    .gitignore で除外されているファイルは、そこに何が書いてあっても
    リポジトリには入らないので、止める理由が無い。
    ディスク上の全ファイルを見ていると、手元にしか無い .env のせいで
    先へ進めなくなる（実際にそうなった）。
    """
    if os.path.isdir(os.path.join(root, ".git")):
        try:
            out = subprocess.run(
                ["git", "-C", root, "ls-files", "-co", "--exclude-standard", "-z"],
                capture_output=True, text=True, check=True).stdout
            return [r for r in out.split("\0") if r]
        except (OSError, subprocess.CalledProcessError):
            pass  # git が使えなければ下の総当たりに落ちる

    found = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in filenames:
            found.append(os.path.relpath(os.path.join(dirpath, name), root))
    return found


def scan(root, progress=True):
    files = target_files(root)
    total = len(files)
    # WSL から Windows 側のドライブ（/mnt/c）を読むのは非常に遅い。
    # 何も出ないまま数分黙っていると、止まったのか動いているのか分からず、
    # 止めたくなる。実際に大きなプロジェクトでそうなりかけた。
    if progress and total > 200:
        print("%d 個のファイルを調べます。時間がかかることがあります…" % total, flush=True)

    hits = []
    for done, rel in enumerate(files, 1):
        if progress and total > 200 and done % 500 == 0:
            print("  %d / %d" % (done, total), flush=True)
        path = os.path.join(root, rel)
        name = os.path.basename(rel)

        if BAD_NAMES.match(name) and not TEMPLATE_ENV.match(name):
            hits.append((rel, 0, "秘密が入りがちなファイル", name))
            continue

        if os.path.splitext(name)[1].lower() in BINARY_EXT:
            continue
        try:
            if os.path.getsize(path) > MAX_BYTES:
                continue
            text = open(path, encoding="utf-8", errors="ignore").read()
        except OSError:
            continue

        for lineno, line in enumerate(text.splitlines(), 1):
            if len(line) > 4000:
                continue
            for label, pat in PATTERNS:
                m = pat.search(line)
                if m:
                    hit = m.group(0)
                    masked = hit[:6] + "…" + hit[-2:] if len(hit) > 12 else "…"
                    hits.append((rel, lineno, label, masked))
                    break
    return hits


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    root = os.path.abspath(args[0] if args else ".")
    hits = scan(root, progress="--quiet" not in sys.argv)

    if not hits:
        print("秘密らしきものは見つかりませんでした。")
        print("※ 完全ではありません。心当たりがあるものは自分でも確認してください。")
        return 0

    print("外に出してはいけないものが見つかりました。**この状態で push しないでください。**\n")
    for rel, lineno, label, masked in hits:
        where = "%s:%d" % (rel, lineno) if lineno else rel
        print("  %-14s %s" % (label, where))
        print("                 %s" % masked)
    print("\n見つかった数: %d" % len(hits))
    print("""
直し方:
  - そのファイルが不要なら消す。
  - 必要なら .gitignore に足して、リポジトリに入れない。
  - コードに直接書いてあるなら、環境変数に移す。
  - 既にどこかに公開してしまったものは、**鍵そのものを作り直す**こと。
    消しても履歴と他人の手元には残るため、消すだけでは戻せません。
""")
    return 1


if __name__ == "__main__":
    sys.exit(main())
