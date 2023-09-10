// vi: sts=2 sw=2

// Google AccountでOAuth2で認証し、access_tokenとOIDCtokenを得る
//
// OAuth2またはOIDC clientはいくつかあるが使わない機能があり大きい。
// 汚染されていないかコードを確認する必要があるが大きいため確認しにくい。
// よくあるmoduleはJWT moduleだけで数MB以上あり大きい。
// このmoduleではJWT処理は10行程度。
// oidc-client-tsは4MBで小さい方だがmin.jsで0.067MBあった。
// auth.jsはカッコいいがNext, Svelte等が必要でserverも合わせなければならない。
// auth.jsはまだexperimentalとのこと(2023-06)
// auth.jsはnpm installすると377MB、40 moduleがあり話にならない。react, cssもあった
// このmoduleは0.016MBだった: 2023-09
//
// moduleの利用方法
// import {googleOAuth2} from "./google-oauth2.mjs"
//
// 主な機能
// - Authorization code flow with PKCEでOAuth2認証する
// - 応答のnonceを照合する
// - PKCEを使って応答を検証する
// - googleの場合、tokenの有効期限は1時間だった, 2023-09
// - 取得したtokenをブラウザ内のsessionStorageに格納して再利用する
// - ブラウザを閉じるとsessionStorageの内容は消えてtokenを取得し直す
// - google認証時に「この端末では認証を省略する」とすれば認証ページは表示されなくなる
// - sessionStorageのtokenを削除する関数あり
//
// このmoduleの問題
// - 認証ページへのリダイレクトのみ。認証用の別ウィンドウは使えない
// - User情報の取り出しがない
// - 複数のIdPを同時に利用できない。1種類のみ
// - 権限が狭すぎると、他のブラウザタブに影響しているようだった。閉じると復帰する
//
// 主な履歴
// - 2022-06 最初の実装
// - 2023-09 debug出力を抑制した

/*
  利用準備: OAuth2 ID Providerを設定する

  google developer consoleでOAuth 2.0 Client IDを設定する

  APIとサービス → APIとサービスの有効化
  https://console.cloud.google.com/apis/dashboard?hl=ja&project=sdd-line-to-spreadsheet
  - Google Cloudでprojectを作り、アプリケーションとして必要なGoogle APIがあれば有効にする
  - 他のGoogle APIは使わず、Google OAuth2 認証だけであれば何も追加しなくてよい

  OAuth同意画面
  https://console.cloud.google.com/apis/credentials/consent?hl=ja&project=sdd-line-to-spreadsheet
  - タイプは`web application`を選ぶ
  - スコープは userinfo.email, userinfo.profile, openid と、アプリに必要なGoogle APIを選ぶ
    - 例: drive.readonly など
  - テスト中は「テストユーザー」を指定しないとgoogle認証時に 403 error になる

  認証情報 → 認証情報を作成
  https://console.cloud.google.com/apis/credentials?hl=ja&project=sdd-line-to-spreadsheet
  - 承認済みのJavaScript生成元: https://dev.sshida.com:8888
  - 承認済みのリダイレクトURI1: https://dev.sshida.com:8888/auth.html
  - 承認済みのリダイレクトURI2: https://dev.sshida.com:8888/

  認証情報 → ウェブ アプリケーションのクライアント ID 
  - ページ右側の"Additional Information"の「⬇」でJSONをダウンロードする
*/

/*
  参照資料: Google Drive API scope: 権限の指定方法
  https://developers.google.com/drive/api/guides/api-specific-auth?hl=ja
*/

/*
  処理中のtokenの保存先
  tokenの保存先は`localStorage`ではなく `sessionStorage`にした。
  google identityのaccess_tokenとid_tokenは1時間の期限付きのため、
  `sessionStorage` に保存したとしても1時間で使えなくなる。
  sessionStorageだとブラウザを閉じたときに消える。開いたままだと1時間有効。

  2022-10現在、クライアント側で3rd partyのJavaScriptは使っていない。
  このためsessionStorageだとしてもXSSの被害を受けにくくtoken情報が漏洩しにくい。

  保存内容:
  access_token, id_tokenを含む。
  refresh_tokenは取得していないため保存もしない

  MQTT稼働状況の表示については、一度に複数のタブをひらく分にはsessonStorageで問題ない。
  2022-10, 2023-09現在、google identity APIでOAuth2.0認証をしたあとは、確認ページは表示されなかった。
  OAuth2.0の同意ページが表示されるのは、client_secretを変えるか、scopeを変えたときだけだった。

  動作確認
  - macOS 13.5.2, google chrome 116, 
  - macOS 13.5.2, apple safari 16.6

  参考資料: HTML5のLocal Storageを使ってはいけない（翻訳）
  https://techracho.bpsinc.jp/hachi8833/2019_10_09/80851
  - このページにはOAuth2 tokenのJWTに期限があることは書かれていなかった
  - このページには3rd party JSを使わないときの脆弱性が書かれていなかった
*/

