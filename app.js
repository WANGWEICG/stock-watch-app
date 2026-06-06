const defaultList = [
  { symbol: '0050', name: '元大台灣50', market: 'TW' },
  { symbol: '0056', name: '元大高股息', market: 'TW' },
  { symbol: 'TSLA', name: 'Tesla', market: 'US' },
  { symbol: 'SPY', name: 'SPY ETF', market: 'US' },
  { symbol: 'QQQ', name: 'QQQ ETF', market: 'US' }
];

let watchList = JSON.parse(localStorage.getItem('broWatchList') || 'null') || defaultList;
let finmindToken = localStorage.getItem('finmindToken') || '';

const cardsEl = document.getElementById('cards');
const lastUpdatedEl = document.getElementById('lastUpdated');
const dataStatusEl = document.getElementById('dataStatus');
const kdAlertEl = document.getElementById('kdAlert');
const marketNoteEl = document.getElementById('marketNote');
const tokenInput = document.getElementById('tokenInput');
const tokenBox = document.getElementById('tokenBox');

if (finmindToken) {
  tokenInput.value = '已儲存，按清除可重貼';
  tokenBox.classList.add('saved');
}

function saveList(){ localStorage.setItem('broWatchList', JSON.stringify(watchList)); }
function twDate(){ return new Date().toLocaleString('zh-TW',{hour12:false}); }
function pct(n){ return Number.isFinite(n) ? `${n.toFixed(2)}%` : '--'; }
function money(n){ return Number.isFinite(n) ? n.toFixed(2) : '--'; }
function cls(n){ return n > 0 ? 'up' : n < 0 ? 'down' : 'flat'; }
function sign(n){ return n > 0 ? '+' : ''; }
function inferMarket(s){ return /^\d{4}$/.test(s) || /^00\d{2}$/.test(s) ? 'TW' : 'US'; }
function isoDate(d){ return d.toISOString().slice(0,10); }
function startDate(months=8){ const d = new Date(); d.setMonth(d.getMonth()-months); return isoDate(d); }
function endDate(){ return isoDate(new Date()); }

function renderSkeleton(){
  cardsEl.innerHTML = '';
  watchList.forEach((item, idx)=>{
    const div = document.createElement('article');
    div.className = 'card loading';
    div.innerHTML = `${idx >= defaultList.length ? '<button class="removeBtn" onclick="removeSymbol('+idx+')">移除</button>' : ''}
      <div class="symbol">${item.market}・${item.symbol}</div><div class="name">${item.name || item.symbol}</div>
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
      <div class="pill"><span>日期</span><b>${quote.date || '--'}</b></div>
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


async function fetchTextWithFallback(url){
  const tries = [
    { name:'direct', url },
    { name:'allorigins', url:`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}` },
    { name:'corsproxy', url:`https://corsproxy.io/?${encodeURIComponent(url)}` }
  ];
  const errors = [];
  for(const t of tries){
    try{
      const res = await fetch(t.url, { method:'GET', cache:'no-store' });
      if(!res.ok) throw new Error(`${t.name} HTTP ${res.status}`);
      const txt = await res.text();
      if(!txt || txt.trim().startsWith('<')) throw new Error(`${t.name} 回傳不是資料`);
      return txt;
    }catch(e){
      errors.push(e.message || String(e));
    }
  }
  throw new Error(errors.join('｜'));
}

async function finmindFetch(dataset, symbol){
  if(!finmindToken) throw new Error('請先貼上 FinMind Token');
  const params = new URLSearchParams({
    dataset,
    data_id: symbol,
    start_date: startDate(12),
    end_date: endDate(),
    token: finmindToken
  });
  const url = `https://api.finmindtrade.com/api/v4/data?${params.toString()}`;
  const txt = await fetchTextWithFallback(url);
  let json;
  try{ json = JSON.parse(txt); }catch(e){ throw new Error('API 回傳不是 JSON'); }
  if(json.status !== 200 && json.status !== '200') throw new Error(json.msg || 'FinMind 回傳錯誤');
  const data = json.data || [];
  if(!data.length) throw new Error('查無資料或代號不支援');
  return data;
}

