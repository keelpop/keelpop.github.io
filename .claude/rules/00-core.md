# 適用中のルール

書式は機械が読む。`### R-000 見出し` に続けて `key: value` を並べる。
`status` は active / retired。`review` は賞味期限で、必ず入れる（無いと検査が落ちる）。
`check` が埋まっているものは機械が検査している = **文章としては役目を終えつつある**。
`after` が `baseline` を下回り、かつ `check` があるルールは、文章を消して機械だけ残す。

判定は `/rule-gardener` が週次で行う。ここを手で編集するのは、その手順の中だけ。

---

### R-001 未 push で終わらない
status: active
since: 2026-08-08
review: 2026-11-08
trigger: セッション終了時
rule: コミットを作ったら origin に push してからセッションを終える。コンテナは回収されるため、push していない作業は消える。
check: .github/workflows/nightly.yml（未 PR ブランチの回収）
evidence: INC-0001, INC-0002
baseline: 2/30d
after: -
hits: 2

### R-002 成果ブランチを放置しない
status: active
since: 2026-08-08
review: 2026-11-08
trigger: ブランチに push した後
rule: `claude/*` への push で PR が自動作成される。安全条件を満たすものは自動マージされるので、人が待つ必要はない。条件を満たさない場合だけ `needs-human` が付く。
check: .github/workflows/autoflow.yml
evidence: INC-0003
baseline: 4/150d
after: -
hits: 4

### R-003 待ちには必ず期限と既定動作を書く
status: active
since: 2026-08-08
review: 2026-11-08
trigger: ユーザーへの質問や確認で作業が止まるとき
rule: NOW.md の「待ち」に `due:` と `default:` を書く。期限が来たら無人セッションが `default:` を実行して待ちを消す。答えを待って止まったままにしない。
check: tools/check_site.py --rules
evidence: INC-0004, INC-0005
baseline: 2/30d
after: -
hits: 2

### R-004 1セッションに詰め込まない
status: active
since: 2026-08-08
review: 2026-11-08
trigger: 変更が5ファイルまたは300行を超えたとき
rule: そこで一度コミットして push し、残りを NOW.md の「次の一手」に書いて終える。1セッションで作り切ろうとすると、文脈の再読み込みだけで大量のトークンを消費する。
check: -
evidence: INC-0006
baseline: 1/30d
after: -
hits: 1

### R-005 巨大ファイルを全文で読まない
status: active
since: 2026-08-08
review: 2026-11-08
trigger: research.html / research2.html を参照するとき
rule: grep して該当箇所だけを読む。この2ファイルは合計 173KB あり、全読みするだけで数万トークンを消費する。
check: -
evidence: INC-0006
baseline: -
after: -
hits: 0

### R-006 コミットメッセージは変更内容を述べる
status: active
since: 2026-08-08
review: 2026-11-08
trigger: コミットするとき
rule: 変更したファイルと、何をなぜ変えたかを書く。テンプレートの残骸や、内容と無関係な文言を残さない。
check: -
evidence: INC-0007
baseline: 1/30d
after: -
hits: 1
