/**
 * Admin console: static Discord help card (Task 165 Phase 2 step 2d revision 2, spec
 * discord-admin-accounts.md §9.2). Mounted last on the `discord` panel, after
 * `DiscordAccountsSection`. Holds the sending rules and the "how to get a webhook URL"
 * guide moved out of `DiscordSection`.
 */
export function DiscordHelpSection() {
  return (
    <section className="section glass adm-panel">
      <div className="rpt-section-head">
        <h3 className="head-tight">說明</h3>
      </div>

      <ul className="hint dsc-help-list">
        <li>繼承全域不另外發送；自訂網址才多送一份。</li>
        <li>個人持股報告只送到該帳號自己的網址。</li>
        <li>全域未設定時經濟快報不送。</li>
        <li>平日（週一至週五）台北時間發送；當天沒有台股大盤資料時不送。</li>
      </ul>

      <details className="hint" style={{ marginTop: 12 }}>
        <summary>如何取得 Discord Webhook 網址</summary>
        <p>
          每日總結使用 Discord 的 Webhook，不需要建立 Bot，也不需要 API 金鑰或 Bot Token。只要在頻道建立一個
          Webhook，把它的網址貼到上面即可。
        </p>
        <ol>
          <li>
            用電腦版或網頁版 Discord 開啟要接收總結的伺服器。你需要該伺服器的「管理 Webhook」權限（伺服器擁有者與管理員預設都有）。
          </li>
          <li>在要發送的文字頻道名稱旁，點齒輪圖示「編輯頻道」。</li>
          <li>左側選單點「整合」。</li>
          <li>點「Webhook」，再點「新 Webhook」（第一次建立時按鈕可能顯示為「建立 Webhook」）。</li>
          <li>展開剛建立的 Webhook，確認「頻道」是要接收總結的頻道。名稱與頭像可以不改，訊息一律以「盤後總結」的名義送出。</li>
          <li>點「複製 Webhook 網址」。</li>
          <li>回到本頁，把網址貼到「Discord Webhook 網址」欄位，按「儲存」，再按「測試發送」確認頻道有收到訊息。</li>
        </ol>
        <div className="notice notice-warn" style={{ padding: '8px 12px', fontSize: 14, marginTop: 8 }}>
          <strong>安全提醒</strong>
          <ul>
            <li>Webhook 網址等同密碼：任何拿到網址的人都能在這個頻道發訊息。不要貼到聊天室、截圖，也不要提交到 GitHub。</li>
            <li>共用伺服器建議開一個專用頻道，並用頻道權限限制誰能看見與管理 Webhook。</li>
            <li>本系統只把網址存在伺服器，畫面只顯示末 4 碼，儲存後無法從這裡讀回完整網址。</li>
            <li>網址外洩時：回到 Discord 同一個畫面刪除該 Webhook，重新建立一個，再到本頁貼上新網址並儲存。</li>
          </ul>
        </div>
      </details>
    </section>
  )
}
