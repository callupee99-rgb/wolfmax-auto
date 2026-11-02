const { app, BrowserWindow, session, ipcMain } = require('electron');

const SUPABASE_URL = "https://lrwowvaxygmptvemxcip.supabase.co";
const SUPABASE_KEY = "sb_publishable_veXOpEWJtSXgKojUcSywWQ_AMY1GUwj";
const HEADERS = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };

let win;
let videoWin = null;
let currentPeli = null;
let m3u8List = [];
let mejorExpira = 0;
let mejorCalidad = 0;
let colaVencidos = [];
let modoAuto = false;
let procesandoCola = false;

// DOMINIOS QUE NO SE BLOQUEAN NUNCA
const SAFE_DOMAINS = ['supabase.co', 'voe.sx', 'voe-network', 'streamtape', 'dood', 'mixdrop', 'filelions', 'filemoon', 'vimeos', 'vimeus'];
const AD_DOMAINS = ['doubleclick.net','googlesyndication.com','googletagmanager.com','googletagservices.com','imasdk.googleapis.com','pubads.g.doubleclick.net','googleads','adservice','adsterra','popads','popcash','popunder','propeller','exoclick','onclickads','highperformance','adcash','hilltopads','zeropark','clickadu','aniview','ima'];

function esAnuncio(url){
  const low=url.toLowerCase();
  // NUNCA bloquear dominios seguros
  if(SAFE_DOMAINS.some(d=>low.includes(d))){
    // pero si es un anuncio dentro de vimeos, si bloquear
    if((low.includes('vimeos') || low.includes('vimeus')) && (low.includes('/ad') || low.includes('vast') || low.includes('preroll') || low.includes('ima') || low.includes('aniview'))){
      return true;
    }
    if(low.includes('.m3u8') || low.includes('voe') || low.includes('filemoon') || low.includes('vime')) return false;
  }
  if(low.includes('.m3u8') && (low.includes('preroll') || (low.includes('/ad') && !low.includes('vime')))) return true;
  if(low.includes('.mp4') && (low.includes('preroll') || low.includes('vast'))) return true;
  return AD_DOMAINS.some(d => low.includes(d));
}

