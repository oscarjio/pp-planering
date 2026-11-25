# Projektportalen – nya API:et (v2, new-app) – kartläggning för planeringsverktyget

> Kartlagt 2026-11-25 via live-trafik i `new-app.projektportalen.se`, inloggad med en användare med roll PROJECTMANAGER.
> Ersätter i praktiken `orderportal/docs/api-spec.md` (som gäller gamla `api-app3`). Inofficiellt – kan ändras utan förvarning.

## Det som har ändrats sedan OrderPortal

| | Gammalt (OrderPortal) | Nytt |
|---|---|---|
| Webbapp | `app3.projektportalen.se` | `new-app.projektportalen.se` (app3 redirectar hit) |
| API-bas | `https://api-app3.projektportalen.se/api` | `https://new-api.projektportalen.se/api` |
| Inloggning | HTTP Digest (RFC 7616), egen HA1 | Microsoft Entra External ID / MSAL (`extern.projektportalen.se`) |
| Auth per anrop | `Authorization: Digest …` | **Sessionscookie** (`withCredentials: true`) + `X-CSRF-Token` på skrivande/POST-anrop |
| Realtime | ASP.NET SignalR (`/signalr/signalr/*`) | ASP.NET Core SignalR (`/signalr/negotiate?negotiateVersion=1`) |

**Konsekvens:** `pp-client.js` + `digest-auth.js` i OrderPortal fungerar inte mot nya API:et. Många *paths* är dock oförändrade (se nedan) – det är auth och host som byts.

### Auth-detaljer (nytt)

- Alla anrop görs med `credentials: 'include'`; servern läser en HttpOnly-sessionscookie på `new-api.projektportalen.se`. Ingen `Authorization`-header.
- Headers webbappen skickar: `Accept`, `languageId`, `X-Correlation-ID` (valfri), och på POST/PUT även `X-CSRF-Token` + `Content-Type: application/json`.
- **CSRF-token** ligger i `sessionStorage['pp_session_rotation']` (JSON):
  `{ csrfToken, expiresAt, loginUser: { userId, clientId, clientNumber, roleCode, features }, remembered }`.
  Token roteras (expiresAt ≈ 15 min fram) – läs om den inför varje POST, cacha inte.
- GET fungerar utan CSRF-token.

**För Chrome-tillägget:** enklast är ett content script / injicerad panel på `new-app.projektportalen.se` som läser CSRF-token ur sessionStorage och anropar `new-api` med `credentials: 'include'`. Då återanvänds användarens inloggning helt – ingen egen login behövs. Host-permissions: `https://new-app.projektportalen.se/*`, `https://new-api.projektportalen.se/*`.

### Behörighet / scope – viktigt

Vad API:et returnerar beror på **inloggad användares roll**. Med roll PROJECTMANAGER (exempel från kartläggningen):
- `POST /projects/list` → 86 rader (oavsett TabIndex – TabIndex verkar ignoreras här)
- `GET /projects/risk-scores` → 337 projekt
- `GET /workspace/summary?scope=all` → `ScopeCounts: { Mine: 25, Company: 490 }`

Planeringsverktyget måste alltså köras inloggat som chefen (eller en admin) för att se alla projekt. Testa med hans konto innan siffror tolkas.

## Endpoints för planeringsverktyget

### 1. Projektlista med datum – `POST /projects/list`

Body (ag-grid server-side):
```json
{ "StartRow": 0, "EndRow": 500, "SortModel": [], "FilterModel": {}, "RowGroupCols": [],
  "ValueCols": [], "TabIndex": 4, "Keyword": "", "GroupKeys": [] }
```
Svar: `{ Rows: [...], Success, LastRow, TotalCount }`. 68 fält per rad, de viktiga:

