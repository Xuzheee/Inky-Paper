from pathlib import Path
import base64, html, json

D = Path(__file__).parent
pet = 'data:image/png;base64,' + base64.b64encode((D/'inky-paper-mascot.png').read_bytes()).decode()
P='#FAF8F2'; INK='#30332F'; MUT='#686C63'; LINE='#DDDCD2'; GREEN='#52634F'; SAGE='#E7ECDD'
def text(x,y,s,size=12,color=INK,weight=400,extra=''):
    return f'<text x="{x}" y="{y}" fill="{color}" font-size="{size}" font-weight="{weight}" font-family="Noto Sans SC, Microsoft YaHei, sans-serif" {extra}>{html.escape(s)}</text>'
def rect(x,y,w,h,fill=P,r=8,stroke='none'):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}" stroke="{stroke}"/>'
def fish(x,y,s): return f'<image x="{x}" y="{y}" width="{s}" height="{s}" href="{pet}"/>'
def button(x,y,w,label,action,primary=False):
    return f'<g data-action="{action}" role="button" tabindex="0" aria-label="{label}">'+rect(x,y,w,32,GREEN if primary else SAGE,6)+text(x+w/2,y+21,label,12,'#FFFFFF' if primary else GREEN,500,'text-anchor="middle"')+'</g>'
def minimize():
    return '<g data-action="mini" role="button" tabindex="0" aria-label="收起为迷你宠物">'+rect(284,6,28,28,P,6)+f'<path d="M304 12l-6 6m0-5v5h5m-13 8 6-6m-5 0h5v5" stroke="{MUT}" stroke-width="1.4" fill="none" stroke-linecap="round"/></g>'
def wrap(body,w,h,label): return f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" aria-label="{label}"><title>{label}</title>{body}</svg>'
def focus(paused=False):
    b=rect(.5,.5,319,127,P,10,LINE)+text(12,26,'完成 Inky Paper 界面方案',14)+minimize()
    b+=f'<text x="12" y="76" fill="{INK}" font-family="Arial,sans-serif" font-size="36" letter-spacing="-.8" data-timer="true">18:42</text>'+fish(166,39,44)
    b+=button(236,45,72,'继续' if paused else '暂停','continue' if paused else 'pause',paused)
    b+=text(12,108,'停一会儿，回来接着做' if paused else '25 分钟 · 专注中',11,MUT)
    b+='<g data-action="capture" role="button" tabindex="0" aria-label="随手记">'+rect(240,87,68,28,P,4)+text(247,108,'＋ 随手记',11,MUT)+'</g>'
    b+=rect(12,119,296,2,LINE,1)+rect(12,119,74,2,MUT if paused else GREEN,1)
    return wrap(b,320,128,'暂停的专注便签' if paused else '专注中的便签')
def done():
    b=rect(.5,.5,319,205,P,10,LINE)+text(16,32,'这一段，完成了',18,INK,500)+text(16,55,'已专注 25 分钟',12,MUT)+fish(260,12,44)
    b+=text(16,88,'完成 Inky Paper 界面方案',14)
    b+=button(16,106,288,'再专注一段','again',True)+button(16,150,138,'完成任务','complete')+button(166,150,138,'先休息','rest')
    return wrap(b,320,206,'专注本轮结束')
def mini():
    return wrap('<g data-action="restore" role="button" tabindex="0" aria-label="回到本次专注">'+rect(.5,.5,159,159,P,14,LINE)+fish(16,5,128)+text(80,145,'18:42 · 专注中',12,GREEN,400,'text-anchor="middle" data-mini-time="true"')+'</g>',160,160,'专注中的迷你宠物')
