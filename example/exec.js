// vi: sts=2 sw=2 et

import {googleOAuth2} from './google-oauth2.js'

const debug = 1
const qs = document.querySelector.bind(document)

const matrixCellRange = (sheetName, columns, rows) => // -> Array
  columns.map(c => `'${sheetName}'!` + rows.map(r => c + r).join(':'))

/*
  Google Spreadsheet API: values.batchGet
  - セルの表示値だけを得られる。データ量が小さく速い。2万行4列で1.5秒以下だった。2023-09
  - 元の格納値やセルの大きさや非表示かはわからない
  https://developers.google.com/sheets/api/reference/rest/v4/spreadsheets.values/batchGet?hl=en
 */
async function batchGetSpreadSheet(access_token, spreadsheetId, ranges) {
  const rangesArg = ranges.map(range => `ranges=` + encodeURIComponent(range)).join('&')
  const headers = {Authorization: `Bearer ${access_token}`}
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet?${rangesArg}`
  try { // Fetch sheet content
    const response = await fetch(url, {headers}) /* global fetch */
    if(debug > 1) console.debug(`Response for range=${ranges}:`, response)
    const data = await response.json()
    if(debug > 1) console.debug(`data:`, data)
    return [response.ok, data]
  } catch (err) {
    console.error(`Error: batchGetSpreadSheet():`, err)
    return [false, err]
  }
}

/*
  Google Spreadsheet API: spreadsheets.get
  - セルの属性、表示値、格納値、セルの大きさなど詳細を偉える
  - 2万行以上あると応答に5秒以上かかった, 2023-09
  https://developers.google.com/sheets/api/reference/rest/v4/spreadsheets/get?hl=en
 */
async function getSpreadSheet(access_token, spreadsheetId, ranges, includeGridData = true) {
  const rangesArg = ranges.map(range => `ranges=` + encodeURIComponent(range)).join('&')
  const headers = {Authorization: `Bearer ${access_token}`}
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?${rangesArg}&includeGridData=true`
  try { // Fetch sheet content
    const response = await fetch(url, {headers}) /* global fetch */
    if(1 || debug > 1) console.debug(`Response for range=${ranges}:`, response)
    const data = await response.json()
    if(debug > 1) console.debug(`data:`, data)
    return [response.ok, data]
  } catch (err) {
    console.error(`Error: getSpreadSheet():`, err)
    return [false, err]
  }
}
/*
  qs(`#content`).innerHTML += [
    `<hr><h3>${sp.properties?.title}</h3>`,
    `<table><tr><td>`,
    sp.sheets[0]?.data?.map(row =>
      row.rowData?.map(v =>
        v.values.map(cell => cell.formattedValue)
        .map(v => v || '...')
        .join(`<td>`)
      ).join(`<tr><td>`)
    ),
    `</table>`,
  ].join('')

  console.time('spGetRange')
  const rangeName = 'RSRP考察'
  const cells = getValuesForNamedRange(sp, rangeName)
  console.timeEnd('spGetRange')
  console.debug(`${rangeName}:`, cells[0][0])
  qs(`#content`).innerHTML += `<hr><h3>${rangeName}</h3>` + cells[0][0];
*/

// return : [ [ value1, value2, ... ], ... ] (rows)
function getValuesForNamedRange(spreadsheet, rangeName, fieldName = 'formattedValue') {
  const range = spreadsheet.namedRanges.find(namedRange =>
    namedRange.name === rangeName)
  if(! range) {
    console.info(`rangeName not found:`, rangeName)
    return null
  }

  const sheet = spreadsheet.sheets.find(sheet =>
    sheet.properties.sheetId === range.range.sheetId)
  if(! sheet) {
    console.info(`sheetId not found:`, range.range.sheetId)
    return null
  }

  return sheet.data[0].rowData // namedRangeで指定された範囲のセルを返す
    .slice(range.range.startRowIndex, range.range.endRowIndex)
    .map(row => 
      row.values.slice(range.range.startColumnIndex, range.range.endColumnIndex)
      .map(attrs => fieldName ? attrs[fieldName] : attrs)
    )
}

/* client_secret.json : as "web application"
{
  "web": {
    "client_id": "14937285783-c25cbmn8vc5k06v6nqo7h741b32me1l4.apps.googleusercontent.com",
    "project_id": "sdd-line-to-spreadsheet",
    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
    "token_uri": "https://oauth2.googleapis.com/token",
    "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
    "client_secret": "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",
    "redirect_uris": [
      "https://dev.sshida.com:8888/auth.html",
      "https://dev.sshida.com:8888/"
    ],
    "javascript_origins": [
      "https://dev.sshida.com:8888"
    ]
  }
}
*/

window.onload = async () => { 
  const debug = 0

  const oauth = new googleOAuth2({ // google developer console: "project_id": "sdd-line-to-spreadsheet",
    scope: [
      'openid email profile',
      'https://www.googleapis.com/auth/drive.readonly', // baseUrl: https://www.googleapis.com/auth/
      //'https://www.googleapis.com/auth/drive.file', // drive.fileだけではspreadsheets.getが404 not foundになる
    ].join(' '),
    
    client_id: '____________________________________________.apps.googleusercontent.com',
    client_secret: '___________________________________',
    redirect_uri: 'https://___.______.com:____/',
  })
  
  const tokens = await oauth.checkAuthStates()
  if(! tokens) {
    setTimeout(() => {
      qs('#content').innerHTML = `ログインできませんでした`
      console.error(`Error: authn failed`)
    }, 2000)
    return
  }
  qs(`#signout_button`).addEventListener('click', () => {
    oauth.clearTokens()
    qs('#content').innerHTML += `<br/>oauth tokens are deleted`
  })
  qs(`#signout_button`).style.setProperty('display', 'block')

  if(debug) qs('#content').innerHTML +=
    `<br/><pre>` + Object.keys(tokens).map(k => [k, tokens[k]].join('=')).join('<br/>') + `</pre>`

  if(debug) console.time('spGet') // 800 〜 1,000 ms かかった (minuma)
  const documentId = '____________________________________________' // values:batchGetなら 2万行 x 4列で2秒以下
  const sheetName = 'Data'
  const ranges = matrixCellRange(sheetName, ['A', 'B', 'G', 'L'], ['7', '']) // A, L, P列の、7行目以降すべて
  const [result, sp] = await batchGetSpreadSheet(tokens.access_token, documentId, ranges)
  if(debug) console.timeEnd('spGet')

  if(debug) console.debug(`sp:`, sp)
  qs('#content').innerHTML += result ?
    [
      `<hr><table>`,
      ... sp.valueRanges[0]?.values.map((d, index) =>
        `<tr><td>` + sp.valueRanges.map(col => col.values[index]).join('<td>')),
      `</table>`,
    ].join('')
  :
    [
      ``,
      `取得できませんでした: ${sp.error.code}: ${sp.error.message}`,
      `documentId: ${documentId}`,
      `range: ${ranges.join(' ')}`,
    ].join('<br/>')
}
