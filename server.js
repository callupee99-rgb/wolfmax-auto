const express = require('express');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

const SUPABASE_URL = "https://lrwowvaxygmptvemxcip.supabase.co";
const SUPABASE_KEY = "sb_publishable_veXOpEWJtSXgKojUcSywWQ_AMY1GUwj";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const NO_TOCAR = ['voe.sx', 'voe-network', 'streamtape', 'dood', 'mixdrop', 'uqload', 'voe-unblock'];
const SAFE_DOMAINS = ['supabase.co', 'voe.sx', 'voe-network', 'streamtape', 'dood', 'mixdrop', 'filelions', 'filemoon', 'vimeos', 'vimeus'];
const AD_DOMAINS = ['doubleclick.net','googlesyndication.com','googletagmanager.com','googletagservices.com','imasdk.googleapis.com','pubads.g.doubleclick.net','googleads','adservice','adsterra','popads','popcash','propeller','exoclick','onclickads'];

function esAnuncio(url){
  const low=url.toLowerCase();
  if(SAFE_DOMAINS.some(d=>low.includes(d))){
    if((low.includes('vimeos') || low.includes('vimeus')) && (low.includes('/ad') || low.includes('vast') || low.includes('preroll') || low.includes('ima') || low.includes('aniview'))){
      return true;
    }
    if(low.includes('.m3u8') || low.includes('filemoon') || low.includes('vime')) return false;
  }
  if(low.includes('.m3u8') && (low.includes('preroll') || (low.includes('/ad') && !low.includes('vime')))) return true;
  return AD_DOMAINS.some(d => low.includes(d));
}

