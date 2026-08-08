# NOW  updated: 2026-08-08 / by: session-optimization

## いま何をしているか

goal: 仕組みが main で実働している状態を保つ
branch: なし。次の作業から `claude/*` を切って始める。
次の一手: 無い。やりたいことが決まったらここに1行書いて始める。
やらない: 既存ページの本文の書き換え・共通CSS化・desktop-cat の作り込み

## 直近の決定（最大5件。溢れたら DECISIONS.md へ）

- 2026-08-08 仕組み一式を main にマージ。自動処理が実働 (D-0007)
- 2026-08-08 .js と入れ子 assets も自動マージ可 (D-0009)
- 2026-08-08 仕組みを他リポジトリへ持ち出せるようにした (D-0010)
- 2026-08-08 秘密の検査を push 毎に走らせる。上げたら取り消せないため (D-0011)
- 2026-08-08 深淵書架を keelpop/shinen（非公開）へ移した。296MB (D-0013)

## 待ち（due と default が無いものは書いてはいけない）

- item: `claude/scan-progress` は内容が v2 で main に入った古いブランチ。
    このコンテナからは削除できなかった。放置すると夜間掃除が毎晩衝突する。
  due: 2026-08-15
  default: GitHub の画面で削除する。中身は main にあるので何も失われない。

- item: index.html の外部リンク4本（YouTube / Blog / Indie Game / X）の URL が未確定。
  due: 2026-09-08
  default: コメントごと削除する。URL が判明したら改めて1行足せばよい。

- item: research.html / research2.html の見出しが `サンプル調査タイトル` のまま。
  due: 2026-09-08
  default: sed で見出しだけ差し替える。全文は読まない（R-005）。

## 触るな

- CLAUDE.md の §0（憲法）
- `research.html`(59KB) / `research2.html`(114KB) は grep して該当箇所だけ読む。
- `tools/` は仕組み専用。サイト用の生成スクリプトは `scripts/` に置く。
