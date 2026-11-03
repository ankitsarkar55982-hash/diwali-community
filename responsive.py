"""Viewport + phone-flow tests. Runs the real front end against the mock backend in common.py (NOT a live Supabase project)."""
from common import *
import sys, io as _io
AUDIT="""(()=>{scrollTo(0,0);const W=innerWidth,out=[],H=document.documentElement,ROOT=document.querySelector('#intro:not(.out):not([hidden])')||document.querySelector('#app');
if(H.scrollWidth>W+1)out.push('page scrolls horizontally: '+H.scrollWidth+'>'+W);
const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&!e.closest('[hidden],.hp')&&getComputedStyle(e).visibility!=='hidden'};
const tag=e=>e.tagName.toLowerCase()+(e.id?'#'+e.id:'')+(typeof e.className==='string'&&e.className?'.'+e.className.split(' ')[0]:'');
const inScroll=e=>{let p=e.parentElement;while(p&&p!==document.body){const o=getComputedStyle(p).overflowX;if((o==='auto'||o==='scroll')&&p.scrollWidth>p.clientWidth+1)return true;p=p.parentElement}return false};
ROOT.querySelectorAll('*').forEach(e=>{if(!vis(e)||e.tagName==='CANVAS'||e.closest('#toast'))return;const r=e.getBoundingClientRect();if((r.right>W+1||r.left<-1)&&!inScroll(e))out.push('out of viewport: '+tag(e)+' ['+Math.round(r.left)+'..'+Math.round(r.right)+']')});
ROOT.querySelectorAll('*').forEach(e=>{if(!vis(e)||e.tagName==='CANVAS'||e.closest('#toast,nav,dialog')||!e.parentElement||inScroll(e))return;const cs=getComputedStyle(e);if(cs.position==='absolute'||cs.position==='fixed')return;const r=e.getBoundingClientRect(),p=e.parentElement.getBoundingClientRect(),pcs=getComputedStyle(e.parentElement);if(pcs.display==='contents'||e.parentElement.id==='app')return;if(r.right>p.right+1.5)out.push('escapes its parent by '+Math.round(r.right-p.right)+'px: '+tag(e)+' in '+tag(e.parentElement))});
const sel='button,input:not([type=hidden]):not([type=checkbox]),select,textarea,a.card,.links a,.brand,.foot a,a.btn,label.chk';
const els=[...ROOT.querySelectorAll(sel)].filter(vis);
if(W<=1024)els.forEach(e=>{if(e.tagName==='TEXTAREA')return;const r=e.getBoundingClientRect();if(r.height<43.5)out.push('tap target <44px: '+tag(e)+' '+Math.round(r.height)+'px')});
for(let i=0;i<els.length;i++)for(let j=i+1;j<els.length;j++){const a=els[i],b=els[j];if(a.contains(b)||b.contains(a))continue;const A=a.getBoundingClientRect(),B=b.getBoundingClientRect();const w=Math.min(A.right,B.right)-Math.max(A.left,B.left),h=Math.min(A.bottom,B.bottom)-Math.max(A.top,B.top);if(w>2&&h>2)out.push('overlap: '+tag(a)+' x '+tag(b))}
ROOT.querySelectorAll('*').forEach(e=>{if(!vis(e))return;for(const n of e.childNodes)if(n.nodeType===3&&n.textContent.trim()&&parseFloat(getComputedStyle(e).fontSize)<12){out.push('text <12px: '+tag(e));break}});
return [...new Set(out)].slice(0,6)})()"""
VPS=[(360,740),(375,667),(390,844),(414,896),(768,1024),(1024,768),(1366,768),(1920,1080)]
def tap(pg,sel,touch): (pg.tap if touch else pg.click)(sel)
def audit(pg,label): pr=pg.evaluate(AUDIT); check(label,not pr,pr)
def viewport(b,w,h,tag='chromium'):
    touch=w<=768
    ctx=b.new_context(viewport={'width':w,'height':h},is_mobile=touch and tag=='chromium',has_touch=touch,device_scale_factor=2 if w<=414 else 1)
    pg=ctx.new_page(); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e))); wire(pg); reset_state()
    pg.goto(URL,wait_until='domcontentloaded'); pg.wait_for_timeout(800)
    audit(pg,f'[{tag} {w}x{h}] intro screen: controls fit, tappable, no overlap')
    ic=pg.evaluate("(()=>{const r=document.getElementById('ic').getBoundingClientRect();return [Math.round(r.width),Math.round(r.height)]})()")
    check(f'[{tag} {w}] intro canvas fills the viewport',abs(ic[0]-w)<=1 and abs(ic[1]-h)<=2,ic)
    tap(pg,'#skip',touch); pg.wait_for_timeout(1700)
    if w<=1000:
        check(f'[{tag} {w}] menu is collapsed by default',pg.is_hidden('#menu') and pg.is_visible('#navbtn') and pg.is_visible('#mplay'))
        tap(pg,'#navbtn',touch); pg.wait_for_timeout(200); audit(pg,f'[{tag} {w}] navigation open: items fit, tappable')
        tap(pg,'#menu a[href="#gallery"]',touch); pg.wait_for_timeout(500)
        check(f'[{tag} {w}] choosing a link closes the menu and opens the page',pg.is_hidden('#menu') and pg.is_visible('#v-gallery'))
    else: check(f'[{tag} {w}] full nav visible on desktop',pg.is_visible('#menu') and pg.is_hidden('#navbtn'))
    for v in ['home','wishes','gallery','support','privacy','joy']:
        pg.evaluate(f"location.hash='#{v}'"); pg.wait_for_timeout(450)
        if v=='gallery': pg.wait_for_selector('#gal .ph'); pg.wait_for_timeout(300)
        if v=='wishes':
            pg.fill('#msg','Wishing you a very long and joyful Diwali full of light, sweets and laughter, from our family to yours today and always.'); pg.wait_for_timeout(200)
            r=pg.evaluate("(()=>{const r=document.getElementById('card').getBoundingClientRect();return [r.width,r.height,r.right,innerWidth]})()")
            check(f'[{tag} {w}] card preview fits, aspect preserved',r[2]<=r[3]+1 and abs(r[0]/r[1]-1080/1350)<.01,r)
        audit(pg,f'[{tag} {w}] #{v}: no overflow/overlap, tap targets, text size')
    # tickets with awkward long text
    pg.evaluate("location.hash='#support'"); pg.wait_for_timeout(300)
    for i,(cat,ti) in enumerate([('greeting_card','Card will not download'),('gallery','Gallery slow')]):
        pg.select_option('#tkcat',cat); pg.fill('#tktitle',ti+' '+'W'*60); pg.fill('#tkdesc','A'*90+' the page does not respond when I tap the button.'); pg.fill('#tkemail',('x'*40)+'@example.com'); pg.click('#tkgo'); pg.wait_for_function("document.getElementById('tks').innerText.includes('Tracking code')",timeout=8000)
        if i==0: audit(pg,f'[{tag} {w}] ticket success box (long ID/code) fits')
    t=state['tickets'][0]; pg.fill('#trno',t['ticket_no']); pg.fill('#trcode',t['code']); tap(pg,'#trf button',touch); pg.wait_for_timeout(400)
    check(f'[{tag} {w}] ticket status check works',('Open' in pg.inner_text('#trs')))
    audit(pg,f'[{tag} {w}] ticket status result fits')
    # admin
    pg.evaluate("location.hash='#admin'"); pg.wait_for_selector('#adlogin'); audit(pg,f'[{tag} {w}] admin login')
    pg.fill('#ademail','a@b.co'); pg.fill('#adpass','goodpass'); tap(pg,'#adlogin button',touch); pg.wait_for_selector('#addash:not([hidden])'); pg.wait_for_selector('#adlist .ph')
    audit(pg,f'[{tag} {w}] admin pending photos + stats + usage totals')
    check(f'[{tag} {w}] admin shows aggregate usage totals',('visits' in pg.inner_text('#adusage')) and ('greeting cards created' in pg.inner_text('#adusage')))
    tap(pg,'[data-act=approved]',touch); pg.wait_for_timeout(500)
    for t_,lab in [('approved','approved tab'),('reported','reported tab (empty)'),('tickets','tickets tab'),('history','history (table to cards)')]:
        tap(pg,f'#adtabs [data-t={t_}]',touch); pg.wait_for_timeout(700)
        if t_=='tickets': pg.wait_for_selector('#tlist .tk')
        audit(pg,f'[{tag} {w}] admin {lab}')
    check(f'[{tag} {w}] no uncaught JS errors',not errs,errs)
    ctx.close()