async function fetchUSFromStooq(symbol){
  // 美股備援：不用 Token。Stooq 代號格式 TSLA.US、SPY.US、QQQ.US。
  const directUrl = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol.toLowerCase()+'.us')}&i=d`;
  const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(directUrl)}`;
  const text = await fetchTextWithFallback(directUrl);
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if(lines.length < 3) throw new Error('美股資料不足');
  const rows = lines.slice(1).map(line=>{
    const [date, open, high, low, close] = line.split(',');
    return {date, open:Number(open), high:Number(high), low:Number(low), close:Number(close)};
  }).filter(r=>Number.isFinite(r.close) && Number.isFinite(r.high) && Number.isFinite(r.low));
  if(rows.length < 2) throw new Error('美股資料筆數不足');
  return rows.slice(-260);
}

function rowsToQuote(rows){
  rows.sort((a,b)=>a.date.localeCompare(b.date));
  const last = rows[rows.length-1];
  const prev = rows[rows.length-2];
  const close = rows.map(r=>r.close), high = rows.map(r=>r.high), low = rows.map(r=>r.low);
  const tech = calcTech(close, high, low);
  return { price:last.close, previousClose:prev.close, change:last.close-prev.close, changePercent:(last.close-prev.close)/prev.close*100, ...tech, closeHistory:close, date:last.date };
}

async function fetchQuote(item){
  if(item.market === 'TW'){
    const data = await finmindFetch('TaiwanStockPrice', item.symbol);
    const rows = data.map(r=>({
      date: r.date,
      close: Number(r.close),
      high: Number(r.max ?? r.high),
      low: Number(r.min ?? r.low),
      open: Number(r.open)
    })).filter(r=>Number.isFinite(r.close) && Number.isFinite(r.high) && Number.isFinite(r.low));
    if(rows.length < 2) throw new Error('台股資料筆數不足');
    return rowsToQuote(rows);
  }
  // 先用 FinMind；不行就自動改用 Stooq 備援。
  try{
    const data = await finmindFetch('USStockPrice', item.symbol);
    const rows = data.map(r=>({date:r.date, close:Number(r.close), high:Number(r.max ?? r.high), low:Number(r.min ?? r.low), open:Number(r.open)}))
      .filter(r=>Number.isFinite(r.close) && Number.isFinite(r.high) && Number.isFinite(r.low));
    if(rows.length < 2) throw new Error('FinMind 美股資料不足');
    return rowsToQuote(rows);
  }catch(e){
    return rowsToQuote(await fetchUSFromStooq(item.symbol));
  }
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
  marketNoteEl.textContent = finmindToken ? '正在抓取 FinMind 真實日線資料' : '請先儲存 FinMind Token';
  cardsEl.innerHTML = '';
  let ok = 0;
  let quote0050 = null;
  for(let i=0;i<watchList.length;i++){
    const item = watchList[i];
    try{
      const quote = await fetchQuote(item);
      renderCard(item, quote, i); ok++;
      if(item.symbol === '0050') quote0050 = quote;
    }catch(e){
      renderCard(item, { error: e.message || '資料讀取失敗' }, i);
    }
  }
  lastUpdatedEl.textContent = twDate();
  dataStatusEl.textContent = ok === watchList.length ? '真實資料已更新' : `部分成功 ${ok}/${watchList.length}`;
  marketNoteEl.textContent = '台股資料來自 FinMind；美股若 FinMind 失敗會自動用備援日線。顯示最後交易日，非券商下單即時報價。';
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
document.getElementById('saveTokenBtn').addEventListener('click', ()=>{
  const v = tokenInput.value.trim();
  if(!v || v.includes('已儲存')) return;
  finmindToken = v;
  localStorage.setItem('finmindToken', finmindToken);
  tokenInput.value = '已儲存，按清除可重貼';
  tokenBox.classList.add('saved');
  loadAll();
});
document.getElementById('clearTokenBtn').addEventListener('click', ()=>{
  localStorage.removeItem('finmindToken');
  finmindToken = '';
  tokenInput.value = '';
  tokenBox.classList.remove('saved');
  loadAll();
});

loadAll();
setInterval(loadAll, 5 * 60_000);
