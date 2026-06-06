const STORAGE_KEY = 'bro-stock-watch-v1';
let state = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
state.symbols ||= ['0050','0056','2330'];
state.alerts ||= [];
state.demo = state.demo ?? true;
let selected = state.symbols[0];
let chart;

const names = { '0050':'元大台灣50', '0056':'元大高股息', '2330':'台積電', '2317':'鴻海', '2454':'聯發科' };
const $ = id => document.getElementById(id);
const save = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

function setClock(){
  const now = new Date();
  $('today').textContent = now.toLocaleString('zh-TW', { dateStyle:'medium', timeStyle:'short' });
  const d = now.getDay(), h = now.getHours(), m = now.getMinutes();
  const open = d>=1 && d<=5 && (h>9 || (h===9 && m>=0)) && (h<13 || (h===13 && m<=30));
  $('marketStatus').textContent = open ? '台股盤中' : '非交易時段';
}
setInterval(setClock, 1000); setClock();

function demoSeries(symbol){
  const baseMap = { '0050':105, '0056':38, '2330':920, '2317':190, '2454':1220 };
  const base = baseMap[symbol] || 80 + Number(symbol.slice(-2));
  const arr = [];
  let price = base;
  for(let i=44;i>=0;i--){
    const drift = Math.sin(i/4)*0.9 + (Math.random()-.45)*1.6;
    price = Math.max(8, price + drift);
    const high = price + Math.random()*2;
    const low = price - Math.random()*2;
    arr.push({date:`D-${i}`, close:+price.toFixed(2), high:+high.toFixed(2), low:+low.toFixed(2), volume:Math.round(2000+Math.random()*9000)});
  }
  return arr;
}

