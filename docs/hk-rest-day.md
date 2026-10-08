# Hong Kong rest-day preset · 香港休息日預設

> **Not legal advice · 非法律意見.** This page explains what the preset checks. It does
> not tell you what the law requires of you. Check the Employment Ordinance and your
> contracts, or ask the Labour Department or a lawyer.

## What the preset checks

ShiftKnit's default rest-day rule is based on these sentences from the Labour
Department's _Concise Guide to the Employment Ordinance_, chapter 4 "Rest Days"
(<https://www.labour.gov.hk/eng/public/wcp/ConciseGuide/04.pdf>):

> "An employee employed under a continuous contract is entitled to not less than one
> rest day in every period of seven days."
>
> "A rest day is defined as a continuous period of not less than 24 hours during which
> an employee is entitled to abstain from working for his employer."

So the preset requires **at least 1 rest day in every 7 days**, where a rest day is **at
least 24 continuous hours with no work** — not merely "a calendar day with no shift
starting". A night shift that ends at 07:00 uses up part of the next day.

ShiftKnit counts rest days in a 7-day period as the number of whole 24-hour blocks that
fit in the gaps between shifts inside that period.

### Rolling or fixed periods

The guide does not say (in the text quoted) whether "every period of seven days" means
any 7 days in a row or fixed 7-day periods. We could not verify which reading applies,
so both are offered:

- **any 7 days in a row** (default, stricter);
- **fixed 7-day blocks** counted from the first day of the rota.

Periods shorter than 7 days are not checked.

### Rest-day roster

The guide also describes informing employees of rest days in advance, for example "by
displaying a roster showing the dates of the appointed rest days for each employee".
**Print rest-day roster** produces such a list (whole calendar days with no work) to
help; whether it meets your obligations is for you to check.

### What is not checked

Who is employed under a continuous contract, holidays, annual leave, sickness days,
pay, overtime and anything else in the Ordinance. Turn the preset off or change it if
your situation differs.

---

## 繁體中文

排更易預設的休息日規則，依據勞工處《僱傭條例簡明指南》第四章「休息日」（上方連結，英文原文
引述如上）：連續性合約僱員每 7 日最少有 1 個休息日；休息日指僱員有權不為僱主工作的**連續不少於
24 小時**。

因此預設要求**每 7 日最少 1 個休息日**，而休息日是**連續最少 24 小時不用工作**，並非單純「當日
沒有更份開始」。例如夜更於早上 7 時才結束，會佔用翌日部分時間。

指南（所引文字）沒有說明「每 7 日」是指任何連續 7 日還是固定 7 日一期，我們未能核實，所以兩種
方式都提供：**任何連續 7 日**（預設，較嚴格）或**由第一日起每 7 日為一期**。少於 7 日的期間
不作檢查。

「列印休息日更表」會列出各員工整日不用工作的日子，方便預先張貼通知；是否符合你的責任，須自行
確認。

本預設不檢查：誰屬連續性合約、法定假日、年假、病假、工資、加班及條例內其他事項。如情況不同，
請關閉或修改此預設。**此頁並非法律意見。**
