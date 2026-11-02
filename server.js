global.WebSocket = require('ws');
const express = require('express');
const puppeteer = require('puppeteer');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

let browser = null;
let estado = { total: 0, ok: 0, malos: 0, ultimoCheck: null };

async function getBrowser() {
  if (browser && browser.connected) return browser;
  browser = await puppeteer.launch({
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-zygote'],
    headless: true,
  });
  return browser;
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
  }catch{return 0;}
}

async function verificarM3u8(url){
  const low=url.toLowerCase();
  if(low.includes('voe.sx') || low.includes('streamtape') || low.includes('dood')) return {ok:true};
  try{
    const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'}, signal: AbortSignal.timeout(8000)});
    const t=await r.text();
    return {ok: r.ok && t.includes('#EXT')};
  }catch{ return {ok:false}; }
}

async function extraerM3u8(urlPagina){
  const b=await getBrowser(); const page=await b.newPage();
  let mejor=null; let mejorExp=0;
  await page.setRequestInterception(true);
  page.on('request', req=>{
    const u=req.url();
    if(u.includes('.m3u8') && !u.includes('audio') && !u.includes('/index-a')){
      const exp=getExpiracion(u);
      if(exp>mejorExp){ mejorExp=exp; mejor=u; console.log('[ENCONTRADO M3U8]', u, Math.floor((exp-Date.now()/1000)/3600)+'h'); }
    }
    req.continue();
  });
  try{
    await page.goto(urlPagina,{timeout:30000, waitUntil:'domcontentloaded'});
    await new Promise(r=>setTimeout(r,12000));
  }catch(e){ console.log('extraer error', e.message); }
  await page.close();
  return mejor;
}

async function cicloAuto(){
  try{
    const {data}=await supabase.from('peliculas_series').select('id,titulo,url_pagina,url_video').not('url_pagina','is',null).limit(1000);
    if(!data) return;
    estado.total=data.length;
    let malos=[];
    for(let p of data){
      if(!p.url_video){ malos.push(p); continue; }
      const exp=getExpiracion(p.url_video);
      if(exp && exp < Date.now()/1000){ malos.push(p); continue; }
      const check=await verificarM3u8(p.url_video);
      if(!check.ok) malos.push(p);
    }
    estado.malos=malos.length; estado.ok=estado.total-malos; estado.ultimoCheck=new Date().toISOString();
    console.log(`CHECK: ${estado.ok} ok, ${estado.malos} malos de ${estado.total}`);
    
    for(let p of malos.slice(0,10)){
      console.log(`Renovando ID ${p.id} - ${p.titulo}`);
      const nuevo=await extraerM3u8(p.url_pagina);
      if(nuevo){
        const expira_en=getExpiracion(nuevo);
        const expira_at=expira_en?new Date(expira_en*1000).toISOString():null;
        await supabase.from('peliculas_series').update({url_video:nuevo, expira_en, expira_at}).eq('id',p.id);
        console.log(`ID ${p.id} renovado OK`);
      }
      await new Promise(r=>setTimeout(r,4000));
    }
  }catch(e){ console.error('cicloAuto error', e); }
}

app.get('/', (req,res)=>{ res.json({status:'Wolfmax 24/7 OK ARM', ...estado}); });
app.get('/verificar', (req,res)=>{ cicloAuto(); res.json({msg:'verificacion iniciada', ...estado}); });

app.listen(PORT, ()=>{
  console.log(`Wolfmax Server 24/7 ARM OK en puerto ${PORT}`);
  setInterval(cicloAuto, 5*60*1000);
  cicloAuto();
});