| Fält | Användning |
|---|---|
| `ProjectId`, `ProjectNumber`, `ProjectName` | Identitet |
| `ProjectType` | 1 = projekt?, 2 = serviceorder? (verifiera) |
| `PriceType` | Löpande vs fastpris – viktigt för att tolka budget |
| `StatusName` / `StatusId` / `ProjectStatusCode` | Sett: `Pågående/ACTIVE`, `Tilldelad/ASSIGNED`, `Öppna/OPEN`, `Avslutad/COMPLETED` |
| `StartDate`, `EndDate` (+ `…String`) | **Slutdatum** för planering |
| `ProjectManager`, `ProjectManager2`, `CustomerName` | Presentation |
| `TimeRecordsTotal`, `MaterialsTotal`, `Price` | Ekonomi (kr) |
| `HasLogedStaff`, `DeviationCount` | Bemanning/avvikelser |

(Gamla `POST /project/general-list` finns kvar men returnerar 0 rader i nya vyn.)

### 2. Budget vs utfall för ALLA projekt i ett anrop – `GET /projects/risk-scores`

Array, ett objekt per projekt:
`ProjectId, ClientId, ProjectName, ProjectNumber, RiskScore, RiskLevel, AtaCount, DeviationCount, EarlyDeviationCount, HasAtaAndDeviationCombo, EarlyBurnPercent, BudgetRevisionCount, TotalBudgetHours, TotalActualHours, BudgetUsagePercent`

→ **Kärnkällan.** Joina på `ProjectId` med `/projects/list` → kvarvarande timmar + slutdatum utan N+1-anrop. `EarlyBurnPercent` passar för att hitta tidig överbemanning.

### 3. Detalj per projekt (vid behov)

| Metod | Path | Innehåll |
|---|---|---|
| GET | `/projects/{id}` | `TotalBudgetHours`, `TotalWorkedHours`, `IntoDays`, `UntilDays` (dagar till slutdatum), Start/EndDate, task-/ÄTA-/avvikelse-timmar |
| GET | `/projects-header/{id}` | Samma + `Users`, `ProjectTaskUsers`, `ProjectTasks`, `NeedSchedule` |
| GET | `/projects/{id}/budget-worked-hours` | `{ ProjectId, TotalWorkedHours, TotalBudgetHours }` |
| GET | `/projects/{id}/project-economy` | Normal-/ÄTA-/avvikelseekonomi, PL-userIds |
| GET | `/projects/{id}/total-reported-user-times` | `TotalBudgetHours, TotalQuantity, TotalInvoiceTime, TotalCost, TotalSales` |
| GET | `/projects/project-overview/tasks-users/{id}` | Moment med `BudgetHours` + tilldelade användare |
| POST | `/projects/reported-user-times` | Tidrader per projekt (ag-grid-body med `ProjectId`) – för burn rate per projekt |

### 4. Förbrukningstakt (burn rate) – `GET /time-manage?StartDate=YYYY-MM-DD&EndDate=YYYY-MM-DD&ShowSevenDays=true`

Svar kan vara dubbelkodad JSON-sträng → `JSON.parse` två gånger.
`{ WeekTotalList, AllProjectsWeekTotalList, AllUsersReportTime[], WeekTotalTime, AllProjectsWeekTotalTime }`
- `AllUsersReportTime[]`: en per anställd – `UserId, UserName, EmployeeGroupId, WeekTotal, UserActualTimeList[], UserAbsenceTimeList[], EmployeeScheduleList[] …`
- `UserActualTimeList[]`: `ProjectId, ProjectName, Quantity, Timestamp, ReportDate, TimeTypeId, Approved, …`

→ Summera `Quantity` per `ProjectId` per vecka de senaste 4–8 veckorna = nuvarande takt. Ger också antal aktiva personer och frånvaro.

### 5. Resursplanering / kapacitet (`/employeeSchedule` i UI)

| Metod | Path | Innehåll |
|---|---|---|
| GET | `/projects/schedule-demand?start=YYYY-MM-DD&end=YYYY-MM-DD` | Per projekt: `Buckets[]` per dag med `DemandHours`, `AllocatedHours` |
| GET | `/employees/schedules?startDate=…&endDate=…` | Personalgrupper → `ScheduleEmployees[]` (`EmployeeId, UserId, EmployeeName, ScheduleProjects[]`) |
| GET | `/projects/un-schedule?startDate=…&endDate=…` | Ej planerade projekt: `BudgetHours, ScheduledMinutes, StartDate, EndDate …` |
| GET | `/users/profile/getSchedule` | Användarens standardschema (`ScheduleStartTime`, `ScheduleEndTime`) |