async function fetchM3U8(url){ try{ const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0', 'Referer':'https://voe.sx/'}, signal: AbortSignal.timeout(5000)}); return await r.text(); }catch(e){ return ""; } }
function getDuracionM3U8(c){ let d=0; const m=c.match(/#EXTINF:([\d\.]+)/g); if(m){ m.forEach(x=>{ const v=parseFloat(x.replace('#EXTINF:','')); if(!isNaN(v)) d+=v; }); } return d; }

function getExpiracion(url){
  try{
    const u=new URL(url);
    let s=u.searchParams.get('s');
    let e=u.searchParams.get('e');
    if(s && e){ s=parseInt(s); e=parseInt(e); if(s>1000000000 && e<1000000) return s+e; }
    let exp=u.searchParams.get('Expires')||u.searchParams.get('expires');
    if(exp){ exp=parseInt(exp); if(exp>20000000000) return Math.floor(exp/1000); if(exp>1000000000) return exp; }
    if(e){ e=parseInt(e); if(e>1000000000) return e; }
    return 0;
  }catch(e){ return 0; }
}

function getCalidadScore(url){
  const low = url.toLowerCase();
  if(low.includes('index-v1')) return 100;
  if(low.includes('index-v2')) return 90;
  if(low.includes('index-v3')) return 80;
  if(low.includes('master')) return 50;
  return 10;
}

function esAudioSolo(c, url){
  const low = (url||'').toLowerCase();
  if(/\/index-v\d+/i.test(low)) return false;
  if(low.includes('/index-v1') || low.includes('/index-v2')) return false;
  if(/\/index-a\d+\.m3u8/i.test(low)) return true;
  if(low.includes('/audio/')) return true;
  if(low.includes('audio.m3u8')) return true;
  if(low.includes('_audio')) return true;
  if(!c) return false;
  if(/CODECS="[^"]*mp4a[^"]*"/i.test(c) && !/avc|h264|h265|vp9|av01/i.test(c)) return true;
  return false;
}

function esVideoAnuncio(c,url){
  const dur=getDuracionM3U8(c);
  if(dur>0 && dur<90) return true;
  if(dur>40000) return true;
  return false;
}
async function actualizarUrlVideo(id,url,exp){
  const fecha=exp?new Date(exp*1000).toISOString():null;
  const response=await fetch(`${SUPABASE_URL}/rest/v1/peliculas_series?id=eq.${id}`,{method:'PATCH',headers:HEADERS,body:JSON.stringify({url_video:url,expira_en:exp,expira_at:fecha})});
  if(!response.ok) throw new Error(`Supabase link update failed (HTTP ${response.status})`);
}
function createWindow(){ win=new BrowserWindow({width:1400,height:900,webPreferences:{nodeIntegration:true,contextIsolation:false,backgroundThrottling:false}}); win.loadFile('index.html'); }

ipcMain.handle('verificar-m3u8', async (e,url)=>{
  const low = url.toLowerCase();
  // VOE NO SE VERIFICA POR M3U8, SIEMPRE ESTA OK
  if(low.includes('voe.sx') || low.includes('voe-') || low.includes('voe-network') || low.includes('streamtape') || low.includes('dood')){
    return {ok:true,status:200,audio:false};
  }
  const headersList = [
    {'User-Agent':'Mozilla/5.0','Referer':'https://vimeus.net/','Origin':'https://vimeus.net'},
    {'User-Agent':'Mozilla/5.0','Referer':'https://vimeos.net/','Origin':'https://vimeos.net'},
    {'User-Agent':'Mozilla/5.0','Referer':'https://vimeos.zip/','Origin':'https://vimeos.zip'},
    {'User-Agent':'Mozilla/5.0','Referer':'https://filemoon.sx/','Origin':'https://filemoon.sx'},
    {'User-Agent':'Mozilla/5.0'}
  ];
  for(const headers of headersList){
    try{
      const r=await fetch(url,{headers, signal:AbortSignal.timeout(5000)});
      const t=await r.text();
      if(r.ok && t.includes('#EXT')) return {ok:true,status:r.status,audio:false};
      if(r.status===403 || r.status===401) continue;
      if(r.ok && t.length>50) return {ok:true,status:r.status,audio:false};
    }catch(err){ continue; }
  }
  return {ok:false,status:403,audio:false};
});

function abrirSiguienteDeCola(){
  if(procesandoCola) return;
  if(colaVencidos.length===0){
    modoAuto=false; procesandoCola=false;
    if(win && !win.isDestroyed()) win.webContents.send('cola-fin');
    if(videoWin && !videoWin.isDestroyed()){ try{ videoWin.destroy(); }catch(e){} videoWin=null; }
    return;
  }
  procesandoCola=true;
  const sig=colaVencidos.shift();
  if(win && !win.isDestroyed()) win.webContents.send('cola-update',{restantes:colaVencidos.length,actual:sig.titulo});
  openVideoPage(sig.url,{id:sig.id,titulo:sig.titulo},true);
}

function openVideoPage(url,peli,esAuto=false){
  modoAuto=esAuto; currentPeli=peli; m3u8List=[]; mejorExpira=0; mejorCalidad=0;
  if(videoWin && !videoWin.isDestroyed()){ try{ videoWin.destroy(); }catch(e){} videoWin=null; }
  videoWin=new BrowserWindow({
    width:1300,height:900,show:false,
    webPreferences:{nodeIntegration:false,contextIsolation:true, webSecurity: false, backgroundThrottling:false}
  });
  videoWin.webContents.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36');
  videoWin.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  videoWin.loadURL(url);
  let timeoutSin=null;
  if(modoAuto){ timeoutSin=setTimeout(()=>{ if(videoWin && !videoWin.isDestroyed()) videoWin.destroy(); },60000); }

  videoWin.webContents.on('did-start-loading', ()=>{
    if(!videoWin || videoWin.isDestroyed()) return;
    videoWin.webContents.executeJavaScript(`try{ window.open=function(){ return null; }; }catch(e){}`).catch(()=>{});
  });

  videoWin.webContents.on('did-finish-load', ()=>{
    if(!videoWin || videoWin.isDestroyed()) return;
    videoWin.webContents.executeJavaScript(`
      try{
        window.open=function(){return null;};
        function reanudarPeli(){ try{ const c=document.elementFromPoint(window.innerWidth/2, window.innerHeight/2); if(c) c.click(); document.querySelectorAll('.jw-display-icon-container, .vjs-big-play-button, .voe-play, .vjs-big-play').forEach(el=>{ const r=el.getBoundingClientRect(); if(r.width>20) el.click(); }); document.querySelectorAll('video').forEach(v=>{ if(v.paused) v.play().catch(()=>{}); }); if(window.jwplayer){ try{ const p=window.jwplayer(); if(p && p.play) p.play(); }catch(e){} } }catch(e){} }
        function matarAdVideo(){ try{ const flag=document.querySelector('.jw-flag-ads, .jw-ad-label'); const flagVisible=flag && flag.offsetParent!==null; let mato=false; document.querySelectorAll('video').forEach(v=>{ if((v.duration>0 && v.duration<90) || flagVisible){ mato=true; try{ v.muted=true; v.playbackRate=16; v.currentTime=v.duration>0?v.duration-0.05:9999; v.dispatchEvent(new Event('ended')); if(window.jwplayer){ try{ const p=window.jwplayer(); if(p && p.skipAd) p.skipAd(); }catch(e){} } }catch(e){} } }); if(mato){ setTimeout(reanudarPeli, 300); setTimeout(reanudarPeli, 1200); } }catch(e){} }
        function cerrarModales(){ document.querySelectorAll('button').forEach(b=>{ const t=(b.innerText||'').toLowerCase(); if(t==='cerrar' || t==='close' || t.includes('continue') || t.includes('skip')) b.click(); }); }
        function autoClickPlay(){ try{ cerrarModales(); const c=document.elementFromPoint(window.innerWidth/2, window.innerHeight/2); if(c) c.click(); document.querySelectorAll('.jw-display-icon-container, .vjs-big-play-button').forEach(el=>{ const r=el.getBoundingClientRect(); if(r.width>40) el.click(); }); }catch(e){} }
        setInterval(matarAdVideo, 80);
        setInterval(autoClickPlay, 700);
        setInterval(cerrarModales, 500);
      }catch(e){}
    `).catch(()=>{});
  });

  videoWin.on('closed', ()=>{
    videoWin=null;
    if(timeoutSin) clearTimeout(timeoutSin);
    procesandoCola=false;
    if(modoAuto && colaVencidos.length>0) setTimeout(abrirSiguienteDeCola, 1000);
    else if(modoAuto && colaVencidos.length===0){ modoAuto=false; if(win && !win.isDestroyed()) win.webContents.send('cola-fin'); }
  });
}

ipcMain.on('abrir-url',(e,data)=>{ if(win && !win.isDestroyed()) win.webContents.send('cola-cancelada'); modoAuto=false; colaVencidos=[]; procesandoCola=false; openVideoPage(data.url,{id:data.id,titulo:data.titulo},false); });
ipcMain.on('abrir-cola-vencidos',(e,lista)=>{ colaVencidos=lista; procesandoCola=false; abrirSiguienteDeCola(); });

app.whenReady().then(()=>{
  createWindow();
  app.on('web-contents-created', (event, contents) => { contents.setWindowOpenHandler(() => { return { action: 'deny' }; }); });
  session.defaultSession.webRequest.onBeforeRequest({urls:["<all_urls>"]}, async (details,cb)=>{
    const url=details.url;
    const low=url.toLowerCase();
    // SI ES VOE / DOOD / STREAMTAPE, DEJA PASAR TODO, NO BLOQUEES NADA
    if(low.includes('voe.sx') || low.includes('voe-network') || low.includes('streamtape') || low.includes('dood') || low.includes('mixdrop')){
      cb({}); return;
    }
    if(esAnuncio(url)){ cb({cancel:true}); return; }
    if(!url.includes(".m3u8")){ cb({}); return; }
    const lowUrl = url.toLowerCase();
    if(/\/index-a\d+\.m3u8/i.test(lowUrl) && !/\/index-v\d+/i.test(lowUrl)){ console.log('[AUDIO PURO BLOQUEADO]', url); cb({cancel:true}); return; }
    if(lowUrl.includes('/audio/') && !lowUrl.includes('index-v')){ cb({cancel:true}); return; }
    if(m3u8List.includes(url)){ cb({}); return; }
    const contenido=await fetchM3U8(url);
    if(esAudioSolo(contenido,url)){ console.log('[AUDIO BLOQUEADO]', url); cb({cancel:true}); return; }
    if(esVideoAnuncio(contenido,url)){ cb({cancel:true}); return; }
    m3u8List.push(url);
    const expira=getExpiracion(url);
    const calidad=getCalidadScore(url);
    let debeGuardar=false;
    if(expira>mejorExpira) debeGuardar=true;
    else if(expira===mejorExpira && calidad>mejorCalidad) debeGuardar=true;
    else if(mejorExpira===0) debeGuardar=true;
    if(debeGuardar){
      mejorExpira=expira; mejorCalidad=calidad;
      if(currentPeli){
        console.log(`[VIDEO GUARDADO ${Math.floor((expira-Date.now()/1000)/3600)}h]`, url);
        try{
          await actualizarUrlVideo(currentPeli.id,url,expira);
          if(win && !win.isDestroyed()) win.webContents.send('m3u8-guardado',{id:currentPeli.id,url,expira_en:expira});
          if(modoAuto){ setTimeout(()=>{ if(videoWin && !videoWin.isDestroyed()) videoWin.destroy(); }, 2500); }
        }catch(error){
          console.error(`[ERROR ACTUALIZANDO LINK ${currentPeli.id}]`, error);
        }
      }
    }
    cb({});
  });
});
