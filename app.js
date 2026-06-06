const defaultList = [
  { symbol: '0050', name: '元大台灣50', market: 'TW' },
  { symbol: '0056', name: '元大高股息', market: 'TW' },
  { symbol: 'TSLA', name: 'Tesla', market: 'US' },
  { symbol: 'SPY', name: 'SPY ETF', market: 'US' },
  { symbol: 'QQQ', name: 'QQQ ETF', market: 'US' }
];

let watchList = JSON.parse(localStorage.getItem('broWatchList') || 'null') || defaultList;

const cardsEl = document.getElementById('cards');
const lastUpdatedEl = document.getElementById('lastUpdated');
const dataStatusEl = document.getElementById('dataStatus');
const kdAlertEl = document.getElementById('kdAlert');
const marketNoteEl = document.getElementById('marketNote');

function saveList(){ localStorage.setItem('broWatchList', JSON.stringify(watchList)); }
function twDate(){ return new Date().toLocaleString('zh-TW',{hour12:false}); }
function pct(n){ return Number.isFinite(n) ? `${n.toFixed(2)}%` : '--'; }
function money(n){ return Number.isFinite(n) ? (n >= 1000 ? n.toFixed(2) : n.toFixed(2)) : '--'; }
function cls(n){ return n > 0 ? 'up' : n < 0 ? 'down' : 'flat'; }
function sign(n){ return n > 0 ? '+' : ''; }
function inferMarket(s){ return /^\d{4}$/.test(s) || /^00\d{2}$/.test(s) ? 'TW' : 'US'; }

function renderSkeleton(){
  cardsEl.innerHTML = '';
  watchList.forEach((item, idx)=>{
    const div = document.createElement('article');
    div.className = 'card loading';
    div.innerHTML = `${idx >= defaultList.length ? '<button class="removeBtn" onclick="removeSymbol('+idx+')">移除</button>' : ''}
      <div class="symbol">${item.symbol}</div><div class="name">${item.name || item.symbol}</div>
      <div class="price">載入中</div><div class="change flat">--</div>
      <div class="meta"><div class="pill"><span>KD-K</span><b>--</b></div><div class="pill"><span>RSI</span><b>--</b></div></div>`;
    cardsEl.appendChild(div);
  });
}

function renderCard(item, quote, idx){
  const div = document.createElement('article');
  div.className = 'card' + (quote.error ? ' error' : '');
  const chg = quote.change ?? null;
  const chgPct = quote.changePercent ?? null;
  const trend = Array.isArray(quote.closeHistory) ? quote.closeHistory.slice(-18) : [];
  div.innerHTML = `${idx >= defaultList.length ? '<button class="removeBtn" onclick="removeSymbol('+idx+')">移除</button>' : ''}
    <div class="symbol">${item.market}・${item.symbol}</div>
    <div class="name">${item.name || item.symbol}</div>
    <div class="price">${quote.error ? '讀取失敗' : money(quote.price)}</div>
    <div class="change ${cls(chg)}">${quote.error ? quote.error : `${sign(chg)}${money(chg)}（${sign(chgPct)}${pct(chgPct)}）`}</div>
    <svg class="spark" viewBox="0 0 180 36" preserveAspectRatio="none">${sparkline(trend)}</svg>
    <div class="meta">
      <div class="pill"><span>KD-K</span><b>${Number.isFinite(quote.k) ? quote.k.toFixed(1) : '--'}</b></div>
      <div class="pill"><span>RSI-14</span><b>${Number.isFinite(quote.rsi) ? quote.rsi.toFixed(1) : '--'}</b></div>
      <div class="pill"><span>MA5</span><b>${money(quote.ma5)}</b></div>
      <div class="pill"><span>MA20</span><b>${money(quote.ma20)}</b></div>
    </div>`;
  cardsEl.appendChild(div);
}