Personalgrupper som finns: Kollektivanställda, Samverkan, Tjänsteman Admin/Ekonomi, Tjänsteman operativ (m.fl., 10 st). UI visar per person "Bokade / Tillgängliga / Beläggning" (t.ex. 0 h / 40 h / 0 %).

### 6. Övrigt nytt (arbetsytan)

`GET /workspace/summary?scope=mine|all`, `GET /workspace/pipeline?scope=…`, `GET /workspace/my-projects`, `GET /projects/action-statuses?page=&pageSize=&scope=&includePeople=true` (åtgärder som "Uppdatera slutdatumet", försenade projekt), `POST /projects/financials`, `GET /clients/project-priorities/active`, `GET /forecast/counter`.

## Planeringslogik (v1)

**Urval:** bara stora projekt med budget – `TotalBudgetHours ≥ 40` (justerbar tröskel). Projekt med 0/låg budget visas inte.

**Mål:** jämn bemanning genom hela projektet – undvika lägen som "2 månader kvar och 1 500 h kvar" som kräver massiv uppmanning på slutet.

Kärnmått per projekt:
- `planeradTakt = TotalBudgetHours / projektets totala längd i veckor (Start→Slut)` = den jämna bemanningen projektet "borde" ha
- `förväntatUtfört = TotalBudgetHours × (förfluten tid / total tid)` (linjär plan)
- `avvikelse = TotalActualHours − förväntatUtfört` → negativ = efter plan
- `behövdTakt = kvar / veckorKvar`
- `uppmanningsfaktor = behövdTakt / planeradTakt` (1,0 = i fas; 1,5 = måste öka 50 %)
- Personer = takt / 40 h/vecka

Statusfärg: 🟢 faktor ≤ 1,15 · 🟠 1,15–1,5 · 🔴 > 1,5 eller kvar > 0 efter slutdatum · 🔵 utfört ≫ förväntat tidigt (överbemannat/budgetrisk).

Vy: lista sorterad på faktor + per projekt en enkel kurva (plan-linje vs faktiskt ackumulerat, med "behövd linje" till slutdatum). Summa behövda personer per månad framåt över alla stora projekt → långtidsbehov/inhyrning.

### Ursprungligt förslag (detaljer)

Per aktivt projekt:
- `kvar = TotalBudgetHours − TotalActualHours` (risk-scores)
- `arbetsdagarKvar ≈ (EndDate − idag) × 5/7`
- `takt = rapporterade h/vecka senaste 4 v` (time-manage)
- `behövdTakt = kvar / veckorKvar` → **behövda personer = behövdTakt / 40**
- `prognos slutdatum = idag + kvar / takt`
- Flaggor: 🔴 behövd takt > 1,5 × nuvarande takt (måste manna upp) · 🟠 prognos efter slutdatum · 🔵 `EarlyBurnPercent` högt / takt ≫ behövd (tidigt överbemannat) · ⚪ saknar budget eller slutdatum

Aggregerat per vecka/månad framåt: summa behövda personer mot tillgänglig kapacitet (antal anställda i relevanta grupper × 40 h − frånvaro − planerat). Gap > 0 = behov av inhyrning.

**Fallgrop (sett i testkörning):** löpande ramavtal/serviceorder med stora "budgetar" (t.ex. 3 000 h ramar på årsbasis) ger orimliga behov (14 personer). Dessa måste filtreras/viktas via `PriceType`/`ProjectType` eller markeras manuellt som "ram".

## Öppna frågor

1. Hur filtreras `/projects/list` på status/typ (FilterModel-schema)? TabIndex ignoreras.
2. Vad returnerar listan med chefens/admin-roll (alla 490)?
3. Mappning `ProjectType` / `PriceType` → text.
4. Hur `/projects/financials` (POST) ser ut – kan ersätta flera detaljanrop.
5. `schedule-demand`: var kommer `DemandHours` ifrån (budget utspridd eller manuellt)?
