# しずく

開いた画面からメモを追加できる、モバイル向けのタスク管理Webアプリです。

- クイックメモはログイン前も使えます。下書きと未ログイン時のタスクは、このブラウザのストレージに保存します。
- 左フリックで「未着手 → 進行中 → 完了」、右フリックで一段階戻します。行のステータスボタンと編集ダイアログでも変更できます。
- Googleでログインした状態のタスクはCloudflare D1に保存します。「この端末のタスクを取り込む」で、ログイン前に書いたタスクも同期できます。
- ログイン後に「AIで分ける」を押したとき、メモをCloudflare Workers AIに送信します。候補を確認し、「すべて追加」を押すとタスクになります。

## 技術選定

| 技術 | 採用理由 |
| --- | --- |
| HTML / CSS / JavaScript | 入力欄とスケルトンを初期HTMLに含め、JavaScriptや通信の完了を待たずに入力欄を出せます。画面が一つのため、フレームワークや画面遷移ライブラリを追加せずに実装できます。 |
| CSSの半透明レイヤー、背景ぼかし、トランジション | 白を基調にガラス面の重なりを出せます。フリックの追従、追加やダイアログの動き、スケルトンのシマーを実装し、動きを減らすOS設定も尊重します。 |
| Pointer Events / ネイティブダイアログ | タッチとマウスを同じコードで扱い、縦スクロールを維持できます。ダイアログのフォーカス管理とEscape操作はブラウザの機能を利用します。 |
| localStorage | 下書きとゲストのタスクを即時保存でき、再読み込み後も復元できます。 |
| Cloudflare Workers / Static Assets | 静的画面とAPIを同じオリジンで配信し、Cookieを使う認証とAPIを一つのデプロイにまとめられます。 |
| Cloudflare D1 / SQL | アカウントごとのタスクとログインセッションを構造化して保存できます。複数タスクの保存をバッチ処理し、再送した取り込みで同じタスクを重複登録しません。 |
| Google OpenID Connect / jose / Web Crypto | Googleの認証結果からアカウントを識別します。PKCEとnonceを使い、Googleの公開鍵でIDトークンを検証します。アプリのセッショントークンはハッシュで保存し、ログアウト時に失効させます。 |
| Workers AI / Llama 3.1 8B Instruct Fast | 短いメモからのタスク抽出をWorkerのバインディング経由で行えます。構造化レスポンスの指定に対応し、実際の出力はAPI側でも検証します。 |
| Node.js / npm / Wrangler | 開発環境と依存関係を再現でき、Workersのローカル起動、D1マイグレーション、デプロイを同じCLIで扱えます。 |
| Playwright / Node標準テスト / SQLite | Chromeとスマホ相当のタッチ操作をテストできます。サーバーテストではSQLを実際に実行し、AIの応答は固定して分岐を検証できます。 |

## ローカル開発

Node.js 24 LTSを推奨します。

```sh
npm ci
npm run db:local
npm run dev
```

[http://localhost:8787](http://localhost:8787) を開きます。デフォルトのローカル起動では遠隔バインディングを無効にします。
ローカルでGoogle認証を試す場合は、`.dev.vars.example` を `.dev.vars` にコピーしてOAuthクライアントを設定し、承認済みリダイレクトURIに `http://localhost:8787/auth/google/callback` を登録します。

## テスト

```sh
npm test
npx playwright install chromium
npm run test:browser
```

既存のGoogle Chromeを使う場合は `SHIZUKU_TEST_CHANNEL=chrome` を設定します。ブラウザテストはデスクトップとPixel 7相当の2設定で実行し、モバイル側ではChromiumのタッチ入力を使います。Googleのアカウント選択からログイン完了までと、Workers AIの実際の応答は、認証を設定したデプロイ先で確認します。

## Cloudflareへ公開

1. Cloudflareのアカウントに `npx wrangler login` でログインします。
2. `npx wrangler d1 create shizuku-tasks` でD1を作り、`wrangler.jsonc` の `database_id` を返されたUUIDに更新します。
3. `npx wrangler d1 migrations apply DB --remote` を実行し、`npm run deploy` で公開URLを取得します。AIバインディングは設定済みです。
4. Google CloudでOAuth同意画面と「ウェブ アプリケーション」のOAuthクライアントを設定します。承認済みリダイレクトURIは `https://<公開先ホスト>/auth/google/callback` です。公開対象にあわせてGoogle側の公開ステータスも設定します。
5. クライアントIDとシークレットを `npx wrangler secret put GOOGLE_CLIENT_ID` と `npx wrangler secret put GOOGLE_CLIENT_SECRET` で設定します。カスタムドメインを使う場合はGoogle側のリダイレクトURIと `PUBLIC_ORIGIN` を同じ公開オリジンにそろえます。
6. 公開URLでゲスト入力、Googleログイン、リロード後のD1保存、AI分割と候補の保存を確認します。

[Cloudflare Workers](https://developers.cloudflare.com/workers/) · [D1](https://developers.cloudflare.com/d1/) · [Workers AI](https://developers.cloudflare.com/workers-ai/) · [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)
