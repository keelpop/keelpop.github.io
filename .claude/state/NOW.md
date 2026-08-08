# NOW  updated: 2026-08-08 / by: session-optimization

## いま何をしているか

goal: 41セッション分の失敗を機械で防ぐ仕組みを入れる
branch: claude/session-optimization-points-hrr6fx
次の一手: 持ち主が GitHub の画面でこのブランチを main にマージする。
    それまで仕組みは動かない（main に tools/ も .github/ も無い）。
やらない: 既存ページの中身の書き換え・共通CSS化・desktop-cat の作り込み

## 直近の決定（最大5件。溢れたら DECISIONS.md へ）

- 2026-08-08 未マージ4ブランチ 6,394行を main へ統合 (D-0002)
- 2026-08-08 ルールと状態は機械が更新可、それを強制する仕組みは触らせない (D-0003)
- 2026-08-08 リモートでも hooks と skills が有効だと実測で確認 (D-0004)
- 2026-08-08 週次メンテナンスの Routine を作成（月 09:00 JST） (D-0005)
- 2026-08-08 自動マージは PR を経由せず main へ直接。保留は Issue (D-0006)

## 待ち（due と default が無いものは書いてはいけない）

- item: index.html の外部リンク4本（YouTube / Blog / Indie Game / X）の URL が未確定。
  due: 2026-09-08
  default: コメントごと削除する。URL が判明したら改めて1行足せばよい。

- item: research.html / research2.html の見出しが `サンプル調査タイトル` のまま。
  due: 2026-09-08
  default: sed で見出しだけ差し替える。research は `調査メモ 1` `調査メモ 2`、
      research2 は `Antigravity 導入メモ 1` `2`。この2つは全文を読まない（R-005）。

## 触るな

- CLAUDE.md の §0（憲法）
- `research.html`(59KB) / `research2.html`(114KB) は grep して該当箇所だけ読む。
