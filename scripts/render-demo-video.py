#!/usr/bin/env python3
"""Render Accord's factual, motion-designed demo from a recorded live auction.
No browser automation. All offer values come from the stored live GPT run.
"""
from pathlib import Path
import json, math, subprocess, argparse
from functools import lru_cache
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts/demo-video'
DATA = json.loads((ROOT/'test-results/dating-consumer-sandbox.json').read_text())
A = DATA['auction']
W,H,FPS,DURATION=1920,1080,24,78
BG='#F4F0E8'; INK='#282824'; MUTED='#77766E'; LINE='#D9D4CB'; CORAL='#EF6D55'; WHITE='#FFFCF6'; GREEN='#416E54'
FONTROOT=Path('/System/Library/Fonts/Supplemental')
@lru_cache(maxsize=200)
def font(size,kind='sans'):
    names={'sans':'Arial.ttf','bold':'Arial Bold.ttf','serif':'Baskerville.ttc','mono':'Andale Mono.ttf'}
    return ImageFont.truetype(str(FONTROOT/names[kind]),int(size))
def clamp(x):return max(0,min(1,x))
def ease(x):x=clamp(x);return 1-(1-x)**3
def money(c):return f'${c/100:.2f}'
def text(d,xy,s,size=28,fill=INK,kind='sans',anchor=None):
    d.text(xy,str(s),font=font(size,kind),fill=fill,anchor=anchor)
def wrap(s,size,width,kind='sans'):
    f=font(size,kind); lines=[];cur=''
    for word in s.split():
        trial=(cur+' '+word).strip()
        if f.getlength(trial)>width and cur:lines.append(cur);cur=word
        else:cur=trial
    if cur:lines.append(cur)
    return lines
def paragraph(d,xy,s,size=28,width=700,fill=INK,kind='sans',spacing=1.3,maxlines=None):
    for i,line in enumerate(wrap(s,size,width,kind)[:maxlines]):text(d,(xy[0],xy[1]+i*size*spacing),line,size,fill,kind)
def line(d,xy,fill=LINE,width=2):d.line(xy,fill=fill,width=width)
def pill(d,xy,s,fill=CORAL,color=WHITE,size=19):
    tw=font(size,'mono').getlength(s);x,y=xy
    d.rounded_rectangle((x,y,x+tw+32,y+38),radius=19,fill=fill);text(d,(x+16,y+7),s,size,color,'mono')
def arrow(d,x1,y1,x2,y2,color=CORAL,width=4):
    line(d,(x1,y1,x2,y2),color,width); ang=math.atan2(y2-y1,x2-x1)
    pts=[(x2,y2),(x2-15*math.cos(ang-.5),y2-15*math.sin(ang-.5)),(x2-15*math.cos(ang+.5),y2-15*math.sin(ang+.5))];d.polygon(pts,fill=color)
def header(d,t,section):
    text(d,(72,40),'accord',48,INK,'serif');text(d,(264,60),'THE AGENT EXCHANGE',17,MUTED,'mono')
    text(d,(1848,57),'RECORDED LIVE GPT RUN  ·  STRIPE SANDBOX',17,MUTED,'mono',anchor='ra')
    line(d,(72,110,1848,110));text(d,(72,1023),section.upper(),17,MUTED,'mono')
    text(d,(1848,1023),f'{int(t)//60:02}:{int(t)%60:02} / 01:18',17,MUTED,'mono',anchor='ra')
    d.rectangle((72,1060,1848,1063),fill=LINE);d.rectangle((72,1060,72+1776*t/DURATION,1063),fill=CORAL)
def title(d,kicker,headline,y=170,size=82):
    text(d,(90,y),kicker,19,CORAL,'mono');text(d,(86,y+40),headline,size,INK,'serif')
ASSETS={}
for name in ['consumer','exchange','receipt']:
    p=OUT/f'{name}.png'
    if p.exists():ASSETS[name]=Image.open(p).convert('RGB')
def screenshot(im,name,box,progress=1,crop=None):
    if name not in ASSETS:return
    src=ASSETS[name]
    if crop:src=src.crop(crop)
    x,y,w,h=box;sc=min(w/src.width,h/src.height)
    img=src.resize((int(src.width*sc),int(src.height*sc)),Image.Resampling.LANCZOS)
    x=int(x+(w-img.width)/2);y=int(y+(h-img.height)/2+26*(1-ease(progress)))
    d=ImageDraw.Draw(im);d.rounded_rectangle((x-12,y-12,x+img.width+12,y+img.height+12),radius=18,fill='#DDD8CF')
    im.paste(img,(x,y))
