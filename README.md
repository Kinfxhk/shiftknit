# ShiftKnit · 排更易

**English** · [繁體中文](#繁體中文)

![ShiftKnit: a two-week café rota in the staff × days grid, with the rule check passed](docs/screenshot.png)

ShiftKnit is a free, open-source, offline staff rota builder for small shops,
restaurants, clinics, care homes, NGOs and volunteer teams. It builds a rota
automatically from your rules (availability, leave, minimum rest between shifts,
weekly hours, maximum consecutive days, rest days, staffing and skill needs,
manual locks), and **every rota is checked rule by rule by an independent
checker** before it is shown. It says honestly whether a rota is _proven
optimal_, _feasible but not proven optimal_, or _impossible_ (with the smallest
conflict it found).

- No account, no server, no telemetry, no per-user fees. Your data stays in your
  browser.
- **Share without a server:** a read-only share file (one HTML page with the whole
  team and each person's shifts and weekly hours, safe to forward in a chat app),
  per-person calendar files, and an offline **availability form** that staff fill in
  and send back; you see every change before applying it.
- **Publish and change lists:** numbered versions, an exact "who changed on which day"
  list, and withdraw.
- English and Traditional Chinese.
- Licence: [AGPL-3.0-or-later](LICENSE).

### Use it

- **In the browser:** <https://kinfxhk.github.io/shiftknit/> — nothing to install,
  and it works offline after the first visit. Your data stays in your browser.
- **Download:** a static site zip (with SHA-256) is attached to each
  [release](https://github.com/Kinfxhk/shiftknit/releases).
- **On your own computer** (Node.js 22+):

```sh
npm ci
npm start   # http://127.0.0.1:4883/
```

- **Docker** (serves only the static site, on your own machine):

```sh
docker build -t shiftknit .
docker run --rm -p 127.0.0.1:4883:4883 shiftknit
```

- **Guide:** [docs/guide.md](docs/guide.md) · rules, result labels, "why this rota",
  exports, command line. Hong Kong rest-day preset: [docs/hk-rest-day.md](docs/hk-rest-day.md).
- **Examples:** [examples/](examples/) (small café, care home with night shifts,
  volunteer team across a clock change).
- How the solver and checker work: [docs/solver.md](docs/solver.md).

### Important

- **Not legal advice.** "Passes all checks" only means the rota follows the rules
  _you_ entered. It does not mean it complies with any law or contract. The Hong
  Kong rest-day preset quotes a public Labour Department guide for convenience;
  it is not legal advice. Employers must check their own obligations.
- ShiftKnit is an independent project and is **not affiliated** with, endorsed by
  or sponsored by any other scheduling product or company.

### Commitments

ShiftKnit will **never** have:

- **ads**;
- **tracking or analytics** of any kind, not even "anonymous";
- **paid unlocks**, subscriptions, per-person fees, staff limits or accounts.

There will be no sales calls, no payroll-advance offers and no forced AI. The code stays
open source under AGPL-3.0-or-later, so nobody can turn it into a closed paid service
without sharing their changes. Donations are optional and change nothing in the app.

### Keep a backup

Your data lives only in your browser. ShiftKnit asks the browser to keep it and saves
at once when you close the page, but browsers can still clear site data (for example
when space runs low). Use **Download full backup** now and then; a reminder appears
after many changes. See [docs/guide.md](docs/guide.md#7-your-data).

Source code: <https://github.com/Kinfxhk/shiftknit>

If ShiftKnit helps you, you can support it at
[Buy Me a Coffee](https://buymeacoffee.com/kinfxhk).

---

## 繁體中文

排更易（ShiftKnit）是免費、開源、可離線使用的員工排更工具，適合小店、餐廳、診所、
安老院舍、非政府機構及義工隊。它按你設定的規則（可工作時段、請假、兩更之間的休息
時數、每週工時、最多連續工作日、休息日、人手及技能需求、手動鎖定）自動排更，而且
**每份更表在顯示前都經獨立檢查器逐條驗證**。結果會如實標明「已證明最佳」、「可行
（未證明最佳）」或「無解」（並列出找到的最細衝突）。

- 無需帳戶、無伺服器、無遙測、不按人頭收費；資料只存於你的瀏覽器。
- **不用伺服器都可以分享：**唯讀分享檔（單一 HTML 頁面，包括全隊更表、每人更份及每週工時，
  可用通訊程式轉發）、每人日曆檔，以及可離線填寫的**可工作時間收集表**：員工填好交回，你先看清
  每項改動才決定套用。
- **發佈及改動清單：**有編號的版本、準確列出誰在哪一天有改動，並可撤回。
- 提供英文及繁體中文介面。
- 授權：[AGPL-3.0-or-later](LICENSE)。

### 使用方法

- **瀏覽器：**<https://kinfxhk.github.io/shiftknit/>，無需安裝，首次瀏覽後可離線使用，資料只存於你的瀏覽器。
- **下載：**每個 [release](https://github.com/Kinfxhk/shiftknit/releases) 都附有靜態網站 zip 及 SHA-256。
- **在自己電腦執行**（Node.js 22 或以上）：見上方英文部分的指令（`npm ci`、`npm start`）。
- **使用說明：**[docs/guide.zh-Hant.md](docs/guide.zh-Hant.md)；香港休息日預設：
  [docs/hk-rest-day.md](docs/hk-rest-day.md)。
- **範例：**[examples/](examples/)（小型咖啡店、設夜更的安老院、義工隊）。

### 重要事項

- **非法律意見。**「通過檢查」只代表更表符合**你自己**輸入的規則，並不代表符合任何
  法例或合約。香港休息日預設只是為方便而引用勞工處公開指南，並非法律意見；僱主須自行
  確認本身的責任。
- 排更易是獨立項目，與任何其他排班產品或公司**並無關連**，亦未獲其認可或贊助。

### 承諾

排更易**永遠不會**加入：

- **廣告**；
- 任何形式的**追蹤或分析工具**（即使聲稱「匿名」也不會）；
- **付費解鎖**、訂閱、按人頭收費、員工人數上限或帳戶。

不會有推銷電話、預支糧款優惠或強制使用 AI。程式碼以 AGPL-3.0-or-later 開源，任何人都不能把它
改成封閉的收費服務而不公開修改。捐款純屬自願，不會改變程式任何功能。

### 記得備份

資料只存於你的瀏覽器。排更易會要求瀏覽器保留資料，關閉頁面時亦會即時儲存，但瀏覽器仍有機會清除
網站資料（例如空間不足時）。請不時按「下載完整備份」；多次改動後頁面會提醒你。詳見
[使用說明](docs/guide.zh-Hant.md#7-你的資料)。

原始碼：<https://github.com/Kinfxhk/shiftknit>

如果排更易對你有幫助，歡迎到 [Buy Me a Coffee](https://buymeacoffee.com/kinfxhk) 支持。