// 注意: codeは1分ほどで無効になるため、テストはcode取得から実行すること
// {
//  "error": "invalid_grant",
//  "error_description": "Bad Request"
// }
//
// 注意: fetch()受信時はまずbodyも受信してからokフラグを確認する
// 注意: generateCodeChallenge()はasyncなのでawaitする。code_challengeがnullになる
// 注意: btoa()はArrayBufferを与えても処理できない。「バイナリ文字列」にする

/*
   OAuth 2.0 for Mobile & Desktop Apps
   Authorization code flow with PKCEでOAuth2認証する
   https://developers.google.com/identity/protocols/oauth2/native-app#custom-uri-scheme

   tokenを要求する成功例, 2022-10-16 ※codeは1分ほどで無効になる(document?)
   {
     client_id: "840349684996-1ie6atcsuf76t0ouic5hmpaqhqjhcksq.apps.googleusercontent.com"
     client_secret: "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"
     code: "4/0ARtbsJr1YxFP6yJF03nOrVgkwSMBNv0g_C29WJDN4riU99Mvmn02lGlvVixSc33xgKbyLw"
     code_verifier: "97433d3217b0abd8646cbeee230ea25c72adb49712c53f7d8b45c9016e0fa1c5"
     grant_type: "authorization_code"
     redirect_uri: "https://dev.sshida.com:8888/auth.html" 
   }

   tokenを受信した例, 2022-10-16 ※有効期限は1時間。id_tokenは2 KBほどあり途中を略してある
   ※ scopeのURLは自動的に展開されていた
   {
     expires_in: 3599
     id_token: "eyJhbGciOiJSUzI1NiIsImtpZ...1KggwMtt09Q"
     scope: "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile"
     token_type: "Bearer"
   }

   そのid_tokenを展開した例, 2022-10-16 ※emailと、nameなどprofileが含まれている
   {
     at_hash: "q8M3VpLwiM9E4_TLbX3g_Q"
     aud: "840349684996-1ie6atcsuf76t0ouic5hmpaqhqjhcksq.apps.googleusercontent.com"
     azp: "840349684996-1ie6atcsuf76t0ouic5hmpaqhqjhcksq.apps.googleusercontent.com"
     email: "sshida@gmail.com"
     email_verified: true
     exp: 1665924263
     family_name: "Shida"
     given_name: "Satoshi"
     iat: 1665920663
     iss: "https://accounts.google.com"
     locale: "ja"
     name: "Satoshi Shida"
     nonce: "nonce-8667d5588e4c6d0226cc9777321124e ... 5ce38e7c076a50"
     picture: "https://lh3.googleusercontent.com/a/AL...WPaBIe5s96c"
     sub: "113202346692217960179"
   }
 */

