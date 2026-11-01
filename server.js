const express = require('express');
const puppeteer = require('puppeteer');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

const SUPABASE_URL = "https://lrwowvaxygmptvemxcip.supabase.co";
const SUPABASE_KEY = "sb_publishable_veXOpEWJtSXgKojUcSywWQ_AMY1GUwj";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

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

async function arreglarUnaPelicula(peli){
  console.log(`[AUTO] Arreglando ID ${peli.id} - ${peli.titulo}`);
  let browser;
  try{
browser = await puppeteer.launch({
  headless: true,
  executablePath: puppeteer.executablePath(),
  args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--single-process','--no-zygote']
});
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0');

    let m3u8Bueno = null;
    let mejorExpira = 0;

    await page.setRequestInterception(true);
    page.on('request', req=>{
      const url=req.url();
      if(url.includes('doubleclick')||url.includes('googlesyndication')||url.includes('adsterra')||url.includes('popads')){ req.abort(); return; }
      req.continue();
    });
    page.on('response', async res=>{
      const url=res.url();
      if(!url.includes('.m3u8')) return;
      if(url.includes('/index-a')||url.includes('/audio/')) return;
      const exp=getExpiracion(url);
      if(exp > mejorExpira){
        mejorExpira=exp;
        m3u8Bueno=url;
        console.log(`[ENCONTRADO] ${Math.floor((exp-Date.now()/1000)/3600)}h -> ${url.substring(0,60)}`);
      }
    });

    await page.goto(peli.url_pagina, {waitUntil:'networkidle2', timeout:60000});
    await page.evaluate(()=>{
      function autoClick(){ document.elementFromPoint(window.innerWidth/2, window.innerHeight/2)?.click(); document.querySelectorAll('.jw-display-icon-container, .vjs-big-play-button').forEach(el=>el.click()); }
      setInterval(autoClick, 800);
    });
    await new Promise(r=>setTimeout(r, 25000));

    if(m3u8Bueno){
      const fecha=new Date(mejorExpira*1000).toISOString();
      await supabase.from('peliculas_series').update({url_video:m3u8Bueno, expira_en:mejorExpira, expira_at:fecha}).eq('id', peli.id);
      console.log(`[GUARDADO OK] ID ${peli.id}`);
    } else {
      console.log(`[FALLO] No se encontró m3u8 para ID ${peli.id}`);
    }
    await browser.close();
    return !!m3u8Bueno;
  }catch(e){ console.log('Error', e.message); if(browser) await browser.close(); return false; }
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
    let exp = p.expira_en || 0;
    if(!exp && p.url_video) exp=getExpiracion(p.url_video);
    return !exp || exp < ahora+3600;
  });
  console.log(`Vencidos: ${vencidos.length}`);
  for(let peli of vencidos.slice(0,3)){
    await arreglarUnaPelicula(peli);
    await new Promise(r=>setTimeout(r, 5000));
  }
}

app.get('/', (req,res)=>res.send('Wolfmax 24/7 ONLINE - Tiempo Real - Solo Pelis'));
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
  setInterval(loopAuto, 60*1000);
  loopAuto();
});
