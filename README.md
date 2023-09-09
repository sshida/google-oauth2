# google-oauth2
Google AccountでOAuth2で認証し、access_tokenとOIDCtokenを得る

# 参照資料
- [Google での認証](https://cloud.google.com/docs/authentication?hl=ja)
  - 用途に応じた認証方法を選定する手順がありわかりやすい
- [OAuth 2.0 を使用した Google API へのアクセス](https://developers.google.com/identity/protocols/oauth2?hl=ja)
  - OAuth2の認証とtoken受け取りのシーケンス図がありわかりやすい
  - 用途に応じたOAuth2 flowを選択できる
- [google-api-javascript-client](https://github.com/google/google-api-javascript-client)
  - 圧縮されたapi.jsは18KBで小さいがその後のHTTPリクエストをすべてgapi.clientの専用APIに書き換えなければならない
  - 内容を確認できるコードが見当たらなかった。配布されている圧縮版のapi.jsは検証しにくい
- [google cloud console → APIとサービス → 認証情報](https://console.cloud.google.com/apis/credentials?hl=ja)
  - 準備では認証情報としてOAuth2.0 Client IDを用意する
