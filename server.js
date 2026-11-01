const express = require('express');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

const SUPABASE_URL = "https://lrwowvaxygmptvemxcip.supabase.co";
const SUPABASE_KEY = "sb_publishable_veXOpEWJtSXgKojUcSywWQ_AMY1GUwj";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// IGUAL QUE TU ELECTRON - NO SE BLOQUEAN NUNCA
const SAFE_DOMAINS = ['supabase.co', 'voe.sx', 'voe-network', 'streamtape', 'dood', 'mixdrop', 'filelions', 'filemoon', 'vimeos', 'vimeus'];
const AD_DOMAINS = ['doubleclick.net','googlesyndication.com','googletagmanager.com','googletagservices.com','imasdk.googleapis.com','pubads.g.doubleclick.net','googleads','adservice','adsterra','popads','popcash','popunder','propeller','exoclick','onclickads','highperformance','adcash','hilltopads','zeropark','clickadu','aniview','ima'];

function esAnuncio(url){
  const low=url.toLowerCase();
  if(SAFE_DOMAINS.some(d=>low.includes(d))){
    if((low.includes('vimeos') || low.includes('vimeus')) && (low.includes('/ad') || low.includes('vast') || low.includes('preroll') || low.includes('ima') || low.includes('aniview'))){
      return true;
    }
    if(low.includes('.m3u8') || low.includes('voe') || low.includes('filemoon') || low.includes('vime')) return false;
  }
  if(low.includes('.m3u8') && (low.includes('preroll') || (low.includes('/ad') && !low.includes('vime')))) return true;
  if(low.includes('.mp4') && (low.includes('preroll') || low.includes('vast'))) return true;
  return AD_DOMAINS.some(d => low.includes(d));
}

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

