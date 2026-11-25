"""End-to-end-test av det riktiga tillägget i Chromium mot ett simulerat Projektportalen-API.
Endast påhittad testdata. Kör: pip install playwright && playwright install chromium && python test/e2e_extension.py
Kontrollerar: anslutning, kort/KPI, detaljvy, skrivskydd (allowlist), CSRF på POST, XSS-escaping, sök/filter/sort/CSV/inställningar.
"""
import json, datetime as dt, random, re, tempfile, sys
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright
random.seed(5)
import os
EXT=os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "extension"))
OUT=tempfile.gettempdir()
today=dt.date.today()
def d(days): return (today+dt.timedelta(days=days)).isoformat()+"T00:00:00"
P=[ # id, nr, namn, PL, kund, budget, start, slut, takt-faktor, i lista?
 (101,"7001","Skola – elinstallation","Anna Berg","Exempelstads kommun",2400,-200,90,0.55,True),
 (102,"7002","Reningsverk – styrskåp","Erik Lund","Exempelstads kommun",1200,-150,120,0.95,True),
 (103,"7003","Kontorshus – belysning","Sara Holm","Fastighets AB Exempel",600,-60,60,1.0,False),
 (104,"7004","Försenat projekt","Johan Ek","Test AB",500,-140,-7,0.7,True),
 (105,"7005","Över budget med tid kvar","Anna Berg","Test AB",400,-70,70,2.3,True),
 (106,"7006","Ej startat projekt","Erik Lund","Test AB",800,14,200,0,True),
 (107,"7007","Saknar datum <b>x</b>","Sara Holm","Test AB",300,None,None,0,False),
 (108,"7008","Litet projekt under tröskel","Johan Ek","Test AB",30,-10,30,1,True),
 (109,"7009","Avslutat projekt","Johan Ek","Test AB",900,-300,-30,1,True),
]
risk=[];rows=[];detail={};hist={}
for i,n,nm,pl,k,b,s,e,f,inlist in P:
    if s is None: actual=50
    else:
        frac=max(0,min(1,(-s)/(e-s))); actual=round(b*frac*f,1)
    risk.append({"ProjectId":i,"ProjectNumber":n,"ProjectName":nm,"TotalBudgetHours":b,"TotalActualHours":actual,"RiskLevel":"Låg"})
    st = ("Avslutad","COMPLETED") if i==109 else ("Pågående","ACTIVE")
    row={"ProjectId":i,"ProjectNumber":int(n),"ProjectName":nm,"ProjectManager":pl,"CustomerName":k,"StatusName":st[0],"ProjectStatusCode":st[1],"StartDate":d(s) if s is not None else None,"EndDate":d(e) if e is not None else None}
    if inlist: rows.append(row)
    detail[i]={"ProjectId":i,"ProjectNumber":int(n),"ProjectNameWithoutNumber":nm,"ProjectStatus":{"Id":1,"Code":st[1]},"Customer":{"CustomerName":k},"StartDate":row["StartDate"],"EndDate":row["EndDate"]}
    if s is not None and actual>0 and i!=102:  # 102: "ingen behörighet" → 0 tidrader
        days=[x for x in range(s,0) if (today+dt.timedelta(days=x)).weekday()<5]
        w=[random.uniform(.4,1.6) for _ in days]; tot=sum(w)
        hist[i]=[{"ReportDate":d(x),"Quantity":round(actual*wi/tot,2)} for x,wi in zip(days,w)]
log=[]
CORS={"Access-Control-Allow-Origin":"https://new-app.projektportalen.se","Access-Control-Allow-Credentials":"true",
      "Access-Control-Allow-Headers":"content-type,x-csrf-token,languageid,accept","Access-Control-Allow-Methods":"GET,POST,PUT,DELETE,OPTIONS"}