def chat_bubble(d,box,s,t,delay,who='YOU',coral=False):
    p=ease((t-delay)/.65)
    if not p:return
    x,y,w,h=box;y+=int((1-p)*35)
    d.rounded_rectangle((x,y,x+w,y+h),radius=24,fill=('#F9DBD1' if coral else WHITE))
    text(d,(x+28,y+23),who,17,CORAL if coral else MUTED,'mono')
    revealed=s[:max(0,int((t-delay)*75))]
    paragraph(d,(x+28,y+61),revealed,32,w-56)
def intro(im,d,t):
    p=ease(t/1.2); off=(1-p)*60
    text(d,(90,205+off),'RECOMMENDATIONS, NEGOTIATED.',22,CORAL,'mono')
    text(d,(82,270+off),'The highest bidder',116,INK,'serif')
    text(d,(82,405+off),'shouldn’t always win.',116,INK,'serif')
    paragraph(d,(92,592),'Brands compete on what they pay the app\nand what they give the person.',37,1100)
    y=810
    for i,(a,b) in enumerate([('BID','Publisher value'),('DISCOUNT','Customer value'),('FIT','Personal relevance')]):
        x=92+i*578;line(d,(x,y,x+510,y));text(d,(x,y+25),a,22,CORAL,'mono');text(d,(x,y+70),b,36,INK,'serif')
    # Moving exchange signal, not simulated product activity.
    for j in range(5):
        x=1490+j*58;h=50+85*math.sin(t*.65+j*.6)**2
        d.rounded_rectangle((x,410-h,x+30,510+h),radius=15,fill=CORAL if j==2 else '#DCD5CA')
def consumer(im,d,t):
    title(d,'01 / A MOMENT OF INTENT','A match. Then a coffee date.',size=76)
    screenshot(im,'consumer',(890,355,940,565),t/.8)
    chat_bubble(d,(90,360,720,205),'We matched and want specialty coffee for two in San Francisco.',t,.1,coral=True)
    chat_bubble(d,(90,590,720,205),'A casual first date. A good deal. A place we can enjoy together.',t,2.8)
    if t>6:pill(d,(100,854),'REQUEST SENT TO ACCORD',GREEN)
def architecture(im,d,t):
    title(d,'02 / ONE SHARED EXCHANGE','Three apps. One transaction rail.',size=76)
    apps=[('Wavelength','Dating'),('Thread','Shopping'),('Roam','Outings')]
    for i,(name,sub) in enumerate(apps):
        y=375+i*160;d.rounded_rectangle((92,y,565,y+123),radius=16,fill=WHITE);text(d,(123,y+21),name,40,INK,'serif');text(d,(125,y+77),sub.upper(),17,MUTED,'mono')
        arrow(d,565,y+61,900,604,LINE,3)
    d.rounded_rectangle((902,432,1360,775),radius=24,fill=INK)
    text(d,(949,474),'accord',74,WHITE,'serif');text(d,(952,583),'PERSONALIZE',22,'#DBCAB8','mono');text(d,(952,630),'NEGOTIATE',22,'#DBCAB8','mono');text(d,(952,677),'SETTLE',22,'#DBCAB8','mono')
    for i,name in enumerate(['Blue Bottle','Sightglass','Ritual']):
        y=394+i*175;arrow(d,1360,604,1475,y+46,LINE,3);d.rounded_rectangle((1475,y,1816,y+97),radius=14,fill=WHITE);text(d,(1500,y+26),name,34,INK,'serif')
    p=(t%2.7)/2.7;x=565+(902-565)*p;y=436+(604-436)*p;d.ellipse((x-10,y-10,x+10,y+10),fill=CORAL)
    pill(d,(91,912),'FIT ASSESSED BEFORE BIDS · FROZEN FOR THIS AUCTION',fill='#E5DFD4',color=INK)
