import {compound,positionSize,portfolioRisk,generatePrices,runBacktest,parsePriceCsv,validatePrices,orderSimulation} from './engine.js';
import {getValue,putValue,downloadFile} from './state.js';
export const LABS={compound:'复利与回撤',risk:'仓位与亏损预算',cost:'成本侵蚀',leakage:'信息时间实验',backtest:'策略回测工作台',portfolio:'相关性与分散',execution:'订单与部分成交'};
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=v=>Number.isFinite(v)?`${(v*100).toFixed(2)}%`:'—';
const num=v=>Number.isFinite(v)?v.toLocaleString('zh-CN',{maximumFractionDigits:2}):'—';
const scalarMetrics=v=>Object.fromEntries(Object.entries(v).filter(([,value])=>typeof value==='number'||value===null));
function field(name,label,value,min,max,step=1) {return `<label class="field"><span>${label}</span><input type="number" name="${name}" value="${value}" min="${min}" max="${max}" step="${step}" required></label>`;}
function stat(label,value,sub=''){return `<div class="stat"><span>${label}</span><strong>${value}</strong><small>${sub}</small></div>`;}
export function chart(series,labels=['策略','基准']) {
  const vals=series.flat().filter(Number.isFinite);if(!vals.length)return '';
  const low=Math.min(...vals),high=Math.max(...vals),span=high-low||1;
  const colors=['#1b6855','#ab8a53'];
  return `<figure class="chart"><div class="chart-legend">${series.map((_,i)=>`<span style="--c:${colors[i]}">${labels[i]}</span>`).join('')}</div><svg viewBox="0 0 700 210" role="img" aria-label="${labels.join('与')}净值曲线"><text x="0" y="17">${high.toFixed(2)}</text><text x="0" y="192">${low.toFixed(2)}</text>${[25,105,185].map(y=>`<line x1="48" y1="${y}" x2="696" y2="${y}" stroke="#e2e5df"/>`).join('')}${series.map((s,i)=>`<polyline fill="none" stroke="${colors[i]}" stroke-width="2.8" points="${s.map((v,j)=>`${48+j/Math.max(1,s.length-1)*646},${185-(v-low)/span*160}`).join(' ')}"/>`).join('')}</svg><figcaption>横轴：按时间顺序排列的交易期；纵轴：净值。图形支持比较，不能代替逐笔核对。</figcaption></figure>`;
}
export function labMarkup(kind='compound') {
  const fields={
    compound:field('up','第一期收益（%）',20,-95,100)+field('down','第二期收益（%）',-20,-95,100),
    risk:field('equity','账户权益（元）',100000,1000,100000000)+field('risk','单次计划风险（%）',1,.1,5,.1)+field('entry','入场价',10,.01,10000,.01)+field('stop','风险参考退出价',9,.01,10000,.01)+field('lot','教学买入单位',100,1,10000)+field('weight','单标的资金上限（%）',20,1,100),
    cost:field('edge','每次交易毛优势（bp）',18,-100,1000)+field('fee','每次交易全成本（bp）',12,0,1000)+field('turns','年度换手倍数（绝对成交口径）',12,0,1000),
    leakage:field('day','你身处第几天（1—5）',3,1,5),
    backtest:field('fast','短均线（天）',10,2,100)+field('slow','长均线（天）',40,3,200)+field('costBps','单边费用（bp）',10,0,500)+field('slippageBps','单边滑点（bp）',5,0,500),
    portfolio:field('weight','资产 A 权重（%）',50,0,100)+field('volA','A 年化波动率（%）',20,0,100)+field('volB','B 年化波动率（%）',20,0,100)+field('correlation','相关系数',0,-1,1,.1),
    execution:field('quantity','买入申报数量',1000,1,100000)+field('volume','当前时段可用成交量',5000,0,10000000)+field('participation','参与率上限（%）',10,0,100)+field('price','成交参考价',10,.01,10000,.01)+field('cash','可用现金',100000,0,100000000)+`<label class="check-label"><input type="checkbox" name="halted">模拟停牌 / 不可成交</label>`
  };
  return `<div class="lab" data-lab="${kind}"><div class="lab-top"><div><span class="eyebrow">INTERACTIVE LAB</span><h2>${LABS[kind]}</h2></div><span class="tag">教学实验 · 非真实交易</span></div><p class="lab-intro">先预测变化方向，再改一个参数，比较结果并解释原因。</p><form class="lab-form"><div class="form-grid">${fields[kind] || fields.compound}</div><button class="primary" type="submit">运行实验 <span>↗</span></button></form>${kind==='backtest'?`<div class="data-toolbar"><span data-source>数据：固定种子合成行情 · 非市场历史</span><label class="file-button">导入自己的日线 CSV<input type="file" data-prices accept=".csv,text/csv" hidden></label><a href="./practice/prices.csv" download>下载样例 CSV</a></div><p class="hint">CSV 列：date,open,close,volume；单一标的，日期唯一且升序，价格必须为正。复权一致性、数据许可和交易日完整性须另行核对。</p>`:''}<div class="lab-result" aria-live="polite"></div><div class="lab-observation"><label class="field"><span>实验记录：你改了什么？结果为什么变化？（至少 30 字）</span><textarea data-observation rows="3" maxlength="3000" placeholder="我的预测是……将参数从……改为……之后，观察到……原因是……"></textarea></label><button class="secondary" type="button" data-save-experiment>保存实验记录</button></div></div>`;
}
export function bindLab(container,{lessonId,onSave=()=>{},notify=()=>{}}={}) {
  const root=container.querySelector('[data-lab]');if(!root)return;
  const kind=root.dataset.lab,result=root.querySelector('.lab-result');
  let prices=generatePrices(42,504),dataset='synthetic-42',lastRun=null;
  const defaultDataset=JSON.stringify(prices);
  const saved=getValue(`experiment:${lessonId || kind}`);if(saved)root.querySelector('[data-observation]').value=saved.observation || '';
  if(saved?.kind===kind){
    for(const [name,value] of Object.entries(saved.parameters || {})){
      const input=root.querySelector('form').elements.namedItem(name);
      if(input?.type==='checkbox')input.checked=value===true;
      else if(input && Number.isFinite(value))input.value=value;
    }
    if(kind==='backtest' && saved.summary?.dataset!=='synthetic-42')root.querySelector('[data-source]').textContent='当前为合成行情；旧记录使用了自选 CSV，请重新导入该文件再比较。';
  }
  const run=()=>{
    const fd=new FormData(root.querySelector('form'));const p=Object.fromEntries([...fd.entries()].map(([k,v])=>[k,v==='on'?true:Number(v)]));
    try{
      let html='',summary;
      if(kind==='compound'){
        const v=compound([p.up/100,p.down/100]);summary=v;
        html=`<div class="stat-grid">${stat('累计收益',pct(v.totalReturn))}${stat('最大回撤',pct(v.maxDrawdown))}${stat('回本所需涨幅',pct(v.recoveryRequired))}</div>${chart([v.equity],['资金净值'])}<p class="explanation">从 100 元出发：100 × (1 + ${p.up/100}) × (1 + ${p.down/100}) = ${(100*(1+v.totalReturn)).toFixed(2)} 元。每一期作用于当时的本金，不能直接把百分数相加。</p>`;
      }else if(kind==='risk'){
        const v=positionSize({equity:p.equity,riskPercent:p.risk/100,entry:p.entry,stop:p.stop,lotSize:p.lot,maxWeight:p.weight/100});summary=v;
        html=`<div class="stat-grid">${stat('教学可买股数',num(v.shares))}${stat('占用资金',num(v.notional))}${stat('参考价差损失',num(v.actualRisk))}</div><p class="explanation">数量受“权益 × 风险比例 ÷ 价差”和单标的资金上限共同约束，再向下取整。风险参考退出价并不是保证成交价，跳空、涨跌停和流动性会使实际亏损超过预算。</p>`;
      }else if(kind==='cost'){
        const net=p.edge-p.fee,drag=p.fee/10000*p.turns;summary={net,drag};
        html=`<div class="stat-grid">${stat('单次净优势',`${net} bp`)}${stat('年度成本近似拖累',pct(drag))}${stat('1 bp', '0.01%')}</div><p class="explanation">净优势 = 毛优势 − 全成本。年度近似拖累 = 全成本 × 绝对成交额 / 平均权益。若你的换手口径把买卖合并为一次，必须统一成本口径。该估算忽略复利和成交价格变化，不是精确回测。</p>`;
      }else if(kind==='leakage'){
        const arr=[100,102,99,105,103];summary={available:p.day};
        html=`<div class="table-wrap"><table><thead><tr><th>日期</th><th>收盘价</th><th>此时是否可用</th></tr></thead><tbody>${arr.map((v,i)=>`<tr><td>第 ${i+1} 天</td><td>${i<p.day?v:'未知'}</td><td>${i<p.day?'已产生':'未来信息，不能用于当前信号'}</td></tr>`).join('')}</tbody></table></div><p class="explanation">你现在站在第 ${p.day} 天收盘后。只能用当天及此前收盘价形成信号，最早在下一可交易时点执行。shift(-1) 可以生成事后标签，不能把它当成当日输入；修改未来价格不应改变今天的信号。</p>`;
      }else if(kind==='portfolio'){
        const vol=portfolioRisk(p.weight/100,p.volA/100,p.volB/100,p.correlation);summary={vol};
        html=`<div class="stat-grid">${stat('组合年化波动率',pct(vol))}${stat('简单加权波动',pct((p.weight*p.volA+(100-p.weight)*p.volB)/10000))}${stat('相关系数',p.correlation)}</div><p class="explanation">σ² = w²σA² + (1−w)²σB² + 2w(1−w)ρσAσB。先相加方差和协方差，再开平方。历史相关性不是常数，压力时可能一起下跌；将相关系数调到 1 观察分散效果消失。</p>`;
      }else if(kind==='execution'){
        const v=orderSimulation({side:'buy',quantity:p.quantity,price:p.price,cash:p.cash,holdings:0,availableShares:0,lotSize:100,maxParticipation:p.participation/100,volume:p.volume,tradable:!p.halted,halted:!!p.halted});summary=v;
        html=`<div class="stat-grid">${stat('成交量',num(v.filled))}${stat('未成交量',num(v.remaining))}${stat('剩余现金',num(v.cash))}</div><p class="explanation">${escapeHTML(v.reason)}。本实验简化为无费用、100 股买入单位；实际品种应核实交易单位与可卖数量。未成交部分不能当作已持有。生产系统需订单唯一 ID、回报与账本对账。</p>`;
      }else{
        const v=runBacktest(prices,p);summary={dataset,parameters:p,trainMetrics:scalarMetrics(v.trainMetrics),holdoutRevealed:false};
        const view=getValue(`holdout:${dataset}`),contaminated=!!view;
        html=`<div class="stat-grid four">${stat('开发段累计收益',pct(v.trainMetrics.totalReturn))}${stat('全程净收益', '待揭示','查看样本外后显示')}${stat('开发段最大回撤',pct(v.trainMetrics.maxDrawdown))}${stat('记录长度',`${prices.length} 根`)}</div><p class="hint">前 ${v.splitIndex} 根用于开发，剩余 ${prices.length-v.splitIndex} 根为教学留出段。${contaminated?'你已查看过这份数据的留出结果，后续调整属于开发试验，不能再宣称该区间是未见样本。':'先根据机制固定规则和成本假设，再揭示留出结果。'}</p>${chart([v.rows.slice(0,v.splitIndex).map(r=>r.equity/100000),v.rows.slice(0,v.splitIndex).map(r=>r.benchmark/100000)],['开发段策略','买入持有'])}<button class="secondary" type="button" data-reveal>查看样本外与逐日账本</button><div data-holdout></div><p class="hint">${v.assumptions.map(escapeHTML).join('；')}。更换 CSV 不会自动证明数据质量；交易日历、复权与品种约束须另行核实。</p>`;
        result.innerHTML=html;
        root.querySelector('[data-reveal]').addEventListener('click',()=>{
          putValue(`holdout:${dataset}`,{at:Date.now(),parameters:p});
          Object.assign(summary,{holdoutRevealed:true,metrics:scalarMetrics(v.metrics),testMetrics:scalarMetrics(v.testMetrics),trades:v.trades});
          root.querySelector('[data-holdout]').innerHTML=`<div class="callout">这次揭示已记入研究记录。测试段结果只适用于本数据和假设；反复观察后再调参需要新的未见数据。</div><div class="stat-grid four">${stat('留出段净收益',pct(v.testMetrics.totalReturn))}${stat('留出段最大回撤',pct(v.testMetrics.maxDrawdown))}${stat('全程策略 / 基准',`${pct(v.metrics.totalReturn)} / ${pct(v.benchmarkMetrics.totalReturn)}`)}${stat('换仓成交笔数',v.trades)}</div>${chart([v.rows.map(r=>r.equity/100000),v.rows.map(r=>r.benchmark/100000)])}<div class="table-wrap"><table><thead><tr><th>日期</th><th>执行信号</th><th>现金</th><th>持股</th><th>净值</th></tr></thead><tbody>${v.rows.slice(-8).map(r=>`<tr><td>${r.date}</td><td>${r.executedSignal}</td><td>${num(r.cash)}</td><td>${num(r.shares)}</td><td>${num(r.equity)}</td></tr>`).join('')}</tbody></table></div><button class="text-button" data-report>下载本次实验报告</button>`;
          root.querySelector('[data-report]').onclick=()=>downloadFile('research-experiment.json',JSON.stringify({...summary,assumptions:v.assumptions,kind:'educational-not-live',createdAt:new Date().toISOString()},null,2),'application/json');
        });
      }
      if(kind!=='backtest')result.innerHTML=html;
      lastRun={parameters:p,summary,at:Date.now()};
    }catch(error){lastRun=null;result.innerHTML=`<p class="error" role="alert">${escapeHTML(error.message)}</p>`;}
  };
  root.querySelector('form').addEventListener('submit',e=>{e.preventDefault();run();});
  root.querySelector('[data-save-experiment]').onclick=()=>{
    const observation=root.querySelector('[data-observation]').value.trim();
    if(!lastRun || [...observation.replace(/\s/g,'')].length<30){notify('请先成功运行实验，并写下至少 30 个非空白字符的观察解释。');return;}
    try{putValue(`experiment:${lessonId || kind}`,{kind,...lastRun,observation});notify('实验记录已保存。');onSave();}catch(error){notify(error.message);}
  };
  root.querySelector('[data-prices]')?.addEventListener('change',async e=>{
    const file=e.target.files?.[0];if(!file)return;
    try{
      if(file.size>2*1024*1024)throw new Error('请使用 2 MB 以内的单标的 CSV。');
      const text=await file.text(),rows=parsePriceCsv(text);
      const audit=validatePrices(rows);if(!audit.valid)throw new Error(audit.errors.join('；'));
      prices=rows;const canonical=JSON.stringify(rows),buffer=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical));dataset=canonical===defaultDataset?'synthetic-42':Array.from(new Uint8Array(buffer)).slice(0,12).map(v=>v.toString(16).padStart(2,'0')).join('');
      root.querySelector('[data-source]').textContent=`用户 CSV：${file.name} · ${rows.length} 根 · ${audit.warnings.join('；') || '基础格式检查通过'}`;run();
    }catch(error){notify(error.message);}
  });
  run();
}
