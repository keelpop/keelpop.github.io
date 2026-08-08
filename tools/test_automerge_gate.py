#!/usr/bin/env python3
"""automerge_gate.py の通す/止めるが崩れていないかを確かめる。

ここが崩れると起きることは2つ。どちらも静かに進行する。
  - 保護が緩む → 機械が自分を縛る仕組みを自分で書き換えて main に流せる
  - 保護が固すぎる → 週次の棚卸しの成果が永久にマージされず、Issue だけ溜まる

後者は実際に一度作り込んだ（`.claude/**` を丸ごと止めていた）。
"""

import fnmatch
import importlib.util
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location("gate", os.path.join(ROOT, "tools/automerge_gate.py"))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


def verdict(path):
    if any(fnmatch.fnmatch(path, p) for p in gate.SELF_UPDATABLE):
        return "self"
    if any(fnmatch.fnmatch(path, p) for p in gate.DENY):
        return "deny"
    if not any(fnmatch.fnmatch(path, p) for p in gate.ALLOW):
        return "deny"
    return "allow"


CASES = [
    # 週次の棚卸しが書き換える場所。止めると自己更新ループが死ぬ。
    (".claude/rules/00-core.md", "self"),
    (".claude/state/NOW.md", "self"),
    (".claude/state/INCIDENTS.jsonl", "self"),
    (".claude/state/DECISIONS.md", "self"),
    # ルールを強制する仕組みそのもの。通すと檻の鍵を機械が持つ。
    (".claude/settings.json", "deny"),
    (".claude/skills/finish-session/SKILL.md", "deny"),
    (".claude/skills/rule-gardener/SKILL.md", "deny"),
    ("tools/check_site.py", "deny"),
    ("tools/automerge_gate.py", "deny"),
    ("tools/session_start.sh", "deny"),
    (".github/workflows/autoflow.yml", "deny"),
    (".github/workflows/site-check.yml", "deny"),
    ("CLAUDE.md", "deny"),
    ("CNAME", "deny"),
    (".gitignore", "deny"),
    ("desktop-cat/package.json", "deny"),
    ("desktop-cat/package-lock.json", "deny"),
    # 普通のページ追加。ここが止まると何も公開できなくなる。
    ("new-page.html", "allow"),
    ("suno/index.html", "allow"),
    ("suno/songs.json", "allow"),
    ("assets/img/cat.png", "allow"),
    ("README.md", "allow"),
]


def main():
    bad = []
    for path, want in CASES:
        got = verdict(path)
        if got != want:
            bad.append("  %s: 期待=%s 実際=%s" % (path, want, got))
    if bad:
        print("automerge_gate の判定が変わっています:")
        print("\n".join(bad))
        return 1
    print("automerge_gate: %d 件すべて期待どおり" % len(CASES))
    return 0


if __name__ == "__main__":
    sys.exit(main())