BRANDS=['blue-bottle','sightglass','ritual']
NAMES={'blue-bottle':'Blue Bottle','sightglass':'Sightglass','ritual':'Ritual'}
ROUND_NOTES=[
    'Sightglass opens with the strongest user value.',
    'Blue Bottle takes the lead with a $2.00 discount.',
    'Ritual raises its discount to $3.50 and moves ahead.',
    'Sightglass counters with $5.20 off. The lead changes again.',
    'Ritual’s $4.50 discount and stronger fit win the final round.'
]
def rounds(im,d,t):
    n=min(4,int(t/4));local=t-n*4;r=A['rounds'][n];prev=A['rounds'][max(0,n-1)]
    title(d,f'03 / NEGOTIATION · ROUND {n+1} OF 5','Agents improve the offer.',size=80)
    text(d,(1808,236),f'{n+1:02}',98,CORAL,'serif',anchor='ra')
    for i,b in enumerate(BRANDS):
        o=next(o for o in r['offers'] if o['brand_id']==b);old=next(o for o in prev['offers'] if o['brand_id']==b)
        x=90+i*590;y=363;leader=b==r['leader_id'];p=ease(local/.85)
        d.rounded_rectangle((x,y,x+560,848),radius=16,fill=WHITE,outline=CORAL if leader else LINE,width=3 if leader else 2)
        text(d,(x+30,y+32),NAMES[b],44,INK,'serif')
        text(d,(x+32,y+95),f"FIT {o['fit_score']}/100 · FIXED",18,MUTED,'mono')
        if leader:pill(d,(x+30,y+133),'USER-VALUE LEADER',CORAL,size=17)
        vals={k:old[k]+(o[k]-old[k])*p for k in ['bid_cents','discount_cents','effective_price_cents']}
        text(d,(x+32,y+209),'AD BID / CLICK',18,MUTED,'mono');text(d,(x+32,y+240),money(vals['bid_cents']),57,INK,'serif')
        text(d,(x+296,y+209),'CUSTOMER SAVES',18,MUTED,'mono');text(d,(x+294,y+240),money(vals['discount_cents']),57,CORAL,'serif')
        line(d,(x+30,y+320,x+530,y+320))
        text(d,(x+32,y+342),'EFFECTIVE PRICE',18,MUTED,'mono');text(d,(x+32,y+377),money(vals['effective_price_cents']),50,INK,'serif')
        text(d,(x+308,y+342),'USER SCORE',18,MUTED,'mono');text(d,(x+306,y+383),f"{o['user_score']:.3f}",42,INK,'mono')
        d.rounded_rectangle((x+30,866,x+560-30,878),radius=6,fill=LINE)
        d.rounded_rectangle((x+30,866,x+30+500*o['user_score']/100,878),radius=6,fill=CORAL if leader else '#A39B8E')
    text(d,(94,915),ROUND_NOTES[n],29,INK,'sans')
    if n==3:text(d,(94,962),'Blue Bottle’s invalid revision was rejected; its prior valid offer stayed unchanged.',19,MUTED,'mono')
    else:text(d,(94,962),'Completed rounds from the recorded run · Display timing slowed for clarity',19,MUTED,'mono')
    for k in range(5):d.ellipse((1635+k*34,955,1650+k*34,970),fill=CORAL if k<=n else LINE)
def winner(im,d,t):
    title(d,'04 / THE SIGNATURE MOMENT','Less ad spend. More user value.',size=84)
    x1,x2=90,1020;y=372
    for x,name,bid,discount,score,win in [(x1,'Blue Bottle','$1.80','$2.00','55.400',False),(x2,'Ritual','$0.90','$4.50','60.450',True)]:
        d.rounded_rectangle((x,y,x+810,y+355),radius=20,fill=CORAL if win else WHITE)
        color=WHITE if win else INK;muted='#FFDFD2' if win else MUTED
        text(d,(x+38,y+29),'SELECTED BY THE USER AGENT' if win else 'HIGHEST CASH BID',18,muted,'mono')
        text(d,(x+35,y+75),name,62,color,'serif');text(d,(x+36,y+169),bid,85,color,'serif')
        text(d,(x+40,y+270),f'AD BID   ·   {discount} CUSTOMER DISCOUNT',20,muted,'mono')
    text(d,(92,777),'60% personal fit  +  40% price score',46,INK,'serif')
    text(d,(95,849),'RITUAL 60.450   /   SIGHTGLASS 60.425   /   BLUE BOTTLE 55.400',21,MUTED,'mono')
    text(d,(95,910),'Cash is only a tie-breaker. Personal fit can also beat the lowest price.',29,INK)
def recommendation(im,d,t):
    title(d,'05 / BACK TO THE CONSUMER','The winning deal comes home.',size=80)
    screenshot(im,'consumer',(1005,376,810,485),t/.75)
    d.rounded_rectangle((90,370,915,882),radius=24,fill=WHITE,outline=LINE,width=2)
    pill(d,(124,403),'WINNING RECOMMENDATION',GREEN)
    text(d,(121,465),'Ritual · Mission café',57,INK,'serif');text(d,(126,541),'Two coffees for your first date.',29,MUTED)
    text(d,(124,608),'$16.00',40,MUTED,'serif');line(d,(123,633,243,633),MUTED,2);text(d,(276,591),'$11.50',80,CORAL,'serif')
    d.rounded_rectangle((124,713,872,808),radius=12,fill='#EDE7DD');text(d,(148,729),'DEMO CODE',15,MUTED,'mono');text(d,(148,759),'RITUAL-DEMO',30,INK,'mono')
    text(d,(127,837),'$4.50 negotiated savings · Illustrative code',22,MUTED)
    text(d,(1008,894),'ACTUAL CONSUMER APP',17,MUTED,'mono')