// モジュールはJS classを使わず関数だけで構成する。
// Replacing JavaScript Classes With The Module Design Pattern, 2021
// https://dev.to/bytebodger/replacing-javascript-classes-with-the-module-design-pattern-48bl
export function googleOAuth2(params) {
  const grant_type = "authorization_code" // + with PKCE
  let state = null
  let code_verifier = null
  let nonce = null
  let tokens = null

  let debug = 1

  const {
    client_id, client_secret, scope, redirect_uri,
    auth_uri = `https://accounts.google.com/o/oauth2/v2/auth`,
    token_uri = `https://oauth2.googleapis.com/token`,
  } = params
  if(debug) console.debug(`params:`, params)

  // JavaScriptの文字列の内部表現は16 bit Unicode
  // https://developer.mozilla.org/en-US/docs/Web/API/btoa#unicode_strings
  const base64EncodeFromArrayBuffer = arrayBuffer =>
    btoa([... new Uint8Array(arrayBuffer)].map(v => String.fromCharCode(v)).join(''))

  const sha256Base64UrlFromString = async string => {
    const utf8 = new TextEncoder().encode(string)
    const hashBuffer = await crypto.subtle.digest('SHA-256', utf8)
    return base64EncodeFromArrayBuffer(hashBuffer)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "")
  }

  const getRandomStringAsHex = (charLength = 96 /* int8 */) /*: string */ => 
    [... crypto.getRandomValues(new Uint8Array(charLength / 2))]
    .map(v => v.toString(16).padStart(2, '0'))
    .join('')

  const generateCodeVerifer = () => {
    sessionStorage.removeItem('oauth2CodeVerifier')
    code_verifier = getRandomStringAsHex(64 /* chars */)
    sessionStorage.setItem('oauth2CodeVerifier', code_verifier)
    if(debug) console.debug(`create code_verifier:`, code_verifier)
    return code_verifier 
  }
  const generateCodeChallenge = async () => {
    const code_challenge = await sha256Base64UrlFromString(code_verifier)
    if(debug) console.debug(`code_challenge:`, code_challenge)
    return code_challenge 
  }

  const generateState = () => {
    state = "state-" + getRandomStringAsHex()
    sessionStorage.setItem('oauth2State', state)
    if(debug) console.debug(`state saved:`, state)
  }

  const generateNonce = () => {
    nonce = "nonce-" + getRandomStringAsHex()
    sessionStorage.setItem('oauth2Nonce', nonce)
    if(debug) console.debug(`nonce saved:`, nonce)
  }

  async function requestOauth2Code() { // Authorized Code Flow with PKCE
    generateState() // -> state
    generateNonce() // -> nonce
    const response_type = "code"
    const params = {state, nonce, client_id, response_type, scope, redirect_uri}
    generateCodeVerifer() // -> code_verifier
    params.code_challenge = await generateCodeChallenge() // -> code_challenge
    params.code_challenge_method = "S256"
    if(debug) console.debug(`request code:`, params)
    const url = auth_uri + '?' +
      Object.keys(params).map(k => `${k}=${encodeURIComponent(params[k])}`).join('&')

    if(debug) console.info(`Redirect to auth request:`, url)
    document.location.href = url
    // NOT EXECUTED HERE
  }

  function parseJwt(base64Url) {
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(c => 
      '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
    ).join(''))
    return JSON.parse(jsonPayload)
  }

  const verifyIdTokenWithNonce = idToken => {
    let result = false
    if(! idToken) {
      console.error(`verifyIdTokenWithNonce: idToken not found`)
      return result
    }
    if(! (nonce = sessionStorage.getItem('oauth2Nonce'))) {
      console.error(`verifyIdTokenWithNonce: saved nonce not found`)
      return result
    }

    if(debug) {
      console.debug(`id_token:`)  
      idToken.split('.').slice(0, 2).forEach(jwt => console.debug(parseJwt(jwt)))
    }

    const jwtBody = idToken.split('.').slice(1,2).map(jwt => parseJwt(jwt))[0];
    if(nonce !== jwtBody?.nonce) {
      console.error(`Error: invalid nonce id_token:`, nonce, jwtBody?.nonce)
    } else {
      if(debug) console.info(`idToken: nonce matched:`, nonce)
      result = true
    }
    sessionStorage.removeItem('oauth2Nonce')
    return result
  }

  async function requestOauth2Token(code) {
    const content = {client_id, client_secret, code, redirect_uri, grant_type}
    content.code_verifier = sessionStorage.getItem(`oauth2CodeVerifier`)
    sessionStorage.removeItem(`oauth2CodeVerifier`)
    if(debug) console.debug(`restored code_verifier:`, content.code_verifier)
    const body = Object.keys(content).map(k => `${k}=${encodeURIComponent(content[k])}`).join('&')
    const method = 'POST'
    const headers = {'content-type': 'application/x-www-form-urlencoded'}
    if(debug) console.debug(`requestOauth2Token:`, token_uri, body, content)

    try {
      const r = await fetch(token_uri, {method, headers, body})
      if(debug > 1) console.debug(`reqOAuth2Token status:`, r.status)
      if(debug > 1) console.debug(`reqOAuth2Token headers:`, [...r.headers]) 

      const tokens = await r.json()
      if(debug > 1) console.debug(`tokens:`, tokens)
      return verifyIdTokenWithNonce(tokens.id_token) ?
        [r.ok, tokens] : [false, tokens] // API error messages
    } catch(error) {
      console.error('Exception error requestOauth2Token:', error)
      return [false, `Exception error: ${error.message}`]
    }
  }

  function isReceivedOauth2Code() {
    state = sessionStorage.getItem('oauth2State')
    sessionStorage.removeItem('oauth2State')
    if(! state) {
      if(debug) console.info(`oauth2State is not found on sessionStorage`)
      return [false, `oauth2State not found on sessionStorage`]
    }

    // OAuth2 code は URL の ? 以降の search query に積まれている
    if(! document.location.search) {
      if(debug) console.debug(`isReceivedOauth2Code: search query not found`)
      return [false, `search query not found in url`]
    }

    const params = new URLSearchParams(document.location.search)
    if(! params.get('code')) {
      if(debug) console.debug(`isReceivedOauth2Code: code not found in url.search`)
      return [false, `code not found n url.search`]
    }
    console.info(`isReceivedOauth2Code: got code:`, params.get('code'))

    if(! params.get('state')) {
      if(debug) console.debug(`isReceivedOauth2Code: state not found in url.search`)
      return [false, `state not found n url.search`]
    }
    if(debug) console.info(`isReceivedOauth2Code: got state:`, params.get('state'))

    return [true, ""]
  }

  async function receiveOauth2Code() { // リダイレクトされたURLでcodeを受信する
    // 事前に isReceivedOauth2Code() を実行すること
    const params = new URLSearchParams(document.location.search)
    if(state !== params.get('state')) {
      console.error(`Error: invalid oauth2 state:`, state, params.state)
      return [false, `Invalid oath2 state received`]
    }
    if(debug) console.info(`receiveOauth2Code: state matched`)

    // codeでtokenをリクエストする
    const [result, gotToken] = await requestOauth2Token(params.get('code'))
    if(debug) console.debug(`requestOauth2Token:`, result)
    if(! result) {
      tokens = null
      return [result, gotToken]
    }

    tokens = gotToken
    tokens.expiredAt = Date.now() + tokens.expires_in * 1000 // milli seconds
    sessionStorage.setItem(`oauth2AccessToken`, tokens.access_token)
    sessionStorage.setItem(`oauth2IdToken`, tokens.id_token)
    sessionStorage.setItem(`oauth2ExpiredAt`, tokens.expiredAt)
    sessionStorage.setItem(`oauth2Scope`, tokens.scope)

    return [true, tokens]
  }

  function clearTokens() {
    ;[`oauth2AccessToken`,`oauth2IdToken`,`oauth2ExpiredAt`,`oauth2Scope`]
    .forEach(k => sessionStorage.removeItem(k))
    return [true, (tokens = null)]
  }

  function restoreTokensFromLocalStorage() {
    const storedTokens = { // 3. sessionStorageからmodule内のglobal変数'tokens'を取り出す
      access_token: sessionStorage.getItem(`oauth2AccessToken`),
      id_token: sessionStorage.getItem(`oauth2IdToken`), // includes profile sucn as email
      expiredAt: parseInt(sessionStorage.getItem(`oauth2ExpiredAt`)),
      scope: sessionStorage.getItem(`oauth2Scope`),
    }
    if(  (! storedTokens.access_token) // 値があるか調べる
      || (! storedTokens.id_token)
      || (! storedTokens.expiredAt)
      || (! storedTokens.scope)) {
      if(debug) console.info(`oauth2 tokens were not found in sessionStorage`)
      clearTokens()
      return false
    }

    if(storedTokens.expiredAt < Date.now()) {
      if(debug) console.warn(`oauth2 tokens were expired at:`, new Date(storedTokens.expiredAt))
      clearTokens()
      return false
    }

    tokens = storedTokens // update current tokens as stored tokens

    const ids = parseJwt(tokens.id_token.split('.')[1])
    // console.debug(`id_token:`, ids)
    ;['email', 'family_name', 'given_name', 'name', 'locale', 'picture']
    .forEach(k => tokens[k] = ids[k])

    if(debug) console.info(`oauth2: Found stored credentials`)
    return true
  }

  const isAuthed = () => token !== null

  async function checkAuthStates() {
    restoreTokensFromLocalStorage()
    if(tokens) return tokens // 3. ブラウザ内に有効な値がすでにあれば返す

    // 2. OAuth2 codeを受信したときはtokenを要求する
    if(debug) console.debug(`called location:`, document.location)
    const codeResult = isReceivedOauth2Code()
    if(codeResult[0] === true) {
      const tokenResult = await receiveOauth2Code() // tokenをrequestする
      if(! tokenResult[0]) { // OAuth2認証失敗
        console.error(`Error: Can't get OAuth2 tokens:`, tokenResult[1])
      } else { // 認証成功。OAuth2用URLなのでroot pathに移動する
        document.location.href = document.location.origin + '/'
      }
      return null // 注意: auth requestに進まないようにする
    }

    // 1. OAuth2 codeを要求する
    await requestOauth2Code() // CAUTION: async -> HTTP redirect
  }

  // export functions
  return {checkAuthStates, isAuthed, clearTokens}
}
