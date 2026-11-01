const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

const SUPABASE_URL = "https://lrwowvaxygmptvemxcip.supabase.co";
const SUPABASE_KEY = "sb_publishable_veXOpEWJtSXgKojUcSywWQ_AMY1GUwj";
const HEADERS = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };

function getExpiracion(url){ try{ const u=new URL(url); let s=u.searchParams.get('s'); let e=u.searchParams.get('e'); if(s&&e){ s=parseInt(s); e=parseInt(e); if(s>1000000000&&e<1000000) return s+e; } let exp=u.searchParams.get('Expires')||u.searchParams.get('expires'); if(exp){ exp=parseInt(exp); if(exp>20000000000) return Math.floor(exp/1000); if(exp>1000000000) return exp; } return 0; }catch{ return 0; } }

async function verificar(url){
  try{ const r=await fetch(url,{method:'HEAD'}); return r.ok; }catch{ return false; }
}

async function run(){
  console.log('Iniciando Wolfmax Auto...');
  const browser = await puppeteer.launch({ args: chromium.args, defaultViewport: chromium.defaultViewport, executablePath: await chromium.executablePath(), headless: chromium.headless });
  const res = await fetch(`${SUPABASE_URL}/rest/v1/peliculas_series?select=id,titulo,url_pagina,url_video&not.url_pagina.is.null&limit=1000`, {headers: HEADERS});
  const pelis = await res.json();
  console.log(`Total ${pelis.length} pelis, verificando vencidos...`);
  
  for(const p of pelis){
    const ok = p.url_video ? await verificar(p.url_video) : false;
    if(ok) { console.log(`[OK] ${p.id} ${p.titulo}`); continue; }
    console.log(`[VENCIDO] ${p.id} ${p.titulo} -> arreglando...`);
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    let mejorUrl=null, mejorExp=0;
    page.on('request', req=>{
      const url=req.url();
      if(url.includes('.m3u8') && !url.includes('audio') && !url.includes('index-a')){
        const exp=getExpiracion(url);
        if(exp>mejorExp){ mejorExp=exp; mejorUrl=url; console.log(`  capturado ${url.substring(0,80)} exp ${exp}`); }
      }
      req.continue();
    });
    try{
      await page.goto(p.url_pagina, {waitUntil:'networkidle2', timeout:40000});
      await new Promise(r=>setTimeout(r,10000));
      if(mejorUrl){
        await fetch(`${SUPABASE_URL}/rest/v1/peliculas_series?id=eq.${p.id}`,{method:'PATCH',headers:HEADERS,body:JSON.stringify({url_video:mejorUrl,expira_en:mejorExp,expira_at:new Date(mejorExp*1000).toISOString()})});
        console.log(`  -> Guardado ${p.id}`);
      }
    }catch(e){ console.log(`  fail ${e.message}`); }
    await page.close();
  }
  await browser.close();
  console.log('Terminado');
}
run();