function getExpiracion(url){
  try{
    const u=new URL(url);
    let s=u.searchParams.get('s');
    let e=u.searchParams.get('e');
    if(s && e){ s=parseInt(s); e=parseInt(e); if(s>1e9 && e<1e6) return s+e; }
    let exp=u.searchParams.get('Expires')||u.searchParams.get('expires');
    if(exp){ exp=parseInt(exp); if(exp>2e10) return Math.floor(exp/1000); if(exp>1e9) return exp; }
    if(e){ e=parseInt(e); if(e>1e9) return e; }
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

function getDuracionM3U8(c){ let d=0; const m=c.match(/#EXTINF:([\d\.]+)/g); if(m){ m.forEach(x=>{ const v=parseFloat(x.replace('#EXTINF:','')); if(!isNaN(v)) d+=v; }); } return d; }

function esAudioSolo(url){
  const low = (url||'').toLowerCase();
  if(/\/index-v\d+/i.test(low)) return false;
  if(/\/index-a\d+\.m3u8/i.test(low)) return true;
  if(low.includes('/audio/')) return true;
  if(low.includes('audio.m3u8')) return true;
  return false;
}

async function fetchM3U8Content(page, url){
  try{
    const content = await page.evaluate(async (m3u8Url) => {
      try{
        const r = await fetch(m3u8Url);
        return await r.text();
      }catch(e){ return ""; }
    }, url);
    return content;
  }catch(e){ return ""; }
}

async function arreglarUnaPelicula(peli){
  console.log(`[AUTO] ID ${peli.id} - ${peli.titulo}`);
  let browser;
  try{
    browser = await puppeteer.launch({
      args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      defaultViewport: {width: 1280, height: 720},
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36');
    
    let m3u8Bueno = null;
    let mejorExpira = 0;
    let mejorCalidad = 0;

    await page.setRequestInterception(true);
    page.on('request', req=>{
      try{
        const url = req.url();
        if(esAnuncio(url)){ req.abort(); return; }
        if(url.toLowerCase().includes('.m3u8') && esAudioSolo(url)){
          console.log('[AUDIO BLOQUEADO]', url.substring(0,60));
          req.abort(); return;
        }
        req.continue();
      }catch(e){ try{req.continue()}catch(_){} }
    });

    page.on('response', async res=>{
      try{
        const url=res.url();
        if(!url.toLowerCase().includes('.m3u8')) return;
        if(esAudioSolo(url)) return;
        if(esAnuncio(url)) return;

        const content = await fetchM3U8Content(page, url).catch(()=> "");
        const dur = getDuracionM3U8(content);
        if(dur>0 && dur<90){ console.log('[ANUNCIO VIDEO BLOQUEADO]', dur+'s'); return; }
        if(dur>40000) return;

        const exp=getExpiracion(url);
        const calidad=getCalidadScore(url);
        
        if(!m3u8Bueno || exp > mejorExpira || (exp===mejorExpira && calidad>mejorCalidad)){
          mejorExpira=exp;
          mejorCalidad=calidad;
          m3u8Bueno=url;
          console.log(`[VIDEO GUARDADO ${exp?Math.floor((exp-Date.now()/1000)/3600)+'h':'0h'} Q${calidad}] ${url.substring(0,80)}`);
        }
      }catch(e){}
    });

    await page.goto(peli.url_pagina, {waitUntil:'domcontentloaded', timeout:90000});
    
    for(let i=0; i<40; i++){
      try{
        await page.evaluate(()=>{
          try{
            window.open=()=>null;
            function matarAd(){ try{ document.querySelectorAll('video').forEach(v=>{ if(v.duration>0 && v.duration<90){ v.muted=true; v.playbackRate=16; v.currentTime=v.duration-0.1; } }); }catch(e){} }
            matarAd();
            document.querySelectorAll('button').forEach(b=>{ const t=(b.innerText||'').toLowerCase(); if(t==='cerrar'||t==='close'||t.includes('skip')) b.click(); });
            const c=document.elementFromPoint(window.innerWidth/2, window.innerHeight/2);
            if(c) c.click();
            document.querySelectorAll('.jw-display-icon-container, .vjs-big-play-button, .jw-icon-display').forEach(el=>{ try{ const r=el.getBoundingClientRect(); if(r.width>20) el.click(); }catch(e){} });
            document.querySelectorAll('video').forEach(v=>{ try{ if(v.paused) v.play().catch(()=>{}); }catch(e){} });
          }catch(e){}
        });
      }catch(e){
        if(e.message.includes('Execution context was destroyed')){
          console.log(`[NAV ${i}s] ignorada`);
          await new Promise(r=>setTimeout(r,1000));
          continue;
        }
      }
      await new Promise(r=>setTimeout(r,1000));
      if(m3u8Bueno && mejorExpira>0) break;
    }

    if(m3u8Bueno){
      const fecha= mejorExpira ? new Date(mejorExpira*1000).toISOString() : new Date().toISOString();
      const updateData = {url_video:m3u8Bueno, expira_at:fecha};
      if(mejorExpira) updateData.expira_en = mejorExpira;
      await supabase.from('peliculas_series').update(updateData).eq('id', peli.id);
      console.log(`[GUARDADO OK] ID ${peli.id}`);
    } else {
      console.log(`[FALLO] No m3u8 ID ${peli.id}`);
    }
    await browser.close();
    return !!m3u8Bueno;
  }catch(e){ console.log('Error ID', peli.id, e.message); if(browser) try{await browser.close()}catch(_){} return false; }
}

async function loopAuto(){
  console.log('--- Revisando vencidos SOLO PELICULAS ---');
  const { data } = await supabase.from('peliculas_series').select('id,titulo,url_pagina,url_video,expira_en').eq('tipo','pelicula').not('url_pagina','is',null).limit(1000);
  if(!data) return;
  const ahora = Math.floor(Date.now()/1000);
  const vencidos = data.filter(p=>{
    const pagina = (p.url_pagina||'').toLowerCase();
    if(NO_TOCAR.some(d=>pagina.includes(d))) return false;
    let exp = p.expira_en || 0;
    if(!exp && p.url_video) exp=getExpiracion(p.url_video);
    if(!exp && !p.expira_en) return false;
    return !exp || exp < ahora+3600;
  });
  console.log(`Vencidos reales (sin Voe): ${vencidos.length}`);
  for(let peli of vencidos.slice(0,3)){
    await arreglarUnaPelicula(peli);
    await new Promise(r=>setTimeout(r, 8000));
  }
}

app.get('/', (req,res)=>res.send('Wolfmax 24/7 ONLINE - Logica Electron - CHROMIUM OK'));
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
