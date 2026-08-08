# NOW  updated: 2026-08-08 / by: session-optimization

## いま何をしているか

goal: 41セッション分の失敗を機械で防ぐ仕組みを入れる
branch: claude/session-optimization-points-hrr6fx
次の一手: このブランチを main にマージする。以後は autoflow が自動で回る
やらない: 既存ページの中身の書き換え・共通CSS化・desktop-cat の作り込み

## 直近の決定（最大5件。溢れたら DECISIONS.md へ）

- 2026-08-08 未マージ4ブランチ 6,394行を main へ統合 (D-0002)
- 2026-08-08 `.github/` `.claude/` `tools/` を触る変更は自動マージしない (D-0003)
- 2026-08-08 リモートでも hooks と skills が有効だと実測で確認 (D-0004)
- 2026-08-08 週次メンテナンスの Routine を作成（月 09:00 JST） (D-0005)
- 2026-08-08 自動マージは PR を経由せず main へ直接。保留は Issue で知らせる (D-0006)

## 待ち（due と default が無いものは書いてはいけない）

- item: index.html の外部リンク4本（YouTube / Blog / Indie Game Discovery / X）の URL が未確定。
    現在はコメントアウトして非表示にしている。
  due: 2026-09-08
  default: コメントごと削除する。URL が判明した時点で改めて1行足せばよい。

- item: research.html / research2.html の見出しが `サンプル調査タイトル` のままで、
    プレースホルダが公開されている。中身の要約は本人にしか書けない。
  due: 2026-09-08
  default: 見出しを本文1行目から機械的に生成して差し替える。

## 触るな

- CLAUDE.md の §0（憲法）
- `research.html`(59KB) / `research2.html`(114KB) は全文を読まない。grep して該当箇所だけ読む。