async function fetchTwseMonthly(symbol){
  const now = new Date();
  const date = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}01`;
  const url = `https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?date=${date}&stockNo=${symbol}&response=json`;
  const res = await fetch(url);
  const json = await res.json();
  if(!json.data) throw new Error('No data');
  return json.data.map(r=>({date:r[0], close:parseFloat(String(r[6]).replace(/,/g,'')), high:parseFloat(String(r[4]).replace(/,/g,'')), low:parseFloat(String(r[5]).replace(/,/g,'')), volume:parseInt(String(r[1]).replace(/,/g,''),10)})).filter(x=>!Number.isNaN(x.close));
}

async function loadSeries(symbol){
  if(state.demo) return demoSeries(symbol);
  try { return await fetchTwseMonthly(symbol); }
  catch(e){ console.warn('TWSE fetch failed, using demo.', e); return demoSeries(symbol); }
}

function sma(values, days){
  if(values.length < days) return null;
  return values.slice(-days).reduce((a,b)=>a+b,0)/days;
}
function rsi(values, period=14){
  if(values.length <= period) return null;
  let gains=0, losses=0;
  for(let i=values.length-period;i<values.length;i++){
    const diff = values[i]-values[i-1];
    if(diff>=0) gains+=diff; else losses-=diff;
  }
  if(losses===0) return 100;
  const rs = gains/losses;
  return 100 - (100/(1+rs));
}
function kd(series, period=9){
  if(series.length < period) return {k:null,d:null};
  let k=50,d=50;
  for(let i=period-1;i<series.length;i++){
    const slice = series.slice(i-period+1, i+1);
    const high = Math.max(...slice.map(x=>x.high));
    const low = Math.min(...slice.map(x=>x.low));
    const rsv = high===low ? 50 : ((series[i].close-low)/(high-low))*100;
    k = (2/3)*k + (1/3)*rsv;
    d = (2/3)*d + (1/3)*k;
  }
  return {k,d};
}

async function render(){
  const rows = await Promise.all(state.symbols.map(async s=>({symbol:s, series:await loadSeries(s)})));
  $('watchlist').innerHTML = rows.map(({symbol,series})=>{
    const last = series.at(-1).close, prev = series.at(-2)?.close || last;
    const diff = last - prev, pct = diff/prev*100;
    return `<div class="stock ${symbol===selected?'active':''}" data-symbol="${symbol}"><div class="stock-top"><div><div class="stock-code">${symbol}</div><div class="stock-name">${names[symbol]||'自選股'}</div></div><div><div class="price">${last.toFixed(2)}</div><div class="change ${diff>=0?'up':'down'}">${diff>=0?'+':''}${diff.toFixed(2)}｜${pct.toFixed(2)}%</div></div></div></div>`;
  }).join('');
  document.querySelectorAll('.stock').forEach(el=>el.onclick=()=>{selected=el.dataset.symbol; renderDetail(rows.find(r=>r.symbol===selected)); render();});
  renderDetail(rows.find(r=>r.symbol===selected) || rows[0]);
}

function renderDetail(row){
  if(!row) return;
  const {symbol, series} = row; selected = symbol;
  const closes = series.map(x=>x.close), last = closes.at(-1), prev = closes.at(-2) || last;
  const kdv = kd(series), r = rsi(closes), ma5=sma(closes,5), ma20=sma(closes,20);
  $('detailName').textContent = `${symbol} ${names[symbol] || ''}`;
  $('detailMeta').textContent = state.demo ? '目前使用示範資料；可按「切換示範資料」嘗試抓證交所月資料' : '資料來源：TWSE 月成交資訊，抓不到時自動用示範資料';
  $('metrics').innerHTML = [
    ['現價', last.toFixed(2)], ['漲跌', `${(last-prev).toFixed(2)}`], ['KD-K', kdv.k?.toFixed(1) ?? '-'], ['RSI', r?.toFixed(1) ?? '-'], ['MA5', ma5?.toFixed(2) ?? '-'], ['MA20', ma20?.toFixed(2) ?? '-'], ['量', series.at(-1).volume.toLocaleString()], ['模式', state.demo?'Demo':'TWSE']
  ].map(([a,b])=>`<div class="metric"><span>${a}</span><strong>${b}</strong></div>`).join('');
  drawChart(series, ma5, ma20);
  checkAlerts(symbol,last,kdv.k);
  renderAlerts();
}
function drawChart(series){
  const ctx = $('chart');
  if(chart) chart.destroy();
  chart = new Chart(ctx, {type:'line', data:{labels:series.map(x=>x.date), datasets:[{label:'收盤價',data:series.map(x=>x.close),tension:.3}]}, options:{plugins:{legend:{labels:{color:'#e5e7eb'}}}, scales:{x:{ticks:{color:'#94a3b8'},grid:{color:'#1f2a44'}},y:{ticks:{color:'#94a3b8'},grid:{color:'#1f2a44'}}}}});
}
function checkAlerts(symbol, price, k){
  state.alerts.forEach(a=>{
    if(a.symbol!==symbol) return;
    const hit = a.type==='above' ? price >= a.price : price <= a.price;
    if(hit && !a.hit){ a.hit = true; alert(`${symbol} 觸發警示：現價 ${price} 已${a.type==='above'?'高於':'低於'} ${a.price}`); }
    if(k && k < 20 && !a.kHit){ a.kHit = true; alert(`${symbol} KD-K 小於 20：${k.toFixed(1)}`); }
  }); save();
}
function renderAlerts(){
  $('alerts').innerHTML = state.alerts.map((a,i)=>`<div class="alert-item"><span>${a.symbol} ${a.type==='above'?'高於':'低於'} ${a.price}</span><span class="danger" onclick="removeAlert(${i})">刪除</span></div>`).join('') || '<p class="hint">尚未建立警示。</p>';
}
window.removeAlert = i => { state.alerts.splice(i,1); save(); renderAlerts(); };
$('addBtn').onclick = () => { const s=$('symbolInput').value.trim(); if(!s) return; if(!state.symbols.includes(s)) state.symbols.push(s); selected=s; $('symbolInput').value=''; save(); render(); };
$('refreshBtn').onclick = render;
$('demoBtn').onclick = () => { state.demo = !state.demo; save(); render(); };
$('saveAlertBtn').onclick = () => { const p=parseFloat($('alertPrice').value); if(!p) return; state.alerts.push({symbol:selected, price:p, type:$('alertType').value}); $('alertPrice').value=''; save(); renderAlerts(); };
render();
