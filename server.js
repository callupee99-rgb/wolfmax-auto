const express = require('express');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

const SUPABASE_URL = "https://lrwowvaxygmptvemxcip.supabase.co";
const SUPABASE_KEY = "sb_publishable_veXOpEWJtSXgKojUcSywWQ_AMY1GUwj";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// NO TOCAR NUNCA - NO VENCEN
const NO_TOCAR = ['voe.sx', 'voe-network', 'streamtape', 'dood', 'mixdrop', 'uqload', 'voe-unblock'];

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

async function arreglarUnaPelicula(peli){
  console.log(`[AUTO] ID ${peli.id} - ${peli.titulo}`);
  let browser;
  try{
    browser = await puppeteer.launch({
      args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({'Accept-Language': 'es-PE,es;q=0.9'});

    let m3u8Bueno = null;
    let mejorExpira = 0;
    let mejorCalidad = 0;

    await page.setRequestInterception(true);
    page.on('request', req=>{
      const url=req.url().toLowerCase();
      if(url.includes('supabase.co') || url.includes('vime') || url.includes('filemoon') || url.includes('filelions')){
        req.continue(); return;
      }
      if(url.includes('doubleclick')||url.includes('googlesyndication')||url.includes('googletagmanager')||url.includes('adsterra')||url.includes('popads')||url.includes('popcash')){
        req.abort(); return;
      }
      req.continue();
    });

    page.on('response', async res=>{
      const url=res.url();
      const low=url.toLowerCase();
      if(!low.includes('.m3u8')) return;
      if(low.includes('/index-a') && !low.includes('/index-v')) return;
      if(low.includes('/audio/')) return;
      if(low.includes('preroll') || low.includes('/ad/')) return;
      
      const exp=getExpiracion(url);
      const calidad=getCalidadScore(url);
      // Guardar siempre el de mayor expiración y mejor calidad
      if(exp > mejorExpira || (exp === mejorExpira && calidad > mejorCalidad) || (mejorExpira===0 && !m3u8Bueno)){
        mejorExpira=exp;
        mejorCalidad=calidad;
        m3u8Bueno=url;
        const horas = exp ? Math.floor((exp-Date.now()/1000)/3600) : 0;
        console.log(`[ENCONTRADO ${horas}h Q${calidad}] ${url.substring(0,80)}`);
      }
    });

    await page.goto(peli.url_pagina, {waitUntil:'domcontentloaded', timeout:60000});
    await page.evaluate(()=>{
      window.open=()=>null;
      function autoClick(){
        try{
          document.querySelectorAll('button').forEach(b=>{
            const t=(b.innerText||'').toLowerCase();
            if(t==='cerrar' || t==='close' || t.includes('skip') || t.includes('continue')) b.click();
          });
          const c=document.elementFromPoint(window.innerWidth/2, window.innerHeight/2);
          if(c) c.click();
          document.querySelectorAll('.jw-display-icon-container, .vjs-big-play-button, .jw-icon-display, .vjs-big-play').forEach(el=>{
            const r=el.getBoundingClientRect();
            if(r.width>30) el.click();
          });
          document.querySelectorAll('video').forEach(v=>{ if(v.paused) v.play().catch(()=>{}); });
        }catch(e){}
      }
      setInterval(autoClick, 700);
    });
    await new Promise(r=>setTimeout(r, 30000));

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
  }catch(e){ console.log('Error ID', peli.id, e.message); if(browser) await browser.close(); return false; }
}

async function loopAuto(){
  console.log('--- Revisando vencidos SOLO PELICULAS ---');
  const { data } = await supabase.from('peliculas_series')
    .select('id,titulo,url_pagina,url_video,expira_en')
    .eq('tipo','pelicula')
    .not('url_pagina','is',null)
    .limit(1000);
  if(!data) return;
  
  const ahora = Math.floor(Date.now()/1000);
  const vencidos = data.filter(p=>{
    const pagina = (p.url_pagina||'').toLowerCase();
    // FIX 232011: Ignorar Voe y similares, no vencen
    if(NO_TOCAR.some(d=>pagina.includes(d))) return false;
    
    let exp = p.expira_en || 0;
    if(!exp && p.url_video) exp=getExpiracion(p.url_video);
    // Si no tiene expira (es Voe viejo) no lo toques
    if(!exp && !p.expira_en) return false;
    return !exp || exp < ahora+3600;
  });
  
  console.log(`Vencidos reales (sin Voe): ${vencidos.length}`);
  for(let peli of vencidos.slice(0,3)){
    await arreglarUnaPelicula(peli);
    await new Promise(r=>setTimeout(r, 8000));
  }
}

app.get('/', (req,res)=>res.send('Wolfmax 24/7 ONLINE - Voe Ignorado - CHROMIUM OK'));
app.get('/status', async (req,res)=>{
  const { data } = await supabase.from('peliculas_series').select('id').eq('tipo','pelicula').not('url_pagina','is',null);
  res.json({total:data?.length, online:true, hora:new Date().toLocaleString('es-PE')});
});
app.get('/fix-now', async (req,res)=>{
  res.send('Iniciando fix manual...');
  loopAuto();
});

app.listen(PORT, ()=>{
  console.log(`Servidor en puerto ${PORT}`);
  setInterval(loopAuto, 5*60*1000);
  loopAuto();
});
