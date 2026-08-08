# 適用中のルール

書式は機械が読む。`### R-000 見出し` に続けて `key: value` を並べる。
`status` は active / retired。`review` は賞味期限で、必ず入れる（無いと検査が落ちる）。
`check` が埋まっているものは機械が検査している = **文章としては役目を終えつつある**。
`after` が `baseline` を下回り、かつ `check` があるルールは、文章を消して機械だけ残す。

判定は `/rule-gardener` が週次で行う。ここを手で編集するのは、その手順の中だけ。

**最初から多く書かないこと。** ルールは、実際に起きた失敗（INCIDENTS.jsonl）からしか
生やさない。想像で書いたルールは守られず、本当に必要なルールを埋もれさせる。

---

### R-001 未 push で終わらない
status: active
since: __DATE__
review: __REVIEW__
trigger: セッション終了時
rule: コミットを作ったら origin に push してからセッションを終える。push していない作業は消えることがある。
check: -
evidence: -
baseline: -
after: -
hits: 0

### R-002 待ちには必ず期限と既定動作を書く
status: active
since: __DATE__
review: __REVIEW__
trigger: ユーザーへの質問や確認で作業が止まるとき
rule: NOW.md の「待ち」に `due:` と `default:` を書く。期限が来たら無人セッションが `default:` を実行して待ちを消す。答えを待って止まったままにしない。
check: tools/check_site.py --rules
evidence: -
baseline: -
after: -
hits: 0

### R-003 1セッションに詰め込まない
status: active
since: __DATE__
review: __REVIEW__
trigger: 変更が5ファイルまたは300行を超えたとき
rule: そこで一度コミットして push し、残りを NOW.md の「次の一手」に書いて終える。1セッションで作り切ろうとすると、文脈の再読み込みだけで大量のトークンを消費する。
check: -
evidence: -
baseline: -
after: -
hits: 0
