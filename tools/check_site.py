#!/usr/bin/env python3
"""サイトとルール系の健全性チェック。標準ライブラリのみ。

    python3 tools/check_site.py            # 全部見る
    python3 tools/check_site.py --site     # HTML だけ
    python3 tools/check_site.py --rules    # ルール系だけ

ERROR が1件でもあれば exit 1（CI が赤くなる / 自動マージが止まる）。
WARN は exit 0。直す価値はあるが、公開を止めるほどではないもの。
"""

import argparse
import json
import os
import re
import sys
from datetime import date, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# サイトとして公開されない領域。ここの HTML は site チェックの対象外。
NOT_THE_SITE = ("desktop-cat/", ".git/", "node_modules/")

# ルール系の定員。増え続ける仕組みにしないための上限。
MAX_CLAUDE_MD_LINES = 120
MAX_ACTIVE_RULES = 20
MAX_NOW_BYTES = 2048

problems = []  # (level, path, message)


def err(path, msg):
    problems.append(("ERROR", path, msg))


def warn(path, msg):
    problems.append(("WARN", path, msg))


def rel(p):
    return os.path.relpath(p, ROOT).replace(os.sep, "/")


def site_html_files():
    out = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in (".git", "node_modules")]
        for name in filenames:
            if not name.endswith(".html"):
                continue
            path = rel(os.path.join(dirpath, name))
            if any(path.startswith(p) for p in NOT_THE_SITE):
                continue
            out.append(path)
    return sorted(out)


def strip_noise(html):
    """コメントと <script>/<style> の中身を落とす。

    コメントアウトされたリンクを「死にリンク」と誤検知しないため、
    また JS のテンプレートリテラル（href="${...}"）を実在チェックに
    かけないため。実際にこれで誤検知が1件出たので入れてある。
    """
    html = re.sub(r"<!--.*?-->", "", html, flags=re.S)
    html = re.sub(r"<script\b.*?</script>", "", html, flags=re.S | re.I)
    html = re.sub(r"<style\b.*?</style>", "", html, flags=re.S | re.I)
    return html


def local_refs(html, from_path):
    """同じリポジトリ内を指す href/src を (元の値, 解決後のパス) で返す。"""
    for ref in re.findall(r'(?:href|src)\s*=\s*"([^"]*)"', html):
        raw = ref.strip()
        if not raw or raw.startswith(("http://", "https://", "//", "#", "mailto:", "tel:", "data:", "javascript:")):
            continue
        if "${" in raw or "{{" in raw:  # テンプレート。実行時にしか決まらない
            continue
        target = raw.split("#")[0].split("?")[0]
        if not target:
            continue
        yield raw, os.path.normpath(os.path.join(os.path.dirname(from_path), target))


def check_site():
    files = site_html_files()
    if "index.html" not in files:
        err("index.html", "トップページが無い")
        return

    titles = {}
    for path in files:
        raw = open(os.path.join(ROOT, path), encoding="utf-8", errors="replace").read()
        html = strip_noise(raw)

        if not re.search(r'<meta[^>]+name\s*=\s*"viewport"', raw, re.I):
            err(path, 'スマホで崩れる: <meta name="viewport"> が無い')
        if not re.search(r"<html[^>]+lang\s*=", raw, re.I):
            warn(path, "<html> に lang 属性が無い")

        m = re.search(r"<title>(.*?)</title>", raw, re.S | re.I)
        if not m or not m.group(1).strip():
            err(path, "<title> が無い、または空")
        else:
            titles.setdefault(m.group(1).strip(), []).append(path)

        if not re.search(r'<meta[^>]+name\s*=\s*"description"', raw, re.I):
            warn(path, '<meta name="description"> が無い')

        for bad in re.findall(r'href\s*=\s*"(#|)"', html):
            err(path, 'href="%s" の行き先の無いリンクが公開されている' % bad)

        for raw_ref, target in local_refs(html, path):
            if not os.path.exists(os.path.join(ROOT, target)):
                err(path, "リンク切れ: %s" % raw_ref)

    for title, paths in titles.items():
        if len(paths) > 1:
            warn(paths[1], "<title> が %s と重複: %r" % (paths[0], title))

    # index.html から辿り着けないページ。作ったのに誰も行けない状態を防ぐ。
    seen, queue = {"index.html"}, ["index.html"]
    while queue:
        cur = queue.pop()
        html = strip_noise(open(os.path.join(ROOT, cur), encoding="utf-8", errors="replace").read())
        for _, target in local_refs(html, cur):
            if target.endswith(".html") and target not in seen and os.path.exists(os.path.join(ROOT, target)):
                seen.add(target)
                queue.append(target)
    for path in files:
        if path not in seen:
            err(path, "どこからもリンクされておらず到達できない（index.html にリンクを足すこと）")