function getDuracionM3U8(c){ 
  let d=0; 
  const m=c.match(/#EXTINF:([\d\.]+)/g); 
  if(m){ m.forEach(x=>{ const v=parseFloat(x.replace('#EXTINF:','')); if(!isNaN(v)) d+=v; }); } 
  return d; 
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

function esVideoAnuncio(c){
  const dur=getDuracionM3U8(c);
  if(dur>0 && dur<90) return true;
  if(dur>40000) return true;
  return false;
}

async function arreglarUnaPelicula(peli){
  console.log(`[AUTO] ID ${peli.id} - ${peli.titulo} - ${peli.url_pagina}`);
  let browser;
  let m3u8List = [];
  let mejorExpira = 0;
  let mejorCalidad = 0;
  let m3u8Bueno = null;

  try{
    browser = await puppeteer.launch({
      args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      defaultViewport: {width: 1280, height: 720},
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({'Referer': 'https://voe.sx/'});

    await page.setRequestInterception(true);
    page.on('request', req=>{
      try{
        const url=req.url();
        const low=url.toLowerCase();
        // SI ES VOE / DOOD / STREAMTAPE, DEJA PASAR TODO, IGUAL QUE ELECTRON
        if(low.includes('voe.sx') || low.includes('voe-network') || low.includes('streamtape') || low.includes('dood') || low.includes('mixdrop')){
          req.continue(); return;
        }
        if(esAnuncio(url)){ req.abort(); return; }
        if(url.includes(".m3u8")){
          const lowUrl = url.toLowerCase();
          if(/\/index-a\d+\.m3u8/i.test(lowUrl) && !/\/index-v\d+/i.test(lowUrl)){ 
            console.log('[AUDIO PURO BLOQUEADO]', url.substring(0,60)); 
            req.abort(); return; 
          }
          if(lowUrl.includes('/audio/') && !lowUrl.includes('index-v')){ req.abort(); return; }
        }
        req.continue();
      }catch(e){ try{req.continue()}catch(_){} }
    });

    page.on('response', async res=>{
      try{
        const url=res.url();
        if(!url.includes(".m3u8")) return;
        if(m3u8List.includes(url)) return;
        
        const low=url.toLowerCase();
        if(low.includes('voe.sx') || low.includes('voe-network') || low.includes('streamtape') || low.includes('dood')){
          // VOE SIEMPRE SE GUARDA, NO SE VERIFICA
          m3u8List.push(url);
          mejorExpira=0;
          m3u8Bueno=url;
          console.log(`[VOE GUARDADO] ${url.substring(0,80)}`);
          return;
        }

        // Para vimeos/filemoon, descargar contenido y verificar
        let contenido = "";
        try{
          contenido = await page.evaluate(async (u) => {
            try{ const r=await fetch(u); return await r.text(); }catch(e){ return ""; }
          }, url);
        }catch(e){}

        if(esAudioSolo(contenido, url)){ console.log('[AUDIO BLOQUEADO]', url.substring(0,60)); return; }
        if(esVideoAnuncio(contenido)){ console.log('[VIDEO ANUNCIO BLOQUEADO]', url.substring(0,60)); return; }

        m3u8List.push(url);
        const expira=getExpiracion(url);
        const calidad=getCalidadScore(url);
        let debeGuardar=false;
        if(expira>mejorExpira) debeGuardar=true;
        else if(expira===mejorExpira && calidad>mejorCalidad) debeGuardar=true;
        else if(mejorExpira===0 && !m3u8Bueno) debeGuardar=true;

        if(debeGuardar){
          mejorExpira=expira; mejorCalidad=calidad; m3u8Bueno=url;
          console.log(`[VIDEO GUARDADO ${expira?Math.floor((expira-Date.now()/1000)/3600)+'h':'VOE'} Q${calidad}] ${url.substring(0,80)}`);
        }
      }catch(e){}
    });

    await page.goto(peli.url_pagina, {waitUntil:'domcontentloaded', timeout:90000});
    await new Promise(r=>setTimeout(r, 5000));

    // MISMO AUTOPLAY QUE TU ELECTRON
    for(let i=0; i<40; i++){
      try{
        await page.evaluate(`
          try{
            window.open=function(){return null;};
            function reanudarPeli(){ try{ const c=document.elementFromPoint(window.innerWidth/2, window.innerHeight/2); if(c) c.click(); document.querySelectorAll('.jw-display-icon-container, .vjs-big-play-button, .voe-play, .vjs-big-play').forEach(el=>{ const r=el.getBoundingClientRect(); if(r.width>20) el.click(); }); document.querySelectorAll('video').forEach(v=>{ if(v.paused) v.play().catch(()=>{}); }); }catch(e){} }
            function matarAdVideo(){ try{ const flag=document.querySelector('.jw-flag-ads, .jw-ad-label'); const flagVisible=flag && flag.offsetParent!==null; let mato=false; document.querySelectorAll('video').forEach(v=>{ if((v.duration>0 && v.duration<90) || flagVisible){ mato=true; try{ v.muted=true; v.playbackRate=16; v.currentTime=v.duration>0?v.duration-0.05:9999; v.dispatchEvent(new Event('ended')); }catch(e){} } }); if(mato){ setTimeout(reanudarPeli, 300); } }catch(e){} }
            function cerrarModales(){ document.querySelectorAll('button').forEach(b=>{ const t=(b.innerText||'').toLowerCase(); if(t==='cerrar' || t==='close' || t.includes('continue') || t.includes('skip')) b.click(); }); }
            function autoClickPlay(){ try{ cerrarModales(); const c=document.elementFromPoint(window.innerWidth/2, window.innerHeight/2); if(c) c.click(); document.querySelectorAll('.jw-display-icon-container, .vjs-big-play-button').forEach(el=>{ const r=el.getBoundingClientRect(); if(r.width>40) el.click(); }); }catch(e){} }
            matarAdVideo();
            autoClickPlay();
          }catch(e){}
        `);
      }catch(e){
        if(e.message.includes('Execution context was destroyed')){
          console.log(`[NAV ${i}s] ignorada`);
          await new Promise(r=>setTimeout(r,1000));
          continue;
        }
      }
      await new Promise(r=>setTimeout(r,1000));
      if(m3u8Bueno) break;
    }

    if(m3u8Bueno){
      const fecha= mejorExpira ? new Date(mejorExpira*1000).toISOString() : new Date().toISOString();
      const updateData = {url_video:m3u8Bueno, expira_at:fecha};
      if(mejorExpira) updateData.expira_en = mejorExpira;
      else updateData.expira_en = null; // VOE no expira
      await supabase.from('peliculas_series').update(updateData).eq('id', peli.id);
      console.log(`[GUARDADO OK] ID ${peli.id} - ${m3u8Bueno.substring(0,80)}`);
    } else {
      console.log(`[FALLO] No m3u8 ID ${peli.id} - ${peli.url_pagina}`);
    }
    await browser.close();
    return !!m3u8Bueno;
  }catch(e){ 
    console.log('Error ID', peli.id, e.message); 
    if(browser) try{await browser.close()}catch(_){} 
    return false; 
  }
}

async function loopAuto(){
  console.log('--- Revisando vencidos SOLO PELICULAS ---');
  const { data } = await supabase.from('peliculas_series').select('id,titulo,url_pagina,url_video,expira_en').eq('tipo','pelicula').not('url_pagina','is',null).limit(1000);
  if(!data) return;
  const ahora = Math.floor(Date.now()/1000);
  // AHORA SI INCLUYE VOE, IGUAL QUE TU LOCAL
  const vencidos = data.filter(p=>{
    let exp = p.expira_en || 0;
    if(!exp && p.url_video) exp=getExpiracion(p.url_video);
    const pagina = (p.url_pagina||'').toLowerCase();
    // VOE nunca vence, pero si no tiene url_video si hay que arreglarlo
    if(pagina.includes('voe.sx') || pagina.includes('voe-network') || pagina.includes('streamtape') || pagina.includes('dood')){
      return !p.url_video; // solo si no tiene video
    }
    return !exp || exp < ahora+3600;
  });
  console.log(`Vencidos (con Voe si falta video): ${vencidos.length}`);
  for(let peli of vencidos.slice(0,3)){
    await arreglarUnaPelicula(peli);
    await new Promise(r=>setTimeout(r, 8000));
  }
}

app.get('/', (req,res)=>res.send('Wolfmax 24/7 ONLINE - Logica IGUAL Electron - VOE INCLUIDO - CHROMIUM OK'));
app.get('/status', async (req,res)=>{
  const { data } = await supabase.from('peliculas_series').select('id').eq('tipo','pelicula').not('url_pagina','is',null);
  res.json({total:data?.length, online:true, hora:new Date().toLocaleString('es-PE')});
});
app.get('/fix-now', async (req,res)=>{ res.send('Iniciando fix...'); loopAuto(); });

app.listen(PORT, ()=>{
  console.log(`Servidor en puerto ${PORT}`);
  setInterval(loopAuto, 5*60*1000);
  loopAuto();
});