def phone_flows(b):
    w,h=390,844; tag='phone 390 (Chromium emulation)'
    ctx=b.new_context(viewport={'width':w,'height':h},is_mobile=True,has_touch=True,device_scale_factor=3,accept_downloads=True,permissions=['clipboard-read','clipboard-write'])
    ctx.add_init_script("window.__opens=[];window.open=u=>{__opens.push(u);return null};window.__shares=[];navigator.share=async d=>{__shares.push({text:d.text||'',url:d.url||'',files:(d.files||[]).length})};navigator.canShare=d=>true;")
    pg=ctx.new_page(); wire(pg); reset_state(); pg.goto(URL,wait_until='domcontentloaded'); pg.wait_for_timeout(500); pg.tap('#skip'); pg.wait_for_timeout(1700)
    check('analytics: exactly one visit event per session',state['events']==[{'event':'visit'}],state['events'])
    pg.reload(wait_until='domcontentloaded'); pg.wait_for_timeout(500); check('analytics: reload in same tab does not add a visit',len(state['events'])==1,state['events'])
    pg.tap('#skip'); pg.wait_for_timeout(1700)
    pg.tap('#navbtn'); check('mobile menu opens (aria-expanded)',pg.get_attribute('#navbtn','aria-expanded')=='true'); pg.tap('#menu a[href="#wishes"]'); pg.wait_for_timeout(400)
    check('mobile menu closes after navigation',pg.get_attribute('#navbtn','aria-expanded')=='false' and pg.is_visible('#v-wishes'))
    pg.fill('#to','ZzRecipientQ'); pg.fill('#from','ZzSenderQ'); pg.fill('#msg','ZzMessageQ')
    pg.tap('#themes button:nth-child(5)')
    with pg.expect_download() as d: pg.tap('#dl')
    check('phone: greeting PNG download',d.value.suggested_filename.endswith('.png'))
    pg.tap('#cp'); pg.tap('#wa'); check('phone: WhatsApp share opens wa.me',any('wa.me' in u for u in pg.evaluate('__opens')))
    check('phone: native share button shown when supported',pg.is_visible('#sh')); pg.tap('#sh'); pg.wait_for_timeout(500); sh=pg.evaluate('__shares')
    check('phone: native share sends card image file',len(sh)==1 and sh[0]['files']==1,sh)
    pg.evaluate("location.hash='#gallery'"); pg.wait_for_selector('#gal .ph')
    pg.tap('[data-sh] >> nth=0'); pg.wait_for_timeout(300); check('phone: gallery share',len(pg.evaluate('__shares'))==2 and '#gallery' in pg.evaluate('__shares')[1]['url'])
    check('phone: gallery download link present',pg.locator('#gal a[download]').count()==6)
    check('phone: gallery uses 2 columns',pg.evaluate("getComputedStyle(document.getElementById('gal')).columnCount")=='2')
    pg.tap('[data-rp] >> nth=1'); pg.select_option('#rreason','privacy'); pg.tap('#rsend'); pg.wait_for_timeout(300); check('phone: report works',state['reports'] and state['reports'][-1]['reason']=='privacy')
    # --- uploads: JPEG with EXIF, WebP, PNG; oversize + wrong type ---
    def mk(fmt,size,exif=False,noise=False):
        im=Image.effect_noise(size,80).convert('RGB') if noise else Image.linear_gradient('L').resize(size).convert('RGB')
        bio=_io.BytesIO(); kw={}
        if exif:
            ex=Image.Exif(); ex[0x010F]='TestCameraMaker'; ex[0x0112]=6; kw['exif']=ex.tobytes()
        im.save(bio,fmt,**kw); return bio.getvalue()
    def last(name): return [r for r in R if r[0]==name and r[1]=='POST'][-1][2].encode('latin1')
    def sent_image(raw):
        i=raw.find(b'\xff\xd8\xff'); return Image.open(_io.BytesIO(raw[i:])) if i>=0 else None
    pg.evaluate("document.getElementById('upf').scrollIntoView()")
    for fmt,mime,ext,exif in [('JPEG','image/jpeg','jpg',True),('WEBP','image/webp','webp',True),('PNG','image/png','png',False)]:
        data=mk(fmt,(3000,2000),exif); 
        if exif and fmt=='JPEG': assert b'TestCameraMaker' in data and b'Exif' in data
        pg.set_input_files('#pick',files=[{'name':'p.'+ext,'mimeType':mime,'buffer':data}]); pg.wait_for_selector('#pv:not([hidden])'); pg.check('#consent'); pg.tap('#upgo'); pg.wait_for_function("document.getElementById('ups').innerText.startsWith('Your beautiful')",timeout=8000)
        raw=last('upload-photo'); im=sent_image(raw)
        check(f'phone: {fmt} upload sent as re-encoded JPEG ≤2000px, no EXIF/camera data',im is not None and im.format=='JPEG' and max(im.size)<=2000 and not im.getexif() and b'TestCameraMaker' not in raw and b'RIFF' not in raw[:2000],(im.format,im.size) if im else None)
        check(f'phone: {fmt} upload success message',pg.inner_text('#ups').startswith('Your beautiful Diwali memory has been submitted!'))
    n0=len([r for r in R if r[0]=='upload-photo'])
    pg.set_input_files('#pick',files=[{'name':'big.png','mimeType':'image/png','buffer':mk('PNG',(2400,1800),noise=True)}]); pg.wait_for_timeout(500); check('phone: photo over 5 MB rejected before upload','5 MB' in pg.inner_text('#ups'))
    pg.set_input_files('#pick',files=[{'name':'x.gif','mimeType':'image/gif','buffer':b'GIF89a'}]); check('phone: GIF photo rejected','JPG, PNG or WebP' in pg.inner_text('#ups'))
    pg.evaluate("document.getElementById('upf').requestSubmit()"); check('phone: nothing uploaded for rejected files',len([r for r in R if r[0]=='upload-photo'])==n0)
    check('privacy notice + consent checkbox on upload form',pg.is_visible('.notice') and 'Location and camera data are removed' in pg.inner_text('.notice') and pg.is_visible('#consent'))
    pg.set_input_files('#pick',files=[{'name':'p.jpg','mimeType':'image/jpeg','buffer':mk('JPEG',(800,600))}]); pg.wait_for_selector('#pv:not([hidden])'); pg.tap('#upgo'); pg.wait_for_timeout(300)
    check('upload blocked without consent',len([r for r in R if r[0]=='upload-photo'])==n0 and 'permission' in pg.inner_text('#ups'))
    # --- ticket screenshots ---
    pg.evaluate("location.hash='#support'"); pg.wait_for_timeout(300)
    def ticket(files,expect_ok,label):
        pg.select_option('#tkcat','website_bug'); pg.fill('#tktitle','Screenshot test'); pg.fill('#tkdesc','Testing the screenshot attachment on a phone.')
        if files: pg.set_input_files('#tkfile',files=files)
        n=len(state['tickets']); pg.tap('#tkgo')
        if expect_ok: pg.wait_for_function("document.getElementById('tks').innerText.includes('Tracking code')",timeout=8000)
        else: pg.wait_for_timeout(1200)
        ok=len(state['tickets'])==n+1
        check(label,ok==expect_ok,pg.inner_text('#tks')); return ok
    for fmt,mime,ext in [('JPEG','image/jpeg','jpg'),('PNG','image/png','png'),('WEBP','image/webp','webp')]:
        ticket([{'name':'s.'+ext,'mimeType':mime,'buffer':mk(fmt,(1200,2400),fmt=='JPEG')}],True,f'phone: ticket {fmt} screenshot accepted')
        raw=last('ticket-submit'); im=sent_image(raw)
        check(f'phone: ticket {fmt} screenshot delivered to the server as JPEG (same rule for all formats)',im is not None and im.format=='JPEG' and not im.getexif() and b'RIFF' not in raw and b'\x89PNG' not in raw and 'screenshot' in state['tickets'][-1]['_fields'])
    ticket([{'name':'s.gif','mimeType':'image/gif','buffer':b'GIF89a'}],False,'phone: ticket GIF screenshot rejected'); pg.set_input_files('#tkfile',files=[])
    ticket([{'name':'big.png','mimeType':'image/png','buffer':mk('PNG',(1500,1100),noise=True)}],False,'phone: ticket screenshot over 3 MB rejected'); pg.set_input_files('#tkfile',files=[])
    ticket([],True,'phone: ticket without screenshot accepted')
    check('phone: ticket success shows DIWALI-YYYY-NNNN id and tracking code',bool(re.search(r'DIWALI-2026-\d{4}',pg.inner_text('#tks'))) and 'Tracking code' in pg.inner_text('#tks'))
    # --- analytics totals ---
    pg.evaluate("location.hash='#admin'"); pg.wait_for_selector('#adlogin'); pg.fill('#ademail','a@b.co'); pg.fill('#adpass','goodpass'); pg.tap('#adlogin button'); pg.wait_for_selector('#adusage:not(:empty)'); pg.wait_for_timeout(300)
    u=pg.inner_text('#adusage'); ev=[e['event'] for e in state['events']]
    check('analytics: events are exactly visit/card_created/share (no content)',all(set(e)=={'event'} for e in state['events']) and set(ev)<={'visit','card_created','share'},state['events'])
    check('analytics: admin totals match (visits 1, cards 2, shares 3)',('visits 1' in u) and ('cards created 2' in u) and ('shares 3' in u),u)
    check('privacy: greeting text never in any request or storage',not any(x in r[2] for r in R for x in ('ZzRecipientQ','ZzSenderQ','ZzMessageQ')) and not any(x in pg.evaluate('JSON.stringify(localStorage)+JSON.stringify(sessionStorage)') for x in ('ZzRecipientQ','ZzSenderQ','ZzMessageQ')))
    ctx.close()
    # Do Not Track
    c2=b.new_context(viewport={'width':390,'height':844}); c2.add_init_script("Object.defineProperty(navigator,'doNotTrack',{value:'1'})"); p2=c2.new_page(); wire(p2); reset_state(); p2.goto(URL,wait_until='domcontentloaded'); p2.wait_for_timeout(500); p2.click('#skip'); p2.wait_for_timeout(1700)
    p2.evaluate("location.hash='#wishes'"); p2.wait_for_timeout(200)
    with p2.expect_download(): p2.click('#dl')
    check('analytics: nothing counted when Do Not Track is on',state['events']==[],state['events']); c2.close()

with sync_playwright() as p:
    b=p.chromium.launch()
    for w,h in VPS: viewport(b,w,h)
    phone_flows(b); b.close()
    try:
        wk=p.webkit.launch(); print('\nWebKit available: running 390 and 414 audits'); 
        for w,h in [(390,844),(414,896)]: viewport(wk,w,h,'webkit')
        wk.close()
    except Exception as e: print('\nWEBKIT (Safari engine) NOT AVAILABLE in this sandbox:',str(e).split('\n')[0][:120])
srv.terminate(); print(f'\n{sum(results)}/{len(results)} passed'); sys.exit(0 if all(results) else 1)