def api(route):
    req=route.request; u=urlparse(req.url); path=u.path.replace("/api","",1)
    if req.method=="OPTIONS": return route.fulfill(status=204,headers=CORS)
    body=json.loads(req.post_data) if req.post_data else {}
    hdr=req.headers
    log.append((req.method,path,hdr.get("x-csrf-token")))
    def ok(x): route.fulfill(status=200,headers={**CORS,"Content-Type":"application/json"},body=json.dumps(x))
    if req.method=="GET" and path=="/projects/risk-scores": return ok(risk)
    m=re.match(r"^/projects/(\d+)$",path)
    if req.method=="GET" and m: return ok(detail[int(m.group(1))])
    if req.method=="POST" and path=="/projects/list":
        if hdr.get("x-csrf-token")!="TESTTOKEN": return route.fulfill(status=401,headers=CORS,body="")
        return ok({"Rows":rows[body["StartRow"]:body["EndRow"]],"TotalCount":len(rows)})
    if req.method=="POST" and path=="/projects/reported-user-times":
        a=hist.get(int(body["ProjectId"]),[]); return ok({"Rows":a[body["StartRow"]:body["EndRow"]],"TotalCount":len(a)})
    if req.method=="GET" and path=="/time-manage":
        return ok(json.dumps({"AllUsersReportTime":[{"UserId":u,"UserActualTimeList":[{"ProjectId":101,"Quantity":32,"ReportDate":d(-3)}]} for u in range(1,7)]}))  # dubbelkodad
    route.fulfill(status=500,headers=CORS,body="unexpected")