states={'running':focus(),'paused':focus(True),'done':done(),'mini':mini()}
for k,v in states.items(): (D/f'inky-paper-focus-{k}.svg').write_text(v,encoding='utf-8')
def embed(svg,x,y): return f'<g transform="translate({x} {y})">'+svg+'</g>'
b=rect(0,0,1120,740,'#F2EFE7',0)+text(48,54,'INKY PAPER / FOCUS',12,GREEN,500)+text(48,104,'只留一件事，安静往前走。',30,INK,500)
b+=text(48,139,'一张轻薄的专注便签，留住任务、时间和安静的陪伴。',14,MUT)
for x,title,key in [(48,'01  /  专注中','running'),(400,'02  /  暂停','paused'),(752,'03  /  这一段结束','done')]:
    b+=text(x,197,title,15,INK,500)+embed(states[key],x,220)
b+=text(48,378,'320 × 128 · 任务、时间、暂停',12,MUT)+text(48,400,'灵感先记下来，专注继续。',12,MUT)
b+=text(400,378,'暂停保留剩余时间与任务',12,MUT)+text(400,400,'回来继续，不催促、不扣分。',12,MUT)
b+=text(752,456,'本轮结束，由你决定下一步。',12,MUT)
b+=rect(48,490,1024,1,LINE,0)+embed(states['mini'],48,524)+text(240,555,'收起界面，陪伴还在。',20,INK,500)
b+=text(240,588,'收起为迷你宠物后计时继续，点击小鱼回到本次专注。',14,MUT)+text(240,615,'空闲时回到任务主界面；计时结束不会自动完成任务。',14,MUT)+text(240,652,'手绘小鱼保留。等级、经验条和升级奖励移除。',12,GREEN)
b+=text(48,716,'DESIGN STUDY  ·  2026.09     /     计时结束 ≠ 任务完成',10,MUT)
board=wrap(b,1120,740,'Inky Paper 专注便签设计总览')
(D/'inky-paper-focus-overview.svg').write_text(board,encoding='utf-8')
page='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Inky Paper · 专注便签设计稿</title><style>
:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#f2efe7;color:#30332f;font-family:"Noto Sans SC","Microsoft YaHei",sans-serif}main{max-width:1120px;margin:auto}.overview>svg{width:100%;height:auto;display:block}h2{font-size:22px;font-weight:500;margin:0 0 10px}p{font-size:13px;color:#686c63;line-height:1.8}section{border-top:1px solid #ddddd2;margin:0 48px;padding:36px 0}.demo-layout{display:flex;gap:64px;align-items:flex-start}.controls{max-width:480px;flex:1}button,a.link{border:1px solid #dddcd2;background:#faf8f2;color:#52634f;border-radius:6px;padding:8px 12px;font:inherit;font-size:12px;cursor:pointer;text-decoration:none;display:inline-block}button:hover,a.link:hover{background:#e7ecdd}button:focus-visible,[role=button]:focus-visible,input:focus-visible{outline:2px solid #52634f;outline-offset:2px}[role=button]{cursor:pointer}#stage{min-height:230px;width:320px;flex-shrink:0}.controls>div{display:flex;flex-wrap:wrap;gap:8px}#notice{min-height:24px}#capture{margin:12px 0;padding:12px;background:#faf8f2;border-radius:8px;border:1px solid #dddcd2;width:320px}#capture label{font-size:12px}input{margin:8px 0;width:100%;padding:8px;border:1px solid #dddcd2;border-radius:4px;background:#faf8f2}#notes{font-size:12px;line-height:1.8;padding-left:18px;word-break:break-word}footer{padding:0 48px 40px;font-size:12px;color:#686c63}#stage img{width:320px}#stage .return{margin-top:8px}#stage svg{display:block}@media(max-width:720px){section{margin:0 20px}.demo-layout{flex-direction:column;gap:20px}.overview{overflow:auto}.overview>svg{min-width:940px}footer{padding:0 20px 30px}}
</style><main><div class="overview">__BOARD__</div><section><div class="demo-layout"><div><div id="stage"></div><form id="capture" hidden><label for="note">先记下来，稍后再处理</label><input id="note" maxlength="160" placeholder="一闪而过的想法…" autocomplete="off"><button type="submit">记下</button> <button type="button" id="dismiss">收起</button><ul id="notes"></ul></form></div><div class="controls"><h2>试一试专注便签</h2><p>点击便签内的暂停、继续或右上角收起。迷你模式会保留当前进度，点击小鱼回到便签。</p><div><button data-preview="running">专注中</button><button data-preview="paused">暂停</button><button data-preview="done">预览本轮结束</button><button data-preview="mini">迷你宠物</button></div><p id="notice" aria-live="polite"></p><p>这是独立设计演示。计时和随手记仅在本页临时运行，不会修改 Inky 的真实任务；刷新即重置。</p></div></div></section><section><h2>设计交付</h2><p>SVG 包含独立图形、文本与小鱼图片，可导入 Figma 后继续编辑。导入效果与字体替换需在 Figma 中复核；不会自动生成组件、自动布局或原型连线。</p><div><a class="link" href="inky-paper-focus-overview.svg" download>下载整版 SVG</a> <a class="link" href="inky-paper-focus-running.svg" download>专注中</a> <a class="link" href="inky-paper-focus-paused.svg" download>暂停</a> <a class="link" href="inky-paper-focus-done.svg" download>本轮结束</a> <a class="link" href="inky-paper-focus-mini.svg" download>迷你宠物</a></div></section><footer>延续已有 Inky Paper 配色与角色。长任务名称最多两行，便签随内容向下增高；完整名称通过提示查看。静态设计以单行标题为例。</footer></main><script>
const states=__STATES__;let state='running',resumeState='running',seconds=1122;const stage=document.querySelector('#stage');const notice=document.querySelector('#notice');const capture=document.querySelector('#capture');
function time(){return String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0')}
function render(){stage.innerHTML=states[state]||'<img src="inky-paper-main.png" alt="Inky Paper 主界面视觉参考"><button class="return" data-action="again">返回专注演示</button>';sync();}
function sync(){stage.querySelectorAll('[data-timer]').forEach(n=>n.textContent=time());stage.querySelectorAll('[data-mini-time]').forEach(n=>n.textContent=time()+' · '+(resumeState==='paused'?'已暂停':'专注中'));}
function show(s){state=s;capture.hidden=true;notice.textContent='';render()}
document.addEventListener('click',e=>{const preview=e.target.closest('[data-preview]');if(preview){if(preview.dataset.preview==='mini')resumeState='running';show(preview.dataset.preview);return}const target=e.target.closest('#stage [data-action]');if(!target)return;const a=target.dataset.action;if(a==='pause')show('paused');if(a==='continue')show('running');if(a==='mini'){resumeState=state;show('mini')}if(a==='restore')show(resumeState);if(a==='again'){seconds=1500;show('running')}if(a==='capture'){capture.hidden=!capture.hidden;if(!capture.hidden)document.querySelector('#note').focus()}if(a==='complete'||a==='rest'){show('main');notice.textContent=a==='complete'?'演示：选择完成任务，回到主界面。真实任务未修改。':'演示：先休息，任务保持未完成。'}});
document.addEventListener('keydown',e=>{if(e.target.matches('#stage [role=button]')&&(e.key==='Enter'||e.key===' ')){e.preventDefault();e.target.dispatchEvent(new MouseEvent('click',{bubbles:true}))}});
capture.addEventListener('submit',e=>{e.preventDefault();const input=document.querySelector('#note');if(!input.value.trim())return;const li=document.createElement('li');li.textContent=input.value.trim();document.querySelector('#notes').append(li);input.value='';notice.textContent='已临时记下，专注继续。'});document.querySelector('#dismiss').onclick=()=>capture.hidden=true;
setInterval(()=>{if(state==='running'||(state==='mini'&&resumeState==='running')){seconds=Math.max(0,seconds-1);if(seconds===0)show('done');else sync()}},1000);render();
</script></html>'''.replace('__BOARD__',board).replace('__STATES__',json.dumps(states,ensure_ascii=False))
(D/'inky-paper-focus-preview.html').write_text(page,encoding='utf-8')
print('Created focus overview, four SVG states and interactive preview.')
