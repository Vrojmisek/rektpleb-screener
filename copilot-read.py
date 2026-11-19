"""Executed over the existing SSH connection. Read-only filesystem and SQLite access.
REQUEST is provided by the local server; this script is not installed on the VPS.
"""
import json, re, sqlite3, sys, time
from pathlib import Path

ROOT=Path(REQUEST['root'])
if not ROOT.is_absolute():raise ValueError('Copilot root must be an absolute path')
SCREENS=ROOT/'screenshots'
PATTERN=re.compile(r'^([A-Z0-9]+USDT)_(?:multi_)?(\d+)\.png$')

if REQUEST['mode']=='image':
    name=REQUEST['name']
    if not PATTERN.fullmatch(name):raise ValueError('Invalid image name')
    file=SCREENS/name
    if file.is_symlink() or not file.is_file() or file.stat().st_size>12*1024*1024:raise ValueError('Image unavailable')
    sys.stdout.buffer.write(file.read_bytes())
else:
    images={}
    for f in SCREENS.iterdir():
        m=PATTERN.fullmatch(f.name)
        if not m or f.is_symlink():continue
        stamp=int(m.group(2)); stamp=stamp/1000 if stamp>100000000000 else stamp
        images.setdefault(m.group(1),[]).append((stamp,f.name))
    connection=sqlite3.connect('file:'+str(ROOT/'data/copilot.db')+'?mode=ro',uri=True,timeout=4)
    connection.execute('PRAGMA query_only=ON')
    connection.row_factory=sqlite3.Row
    rows=connection.execute('SELECT id,ts,scanner,symbol,priority,payload FROM sent_log WHERE delivered=1 ORDER BY ts DESC,id DESC LIMIT 1200').fetchall()
    connection.close()
    labels={'pump_volume':'Volume impulse','earlypump':'Early pump','fastmove':'Fast move','derivatives':'OI / funding','ignition':'Ignition','vybuch':'Price impulse','fshort':'Funding','orderbook':'Order book','levels':'Key levels','sweep':'Liquidity sweep','sniper':'Sniper','exhaustion':'Exhaustion','probuzeni':'Awakening','hladky':'Trend','vyplach':'Flush'}
    out=[];used=set()
    for row in rows:
        candidates=[(abs(stamp-row['ts']),name,stamp)for stamp,name in images.get(row['symbol'],[])if row['ts']-30<=stamp<row['ts']+1 and name not in used]
        # The log has no attachment identity: ambiguous matches must be omitted.
        if len(candidates)!=1:continue
        distance,name,image_at=min(candidates)
        used.add(name)
        try:payload=json.loads(row['payload']or'{}')
        except (ValueError,TypeError):payload={}
        # Only known non-account alert metrics leave this process.
        metrics=[]
        for key,label,suffix in [('change_pct','Change','%'),('zmena','Change','%'),('oi_5m_pct','OI 5m','%'),('oi_1h_pct','OI 1h','%'),('volume_ratio','Volume','×'),('rvol','RVOL','×')]:
            value=payload.get(key)
            if isinstance(value,(int,float)) and not isinstance(value,bool):metrics.append('%s %+.2f%s'%(label,value,suffix))
        out.append({'id':str(row['id']),'symbol':row['symbol'],'scanner':row['scanner'],'label':labels.get(row['scanner'],row['scanner']),'priority':row['priority'],'sentAt':row['ts']*1000,'imageAt':int(image_at*1000),'file':name,'summary':' · '.join(metrics[:3]),'match':'timestamp','matchDeltaSeconds':round(distance,2)})
        if len(out)>=60:break
    print(json.dumps({'updatedAt':int(time.time()*1000),'items':out,'source':'TRADING COPILOT · VPS','matching':'Unique same-symbol saved screenshot from 30 seconds before to the same rounded send second. Ambiguous associations omitted; attachment identity is not recorded.'},ensure_ascii=False))