function sparkline(arr){
  if(!arr || arr.length < 2) return '';
  const min = Math.min(...arr), max = Math.max(...arr);
  const pts = arr.map((v,i)=>{
    const x = i * 180 / (arr.length - 1);
    const y = max === min ? 18 : 32 - ((v-min)/(max-min))*28;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const color = arr[arr.length-1] >= arr[0] ? 'var(--up)' : 'var(--down)';
  return `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
}

async function fetchTwQuote(symbol){
  const rt = await fetch(`https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_${symbol}.tw&json=1&delay=0&_=${Date.now()}`);
  const json = await rt.json();
  const m = json.msgArray && json.msgArray[0];
  if(!m) throw new Error('台股行情暫無資料');
  const price = parseFloat(m.z !== '-' ? m.z : m.y);
  const prev = parseFloat(m.y);
  const hist = await fetchTwHistory(symbol);
  const tech = calcTech(hist.close, hist.high, hist.low);
  return { price, previousClose: prev, change: price - prev, changePercent: (price-prev)/prev*100, ...tech, closeHistory: hist.close };
}

async function fetchTwHistory(symbol){
  const now = new Date();
  let all = [];
  for(let back=0; back<4; back++){
    const d = new Date(now.getFullYear(), now.getMonth()-back, 1);
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    try{
      const res = await fetch(`https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?date=${y}${m}01&stockNo=${symbol}&response=json&_=${Date.now()}`);
      const j = await res.json();
      if(j.data){ all = j.data.concat(all); }
    }catch(e){}
  }
  const rows = all.map(r=>({
    close: num(r[6]), high: num(r[4]), low: num(r[5])
  })).filter(r=>Number.isFinite(r.close));
  return { close: rows.map(r=>r.close), high: rows.map(r=>r.high), low: rows.map(r=>r.low) };
}

function num(s){ return parseFloat(String(s).replace(/,/g,'')); }

async function fetchUsQuote(symbol){
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=3mo&interval=1d&_=${Date.now()}`;
  const res = await fetch(url);
  const json = await res.json();
  const result = json.chart && json.chart.result && json.chart.result[0];
  if(!result) throw new Error('美股行情暫無資料');
  const meta = result.meta;
  const q = result.indicators.quote[0];
  const close = q.close.filter(Number.isFinite);
  const high = q.high.filter(Number.isFinite);
  const low = q.low.filter(Number.isFinite);
  const price = meta.regularMarketPrice ?? close[close.length-1];
  const prev = meta.chartPreviousClose ?? close[close.length-2];
  const tech = calcTech(close, high, low);
  return { price, previousClose: prev, change: price-prev, changePercent:(price-prev)/prev*100, ...tech, closeHistory: close };
}

function calcTech(close, high, low){
  const ma = (n)=> close.length>=n ? avg(close.slice(-n)) : NaN;
  const rsi = calcRSI(close,14);
  const kd = calcKD(close, high, low, 9);
  return { ma5: ma(5), ma20: ma(20), rsi, k: kd.k, d: kd.d };
}
function avg(a){ return a.reduce((x,y)=>x+y,0)/a.length; }
function calcRSI(close, period){
  if(close.length <= period) return NaN;
  let gains=0, losses=0;
  for(let i=close.length-period; i<close.length; i++){
    const diff = close[i]-close[i-1]; if(diff>=0) gains += diff; else losses -= diff;
  }
  if(losses===0) return 100;
  const rs = gains/losses;
  return 100 - (100/(1+rs));
}
function calcKD(close, high, low, period){
  if(close.length < period || high.length < period || low.length < period) return {k:NaN,d:NaN};
  let k = 50, d = 50;
  const start = Math.max(period-1, close.length-30);
  for(let i=start;i<close.length;i++){
    const h = Math.max(...high.slice(Math.max(0,i-period+1),i+1));
    const l = Math.min(...low.slice(Math.max(0,i-period+1),i+1));
    const rsv = h===l ? 50 : (close[i]-l)/(h-l)*100;
    k = (2/3)*k + (1/3)*rsv;
    d = (2/3)*d + (1/3)*k;
  }
  return {k,d};
}

async function loadAll(){
  renderSkeleton();
  dataStatusEl.textContent = '讀取中';
  marketNoteEl.textContent = '正在抓取公開行情資料';
  cardsEl.innerHTML = '';
  let ok = 0;
  let quote0050 = null;
  for(let i=0;i<watchList.length;i++){
    const item = watchList[i];
    try{
      const quote = item.market === 'TW' ? await fetchTwQuote(item.symbol) : await fetchUsQuote(item.symbol);
      renderCard(item, quote, i); ok++;
      if(item.symbol === '0050') quote0050 = quote;
    }catch(e){
      renderCard(item, { error: e.message || '資料讀取失敗' }, i);
    }
  }
  lastUpdatedEl.textContent = twDate();
  dataStatusEl.textContent = ok === watchList.length ? '真實資料已更新' : `部分成功 ${ok}/${watchList.length}`;
  marketNoteEl.textContent = '免費公開資料可能延遲；休市時顯示最後交易資料';
  updateKdAlert(quote0050);
}

function updateKdAlert(q){
  if(!q || !Number.isFinite(q.k)) { kdAlertEl.className='kdAlert muted'; kdAlertEl.textContent='0050 KD 資料不足，暫時無法判斷。'; return; }
  if(q.k < 20){ kdAlertEl.className='kdAlert warn'; kdAlertEl.textContent=`⚠️ 0050 K值 ${q.k.toFixed(1)}，小於20，進入超賣區。`; }
  else { kdAlertEl.className='kdAlert ok'; kdAlertEl.textContent=`✅ 0050 K值 ${q.k.toFixed(1)}，目前未低於20。`; }
}

window.removeSymbol = function(idx){ watchList.splice(idx,1); saveList(); loadAll(); }
document.getElementById('refreshBtn').addEventListener('click', loadAll);
document.getElementById('addBtn').addEventListener('click', ()=>{
  const input = document.getElementById('symbolInput');
  const s = input.value.trim().toUpperCase();
  if(!s) return;
  const market = inferMarket(s);
  watchList.push({symbol:s, name:s, market});
  input.value=''; saveList(); loadAll();
});

loadAll();
setInterval(loadAll, 60_000);
