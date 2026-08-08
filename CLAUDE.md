<!-- 120行上限。tools/check_site.py --rules が強制する。
     ここは「守らせる場所」ではなく「機械が何をするかの説明書」。
     新しい規範は .claude/rules/00-core.md に書き、機械化できたら文章は消すこと。 -->

# keelpop.github.io

素の HTML で書かれた個人サイト。ビルドツール・npm・フレームワークは無い。
**main への push がそのまま公開される**（GitHub Pages、プレビュー環境なし）。

## §0 憲法（自動更新禁止。ここを変更する PR は自動マージされない）

1. ビルドツール・npm・フレームワークを導入しない。素の HTML を保つ。
2. **1セッション = 1成果物 = 1ブランチ。** 変更が5ファイルまたは300行を超えたら、
   そこで一度コミットして push する。残りは NOW.md の「次の一手」に書いて終える。
3. **無人セッション（Routine が起動したもの）はユーザーに質問してはならない。**
   判断できないときは、その手順に書かれた `default:` を実行する。
   `default:` が無い事態なら、何もせず INCIDENTS.jsonl に記録して終える。
4. **作業したら必ず push してから終わる。** 未 push で終わらない。
   コンテナは回収される。push していないものは存在しないのと同じ。
5. **NOW.md を更新せずにセッションを終えない。**
6. 「待ち」を作るときは、必ず `due:`（期限）と `default:`（期限が来たら何をするか）を書く。
   これが無い待ちは14日放置される。実際に2件そうなった。
7. ルールを1件足すなら、必ず1件退役させる。active は20件・この CLAUDE.md は120行が上限。
8. 秘密情報・個人情報・APIキーをリポジトリに書かない。

## §1 地図（毎回ここから読む）

| 知りたいこと | 見る場所 |
|---|---|
| いま何をしているか・次の一手 | @.claude/state/NOW.md |
| 適用中のルール | @.claude/rules/00-core.md |
| 過去の決定とその理由 | `.claude/state/DECISIONS.md`（grep して該当箇所だけ読む） |
| 失敗の記録（ルールの原材料） | `.claude/state/INCIDENTS.jsonl` |
| セッションの締め方 | `/finish-session` |

## §2 このリポジトリの事実

- `research.html`(59KB) と `research2.html`(114KB) は巨大。**全文を読まず grep すること。**
  この2つを全読みするだけで数万トークン消える。
- `desktop-cat/` は Electron アプリ。サイトの一部ではないので品質検査の対象外。
- ページは1ファイル完結。共通 CSS ファイルは作らない。
- リンクを増やすときは `index.html` の `LINKS:END` コメントのすぐ上に1行追記する。

## §3 機械が勝手にやること（あなたが気にする必要はない）

- `tools/check_site.py` がリンク切れ・viewport 欠落・孤立ページ・title 重複を検出する。
  GitHub Actions が push のたびに実行し、ERROR があればマージを止める。
- `claude/*` ブランチへの push で PR が自動作成され、安全条件を満たせば自動マージされる。
- 毎日の自動メンテナンスが、放置ブランチの回収と期限切れの `default:` 実行を行う。

## §4 検査に落ちたときの直し方

| 出たメッセージ | すること |
|---|---|
| `<meta name="viewport"> が無い` | `<head>` に `<meta name="viewport" content="width=device-width, initial-scale=1.0">` |
| `href="#" の行き先の無いリンク` | 実 URL に置き換えるか、その `<a>` 行ごと消す（コメントアウト退避も可） |
| `どこからもリンクされておらず到達できない` | `index.html` の `LINKS:END` の上にリンクを1行足す |
| `<title> が重複` | ページ内容を表す固有の title に変える |
| `待ち … に due が無い` | NOW.md のその待ちに `due:` と `default:` を書く |
| `active ルールが上限超過` | `.claude/rules/00-core.md` で最も `hits` の少ないルールを退役させる |

## §5 やってはいけないこと

- `main` に直接コミット・push しない。`claude/*` ブランチを使う。
- `git push --force`（`--force-with-lease` は可）。
- `.github/` `.claude/` `tools/` を「ついでに」変更しない。
  ここを変える PR は自動マージされず、必ず人間の目に触れる。これは意図的な設計。
