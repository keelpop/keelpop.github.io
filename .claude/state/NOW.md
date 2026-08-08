# NOW  updated: 2026-08-08 / by: followup-site-quality

## いま何をしているか

goal: 仕組みを main で実際に回し、残っていた品質の穴を塞ぐ
branch: claude/followup-site-quality-and-sweep
次の一手: このブランチが自動マージされることを確認する。
    これが通れば「普通のページ追加は人が触らなくても公開される」が実証される。
やらない: 既存ページの本文の書き換え・共通CSS化・desktop-cat の作り込み

## 直近の決定（最大5件。溢れたら DECISIONS.md へ）

- 2026-08-08 未マージ4ブランチ 6,394行を main へ統合 (D-0002)
- 2026-08-08 ルールと状態は機械が更新可、それを強制する仕組みは触らせない (D-0003)
- 2026-08-08 自動マージは PR を経由せず main へ直接。保留は Issue (D-0006)
- 2026-08-08 仕組み一式を main にマージ。ここから自動処理が実際に動く (D-0007)
- 2026-08-08 外部スクリプトは WARN 止まり。translator の tesseract.js は正当な依存 (D-0008)

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
