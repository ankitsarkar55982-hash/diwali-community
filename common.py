import os, re, json, base64, subprocess, time, io
from playwright.sync_api import sync_playwright
from PIL import Image
import os; ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv=subprocess.Popen(['python3','-m','http.server','8765','--directory',ROOT],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(1)
R=[]; results=[]
def check(name,cond,extra=''):
    results.append(bool(cond)); print(('PASS ' if cond else 'FAIL ')+name+(' '+str(extra) if (extra and not cond) else ''))
buf=io.BytesIO(); Image.new('RGB',(300,200),(200,90,30)).save(buf,'PNG'); PNG=buf.getvalue()
PIX='data:image/png;base64,'+base64.b64encode(PNG).decode()
buf=io.BytesIO(); Image.new('RGB',(200,320),(40,120,200)).save(buf,'PNG'); PIXT='data:image/png;base64,'+base64.b64encode(buf.getvalue()).decode()
def fresh(): return {'tickets':[],'photos':[{'id':'11111111-1111-4111-8111-111111111111','status':'pending','created_at':'2026-11-02T10:00:00Z','url':PIX,'reports':[]}],'n':0,'reports':[],'events':[]}
state=fresh()
def reset_state():
    state.clear(); state.update(fresh()); R.clear()
URL='http://localhost:8765/index.html'
def fields(req):
    b=(req.post_data_buffer or b'').decode('latin1'); return dict(re.findall(r'name="(\w+)"(?:; filename="[^"]*")?\r\n(?:Content-Type: [^\r\n]+\r\n)?\r\n(.*?)\r\n--',b,re.S))
def wire(pg):
    pg.route('**/config.js',lambda r:r.fulfill(content_type='text/javascript',body=CFG)); pg.route('**/supabase.js',lambda r:r.fulfill(content_type='text/javascript',body=STUB))
    pg.route('https://test.supabase.co/**',fn); pg.route(re.compile(r'https://fonts\..*'),lambda r:r.abort())
def jr(route,obj,status=200): route.fulfill(status=status,content_type='application/json',headers={'access-control-allow-origin':'*','access-control-allow-headers':'*'},body=json.dumps(obj))
def fn(route,req):
    name=req.url.split('/functions/v1/')[1].split('?')[0]; R.append((name,req.method,(req.post_data_buffer or b'').decode('latin1')))
    if req.method=='OPTIONS': return route.fulfill(status=204,headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'})
    if name=='gallery': return jr(route,{'items':[{'id':'22222222-2222-4222-8222-22222222222%d'%i,'url':PIX if i%2==0 else PIXT,'dl':PIX,'created_at':'x'} for i in range(6)],'hasMore':True})
    if name=='track': state['events'].append(json.loads((req.post_data_buffer or b'{}').decode())); return jr(route,{'ok':True})
    if name=='upload-photo': return jr(route,{'ok':True})
    if name=='report-photo': state['reports'].append(json.loads((req.post_data_buffer or b'{}').decode())); return jr(route,{'ok':True})
    if name=='ticket-submit':
        f=fields(req)
        state['n']+=1; no=f'DIWALI-2026-{state["n"]:04d}'; code='tracking'+str(state['n'])*20
        state['tickets'].append({'id':'33333333-3333-4333-8333-33333333333%d'%state['n'],'ticket_no':no,'code':code,'name':f.get('name') or None,'email':f.get('email') or None,'category':f['category'],'title':f['title'],'description':f['description'],'status':'open','admin_notes':'','created_at':'2026-11-03T09:00:00Z','updated_at':'2026-11-03T09:00:00Z','attachment_url':PIX if 'screenshot' in f else None,'_fields':f})
        return jr(route,{'ok':True,'ticket_no':no,'tracking_code':code})
    if name=='ticket-status':
        b=json.loads((req.post_data_buffer or b'{}').decode()); t=next((t for t in state['tickets'] if t['ticket_no']==b['ticket_no'] and t['code']==b['tracking_code']),None)
        return jr(route,{'error':'Ticket not found, or the tracking code is incorrect.'},404) if not t else jr(route,{'ticket_no':t['ticket_no'],'status':t['status'],'category':t['category'],'title':t['title'],'created_at':t['created_at'],'updated_at':t['updated_at']})
    if name=='admin':
        if req.headers.get('authorization')!='Bearer tok': return jr(route,{'error':'Unauthorized'},401)
        b=json.loads((req.post_data_buffer or b'{}').decode()); a=b['action']
        if a=='me': return jr(route,{'ok':True})
        ev=[e['event'] for e in state['events']]
        if a=='stats': return jr(route,{'counters':{'visits':ev.count('visit'),'cards_created':ev.count('card_created'),'shares':ev.count('share'),'photo_submissions':len([r for r in R if r[0]=='upload-photo' and r[1]=='POST']),'ticket_submissions':len(state['tickets'])},'pending':len([p for p in state['photos'] if p['status']=='pending']),'approved':0,'rejected':0,'deleted':0,'openReports':0,'last24h':1,'openTickets':len(state['tickets'])})
        if a=='list': return jr(route,{'photos':[p for p in state['photos'] if p['status']==b['status']]})
        if a=='moderate': next(p for p in state['photos'] if p['id']==b['id'])['status']=b['to']; return jr(route,{'ok':True})
        if a=='tickets_list':
            ts=[{k:v for k,v in t.items() if k not in('code','_fields')} for t in state['tickets'] if (not b.get('status') or t['status']==b['status']) and (not b.get('category') or t['category']==b['category']) and (not b.get('q') or b['q'].upper() in t['ticket_no'])]
            return jr(route,{'tickets':ts})
        if a=='ticket_update':
            t=next(t for t in state['tickets'] if t['id']==b['id']); t['status']=b.get('status',t['status']); t['admin_notes']=b.get('notes',t['admin_notes']); return jr(route,{'ok':True})
        if a=='ticket_delete': state['tickets']=[t for t in state['tickets'] if t['id']!=b['id']]; return jr(route,{'ok':True})
        if a=='history': return jr(route,{'logs':[{'photo_id':'x','action':'approved','prev_status':'pending','new_status':'approved','created_at':'2026-11-03T08:00:00Z'},{'photo_id':'y','action':'dismiss_reports','prev_status':None,'new_status':None,'created_at':'2026-11-03T07:00:00Z'}]})
    jr(route,{'error':'x'},400)
STUB="""window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:window.__s||null}}),signInWithPassword:async(c)=>{if(c.password==='goodpass'){window.__s={access_token:'tok'};return{error:null}}return{error:{message:'bad'}}},signOut:async()=>{window.__s=null}}})};"""
CFG="window.APP_CONFIG={SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'x'.repeat(40)};"