def payments(im,d,t):
    title(d,'06 / A REAL SANDBOX TRANSACTION','One click. A settled payment.',size=80)
    cards=[(90,'RITUAL PAYS','$0.90',INK),(680,'WAVELENGTH EARNS','$0.72',CORAL),(1270,'ACCORD GROSS','$0.18',INK)]
    for i,(x,label,amount,color) in enumerate(cards):
        p=ease((t-i*.35)/.7);y=364+int(30*(1-p));d.rounded_rectangle((x,y,x+555,y+216),radius=18,fill=WHITE)
        text(d,(x+29,y+28),label,18,MUTED,'mono');text(d,(x+24,y+76),amount,88,color,'serif')
    screenshot(im,'receipt',(93,642,1170,270),1,crop=(316,195,1400,645))
    text(d,(1320,656),'80 / 20',60,INK,'serif');paragraph(d,(1324,739),'Publisher / network\nVerified Stripe test transfer\nOne charge, even on repeat clicks',24,480)
    text(d,(97,935),'VERIFIED TRANSFER  tr_3UKlbYAXV45EOxtS2U9yb5LB',18,MUTED,'mono')
    text(d,(97,973),'Demo discounts create no cashback liability. Processing fees remain separate.',19,MUTED)
def close(im,d,t):
    title(d,'07 / BUILT TO CONNECT','The exchange is the product.',size=87)
    screenshot(im,'exchange',(92,365,1160,620),t/.8)
    text(d,(1330,384),'Four live servers.',45,INK,'serif')
    for i,(name,sub) in enumerate([('Wavelength','Dating'),('Thread','Shopping'),('Roam','Outings')]):
        y=487+i*106;line(d,(1330,y-14,1810,y-14));text(d,(1330,y),name,37,INK,'serif');text(d,(1334,y+50),sub.upper(),17,MUTED,'mono')
    paragraph(d,(1333,827),'Brands negotiate.\nPeople get better offers.\nApps get paid.',30,480,fill=CORAL,kind='serif')
SCENES=[(0,7,intro,'The thesis'),(7,16,consumer,'Intent'),(16,23,architecture,'Infrastructure'),(23,43,rounds,'Agent negotiation'),(43,52,winner,'User value wins'),(52,60,recommendation,'The recommendation'),(60,70,payments,'CPC settlement'),(70,78,close,'Accord')]
def frame(t):
    im=Image.new('RGB',(W,H),BG);d=ImageDraw.Draw(im)
    s=next(s for s in SCENES if s[0]<=t<s[1]);s[2](im,d,t-s[0]);header(ImageDraw.Draw(im),t,s[3])
    # Quick editorial reveal: transition moves away, never creates fake offer changes.
    dt=t-s[0]
    if s[0] and dt<.32:
        edge=int(W*(1-ease(dt/.32)));d=ImageDraw.Draw(im);d.rectangle((0,113,edge,1002),fill=BG)
    return im

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--preview-only',action='store_true');args=ap.parse_args();OUT.mkdir(parents=True,exist_ok=True)
    times=[3,13,20,25,29,33,37,41,47,57,66,75]
    sheet=Image.new('RGB',(1280,360*math.ceil(len(times)/2)),BG)
    for i,t in enumerate(times):
        img=frame(t);img.save(OUT/f'scene-{i+1:02}.png');thumb=img.resize((640,360),Image.Resampling.LANCZOS);sheet.paste(thumb,((i%2)*640,(i//2)*360))
    sheet.save(OUT/'contact-sheet.jpg',quality=90);frame(47).save(OUT/'poster.png')
    if args.preview_only:return
    target=OUT/'Accord-demo-silent.mp4'
    cmd=['/opt/local/bin/ffmpeg','-y','-hide_banner','-loglevel','error','-f','rawvideo','-vcodec','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','-','-an','-c:v','libx264','-preset','ultrafast','-crf','19','-pix_fmt','yuv420p','-movflags','+faststart',str(target)]
    proc=subprocess.Popen(cmd,stdin=subprocess.PIPE)
    try:
        for i in range(DURATION*FPS):
            proc.stdin.write(frame(i/FPS).tobytes())
            if i%(FPS*5)==0:print(f'Rendered {i/FPS:.0f}/{DURATION}s',flush=True)
    finally:proc.stdin.close()
    if proc.wait():raise RuntimeError('ffmpeg failed')
    print(target,flush=True)
if __name__=='__main__':main()