def parse_rules(text):
    """### R-001 見出し + key: value 形式のルールを読む。"""
    rules = []
    for block in re.split(r"^###\s+", text, flags=re.M)[1:]:
        lines = block.splitlines()
        rule = {"id": lines[0].split()[0] if lines[0].split() else "?", "title": lines[0]}
        for line in lines[1:]:
            m = re.match(r"^(status|since|review|trigger|check|hits|rule)\s*:\s*(.*)$", line.strip())
            if m:
                rule[m.group(1)] = m.group(2).strip()
        rules.append(rule)
    return rules


def check_rules():
    claude_md = os.path.join(ROOT, "CLAUDE.md")
    if os.path.exists(claude_md):
        text = open(claude_md, encoding="utf-8").read()
        n = len(text.splitlines())
        if n > MAX_CLAUDE_MD_LINES:
            err("CLAUDE.md", "%d 行。上限 %d を超えた。ルールを1件退役させてから追加すること"
                % (n, MAX_CLAUDE_MD_LINES))
        if "## §0" not in text:
            err("CLAUDE.md", "§0（憲法）の見出しが消えている")
    else:
        err("CLAUDE.md", "存在しない。全セッションが規約を読めない状態")

    core = os.path.join(ROOT, ".claude/rules/00-core.md")
    if os.path.exists(core):
        rules = parse_rules(open(core, encoding="utf-8").read())
        active = [r for r in rules if r.get("status") == "active"]
        if len(active) > MAX_ACTIVE_RULES:
            err(".claude/rules/00-core.md",
                "active ルールが %d 件。上限 %d。最も hits の少ないものを退役させること"
                % (len(active), MAX_ACTIVE_RULES))

        today = date.today()
        for r in active:
            if r.get("review"):
                try:
                    if datetime.strptime(r["review"], "%Y-%m-%d").date() < today:
                        warn(".claude/rules/00-core.md",
                             "%s は賞味期限切れ（review: %s）。効果を判定して延長か退役を決めること"
                             % (r["id"], r["review"]))
                except ValueError:
                    err(".claude/rules/00-core.md", "%s の review 日付が読めない: %r" % (r["id"], r["review"]))
            else:
                err(".claude/rules/00-core.md", "%s に review（賞味期限）が無い。期限の無いルールは腐る" % r["id"])

        by_trigger = {}
        for r in active:
            if r.get("trigger"):
                by_trigger.setdefault(r["trigger"], []).append(r["id"])
        for trigger, ids in by_trigger.items():
            if len(ids) > 1:
                warn(".claude/rules/00-core.md",
                     "同じ場面 %r に複数のルール（%s）。矛盾していないか確認し、統合すること"
                     % (trigger, ", ".join(ids)))

    now = os.path.join(ROOT, ".claude/state/NOW.md")
    if os.path.exists(now):
        raw = open(now, "rb").read()
        if len(raw) > MAX_NOW_BYTES:
            err(".claude/state/NOW.md",
                "%d バイト。上限 %d。古い内容を DECISIONS.md へ押し出すこと" % (len(raw), MAX_NOW_BYTES))
        text = raw.decode("utf-8", errors="replace")
        for section in ("## いま何をしているか", "## 待ち"):
            if section not in text:
                err(".claude/state/NOW.md", "%s の節が無い" % section)
        # 期限も既定動作も無い「待ち」は、放置されて14日腐る。構造で禁止する。
        for block in re.split(r"^- item:", text, flags=re.M)[1:]:
            head = block.strip().splitlines()[0].strip()
            if "due:" not in block:
                err(".claude/state/NOW.md", "待ち %r に due（期限）が無い" % head)
            if "default:" not in block:
                err(".claude/state/NOW.md", "待ち %r に default（期限が来たら何をするか）が無い" % head)
    else:
        err(".claude/state/NOW.md", "存在しない。次のセッションが文脈をゼロから作り直すことになる")

    inc = os.path.join(ROOT, ".claude/state/INCIDENTS.jsonl")
    if os.path.exists(inc):
        for i, line in enumerate(open(inc, encoding="utf-8"), 1):
            if line.strip():
                try:
                    json.loads(line)
                except json.JSONDecodeError as e:
                    err(".claude/state/INCIDENTS.jsonl", "%d 行目が JSON として壊れている: %s" % (i, e))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--site", action="store_true")
    ap.add_argument("--rules", action="store_true")
    args = ap.parse_args()
    run_all = not (args.site or args.rules)

    if run_all or args.site:
        check_site()
    if run_all or args.rules:
        check_rules()

    errors = [p for p in problems if p[0] == "ERROR"]
    warns = [p for p in problems if p[0] == "WARN"]
    for level, path, msg in errors + warns:
        print("%-5s %s: %s" % (level, path, msg))
    print("\nERROR %d / WARN %d" % (len(errors), len(warns)))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
