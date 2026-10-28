# SnapPDF Lite PWA
獨立製作的 PDF 工具 PWA 示範，非 SnapPDF 官方產品。

## 部署
把整個資料夾上傳至支援 HTTPS 的靜態網站平台（如 Netlify Drop、Cloudflare Pages 或 GitHub Pages）。請不要用 `file://` 直接開啟，PWA 與 ES Modules 需要網頁伺服器。iPhone 用 Safari 開啟網址 → 分享 → 加入主畫面。

## 功能
- 圖片、相機轉 PDF
- 開啟、預覽、下載 PDF
- PDF 合併
- 壓縮（將頁面光柵化，可能失去可選取文字，且不保證檔案必定更小）
- 輸入已知開啟密碼解鎖（光柵化輸出）
- 簽名、英數字浮水印
- 本機 IndexedDB 保存文件，離線啟動（首次連線載入外部 JS 元件）

## 限制
- Protect PDF 尚未實作（不提供假加密）。
- 不支援中文浮水印（預設 PDF 標準英文字體不含中文字）。
- 受密碼保護 PDF 的原生修改與合併可能失敗。
- PDF 文件可能很大，iOS 記憶體有限；清除 Safari 網站資料會使本機文件消失。請下載備份。
- 本專案未含自動化安全稽核或跨機型相容性測試。