APP_HTML="""<!doctype html><html><body><h1>Projektportalen (simulerad)</h1>
<script>sessionStorage.setItem('pp_session_rotation', JSON.stringify({csrfToken:'TESTTOKEN',loginUser:{userId:1,clientNumber:1000,roleCode:'ADMINISTRATOR'}}));</script></body></html>"""
with sync_playwright() as pw:
    ctx=pw.chromium.launch_persistent_context(tempfile.mkdtemp(),headless=True,channel="chromium",args=[f"--disable-extensions-except={EXT}",f"--load-extension={EXT}"],viewport={"width":1500,"height":1000})
    ctx.route("https://new-api.projektportalen.se/**",api)
    ctx.route("https://new-app.projektportalen.se/**",lambda r: r.fulfill(status=200,content_type="text/html",body=APP_HTML))
    sw=ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker")
    ext_id=sw.url.split("/")[2]; print("ext id ok:", bool(ext_id))
    errs=[]
    # 1) dashboard utan Projektportalen öppen
    dash=ctx.new_page(); dash.on("pageerror",lambda e: errs.append("page:"+str(e))); dash.on("console",lambda m: m.type=="error" and errs.append("console:"+m.text))
    dash.goto(f"chrome-extension://{ext_id}/dashboard.html"); dash.wait_for_timeout(1200)
    print("1) notis när PP saknas:", dash.is_visible("#connectBox"), "|", dash.inner_text("#conn"))
    # 2) öppna simulerad Projektportalen och uppdatera
    pp=ctx.new_page(); pp.goto("https://new-app.projektportalen.se/workspace"); pp.wait_for_timeout(500)
    dash.bring_to_front(); dash.click("#btnReload"); dash.wait_for_selector("#main:not(.hidden)",timeout=15000); dash.wait_for_timeout(800)
    print("2) ansluten:", dash.inner_text("#conn"))
    cards=dash.locator(".card"); print("   kort:", cards.count(), [c.get_attribute("data-id") for c in cards.all()])
    print("   kpi:", dash.inner_text("#kpis").replace("\n"," | "))
    print("   fot:", dash.inner_text("#foot").replace("\n"," / ")[:400])
    xss = dash.evaluate("(()=>{const t=document.querySelector('.card[data-id=\"107\"] .c-title'); return t.textContent.includes('<b>x</b>') && t.querySelector('b')===null;})()")
    print("   XSS-test (<b> i projektnamn visas som text, inte som tagg):", xss)
    dash.screenshot(path=os.path.join(OUT,"e2e_cards.png"),full_page=True)
    # 3) status per kort
    for i in ["101","102","103","104","105","106","107"]:
        c=dash.locator(f'.card[data-id="{i}"]')
        print(f"   {i}:", c.locator(".pill").inner_text(), "|", c.locator(".c-msg").inner_text())
    # 4) detaljvy med och utan tidrader
    for i in ["101","102","104"]:
        dash.click(f'.card[data-id="{i}"]'); dash.wait_for_timeout(700)
        print(f"4) detalj {i}:", dash.inner_text("#mSource"), "| kurva svg:", dash.locator("#mChart svg").count(), "| vecka svg:", dash.locator("#mWeekly svg").count())
        dash.screenshot(path=os.path.join(OUT,f"e2e_modal_{i}.png")); dash.keyboard.press("Escape")
    # 5) skrivskydd: försök skicka otillåtna anrop via tilläggets egen meddelandekanal
    res=dash.evaluate("""async()=>{ const [t]=await chrome.tabs.query({url:'https://new-app.projektportalen.se/*'});
      const tries=[['PUT','/projects/101'],['DELETE','/projects/101'],['POST','/materials'],['POST','/projects/101'],['GET','/projects/101/../../users'],['GET','/user/settings']];
      const out=[]; for(const [m,p] of tries){ const r=await chrome.tabs.sendMessage(t.id,{type:'pp-api',req:{method:m,path:p}}); out.push(m+' '+p+' -> '+(r.ok?'TILLÅTEN':r.error)); } return out; }""")
    print("5) skrivskydd:"); [print("   ",x) for x in res]
    # 6) sidan själv kan inte prata med content scriptet
    print("6) sidans window ser inte tilläggets proxy:", pp.evaluate("typeof window.__ppPlanering === 'undefined'"))
    # 7) sök, filter, sortering, lista, CSV, inställningar
    dash.fill("#q","skola"); dash.wait_for_timeout(200); print("7) sök 'skola':", dash.locator(".card").count())
    dash.fill("#q",""); dash.click('.chip[data-filter="red"]'); print("   filter kritiska:", dash.locator(".card").count())
    dash.click('.chip[data-filter="all"]'); dash.select_option("#sort","end"); print("   sort slutdatum, första:", dash.locator(".card").first.get_attribute("data-id"))
    dash.click("#viewList"); print("   listrader:", dash.locator("#tbl tbody tr").count())
    with dash.expect_download() as dl: dash.click("#btnCsv")
    csv=open(dl.value.path(),encoding="utf-8-sig").read().splitlines(); print("   CSV rader:", len(csv), "| rubrik:", csv[0][:80])
    dash.click("#btnSettings"); dash.fill("#setThreshold","1000"); dash.click("#btnSaveSettings"); dash.wait_for_timeout(500)
    print("   tröskel 1000 → rader:", dash.locator("#tbl tbody tr").count())
    # 8) bakgrund: action-klick (simulerat) fokuserar befintlig flik
    n_before=len(ctx.pages)
    ctxs=sw.evaluate("chrome.runtime.getContexts({contextTypes:['TAB'],documentUrls:[chrome.runtime.getURL('dashboard.html')]}).then(c=>c.length)")
    print("8) bakgrund hittar öppen översikt via getContexts:", ctxs)
    # sammanställ API-trafik
    meth={}
    for m,p,tok in log: meth[(m,re.sub(r'\d+','{id}',p))]=meth.get((m,re.sub(r'\d+','{id}',p)),0)+1
    print("API-anrop som nådde servern:"); [print("   ",k,v) for k,v in sorted(meth.items())]
    print("POST utan CSRF:", [x for x in log if x[0]=="POST" and x[2]!="TESTTOKEN"])
    print("fel:", errs)
    ctx.close()
