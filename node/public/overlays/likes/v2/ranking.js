const crown = '<svg viewBox="0 0 48 36" aria-hidden="true"><path d="M5 8 15 18 24 3 33 18 43 8 39 31H9Z"/></svg>';
const heart = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 29 3 16C-5 7 7-3 16 6c9-9 21 1 13 10Z"/></svg>';
const params=new URLSearchParams(location.search);
const token=params.get('tk') || localStorage.getItem('token');
let count=5;
const root=document.querySelector('[data-ranking]');
const version='v2';
let previousOrder='';
let currentRanking=[];
function applyOverlayLayout(layout){
 if(!layout||typeof layout!=='object')return;
 const isDemo=params.get('demo')==='1';
 const placement=root.parentElement;
 const nextCount=isDemo?4:Math.max(1,Math.min(10,Number.parseInt(layout.count,10)||5));
 if(nextCount!==count){count=nextCount;previousOrder='';render(currentRanking);}
 const x=isDemo?0:Math.max(0,Math.min(100,Number(layout.x)||0));
 const y=isDemo?0:Math.max(0,Math.min(100,Number(layout.y)||0));
 const scale=isDemo?1:Math.max(.5,Math.min(2,Number(layout.scale)||1));
 placement.style.position=isDemo?'relative':'absolute';placement.style.left=x+'%';placement.style.top=y+'%';placement.style.width=isDemo?'100%':'524px';placement.style.maxWidth=isDemo?'100%':'100%';
 placement.style.transformOrigin='top left';placement.style.transform=isDemo?'none':`scale(${scale})`;
 root.classList.remove('photo-left','photo-right','photo-top','photo-bottom');root.classList.add('photo-'+(['left','right','top','bottom'].includes(layout.photo_position)?layout.photo_position:'left'));
 root.style.setProperty('--likes-font-color',/^#[0-9a-f]{6}$/i.test(layout.font_color||'')?layout.font_color:'#ffffff');
 root.style.setProperty('--likes-text-shadow',({'none':'none','soft':'0 1px 3px rgba(0,0,0,.7)','medium':'0 2px 5px rgba(0,0,0,.9)','strong':'0 2px 7px #000,0 0 12px rgba(0,0,0,.85)'})[layout.shadow]||'0 1px 3px rgba(0,0,0,.7)');
 document.documentElement.style.overflow='hidden';document.body.style.overflow='hidden';
}
async function loadOverlayLayout(){
 if(params.get('demo')==='1'||!token)return;
 try{const response=await fetch('/api/likes-overlay/layout?version='+version,{headers:{Authorization:'Bearer '+token},cache:'no-store'});if(!response.ok)return;const data=await response.json();if(data.success)applyOverlayLayout(data.layout);}catch{}
}
function render(ranking) {
 currentRanking=Array.isArray(ranking)?ranking:[];
 const incoming=currentRanking.slice(0,count);
 const order=JSON.stringify(incoming.map(item=>[item.user,item.avatar]));
 if(incoming.length && order===previousOrder && root.querySelectorAll('.row').length===incoming.length) {
  root.querySelectorAll('.row').forEach((row,index)=>{
   const fullName=incoming[index].nickname || incoming[index].user || '?';
   const name=row.querySelector('.name');name.textContent=fullName;name.title=fullName;name.setAttribute('aria-label',fullName);
   row.querySelector('.total').textContent=Math.max(0,Number(incoming[index].likes)||0).toLocaleString('pt-BR');
  });return;
 }
 previousOrder=order;
 root.innerHTML=`<header class="ranking-header">${crown}<h2>RANKING DE <em>TAPS</em></h2><p>Nesta live</p></header><ol class="rows"></ol><footer class="ranking-footer"><span></span><i></i><span></span></footer>`;
 const rows=root.querySelector('.rows');
 const items=currentRanking.slice(0,count);
 if(!items.length){const empty=document.createElement('li');empty.className='empty';empty.textContent='AGUARDANDO CURTIDAS';rows.append(empty);}
 items.forEach((item,index)=>{
  const row=document.createElement('li');row.className='row rank-'+(index+1);
  const slot=document.createElement('span');slot.className='avatar-slot';
  const portrait=document.createElement('span');portrait.className=version==='v3'&&index<3?'podium-avatar':'plain-avatar';
  const fallback=document.createElement('span');fallback.className='avatar avatar-fallback';fallback.textContent=String(item.nickname || item.user || '?').slice(0,1).toUpperCase();
  let url=null;try{url=new URL(item.avatar,location.origin);}catch{}
  if(item.avatar&&url&&['https:','http:'].includes(url.protocol)){const img=new Image();img.className='avatar';img.alt='';img.src=url.href;img.onerror=()=>img.replaceWith(fallback);portrait.append(img);}else portrait.append(fallback);
  if(version==='v3'&&index<3){const frame=new Image();frame.className='metal-frame';frame.src='assets/frame-'+['gold','silver','bronze'][index]+'.png';frame.alt=['Primeiro','Segundo','Terceiro'][index]+' lugar';portrait.append(frame);}
  slot.append(portrait);
  const details=document.createElement('span');details.className='details';
  const name=document.createElement('span');name.className='name';name.textContent=item.nickname || item.user || '?';name.title=name.textContent;name.setAttribute('aria-label',name.textContent);
  const meta=document.createElement('span');meta.className='meta';
  const icon=document.createElement('span');icon.className='heart';icon.innerHTML=heart;
  const total=document.createElement('strong');total.className='total';total.textContent=Math.max(0,Number(item.likes)||0).toLocaleString('pt-BR');
  meta.append(icon,total);details.append(name,meta);row.append(slot,details);rows.append(row);
 });
}
window.addEventListener('message',event=>{if(event.origin!==location.origin||event.data?.type!=='likes-overlay-preview-config')return;applyOverlayLayout(event.data.layout);});
let snapshotRevision=0,closing=false;
async function snapshot(){const revision=snapshotRevision;try{const res=await fetch('/api/game-state',{headers:{Authorization:'Bearer '+token},cache:'no-store'});if(res.ok){const data=await res.json();if(revision===snapshotRevision)render(data.likes_ranking_all || data.likes_ranking);}}catch{}}
function connect(){if(!token){root.textContent='LINK INVÁLIDO · GERE O LINK NO PAINEL';return;}const ws=new WebSocket((location.protocol==='https:'?'wss':'ws')+'://'+location.host+'/browser?token='+encodeURIComponent(token));ws.onopen=snapshot;ws.onmessage=e=>{try{const msg=JSON.parse(e.data);if(msg.type==='likes_overlay_layout'&&msg.version===version){applyOverlayLayout(msg.layout);return;}if(msg.type==='likes_ranking'){snapshotRevision++;render(msg.ranking_all || msg.likes_ranking_all || msg.ranking);}}catch{}};ws.onclose=e=>{if(e.code===1008){root.textContent='LINK EXPIRADO · GERE OUTRO NO PAINEL';return;}if(!closing)setTimeout(connect,3000);};window.addEventListener('pagehide',()=>{closing=true;ws.close();},{once:true});}
if(params.get('demo')==='1') {
 document.body.classList.add('demo-preview');
 count=4;
 render(Array.from({length:4},(_,index)=>({user:['ana','bruno','carla'][index]||('demo-'+(index+1)),nickname:['Ana · EXEMPLO','Bruno · EXEMPLO','Carla · EXEMPLO'][index]||('Pessoa '+(index+1)+' · EXEMPLO'),likes:12450-index*850})));
} else {render([]);loadOverlayLayout().finally(connect);}
