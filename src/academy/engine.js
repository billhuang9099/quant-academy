/** Pure teaching engine. Fractions (0.01 = 1%) throughout; no broker connection. */
const finite = (value, name) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name} 必须是有限数字`);
  return value;
};
const bound = (value, name, min, max) => {
  finite(value, name);
  if (value < min || value > max) throw new Error(`${name} 必须在 ${min} 到 ${max} 之间`);
  return value;
};
const integer = (value, name, min = 1, max = 1000000) => {
  bound(value, name, min, max);
  if (!Number.isInteger(value)) throw new Error(`${name} 必须是整数`);
  return value;
};

export function compound(returns) {
  if (!Array.isArray(returns)) throw new Error('returns 必须是收益率数组');
  const equity = [1];
  let peak = 1, maxDrawdown = 0;
  for (const value of returns) {
    finite(value, '收益率');
    if (value < -1) throw new Error('现金账户的单期收益不能小于 -100%');
    const next = equity.at(-1) * (1 + value);
    if (!Number.isFinite(next)) throw new Error('复利结果超出可计算范围');
    equity.push(next);
    peak = Math.max(peak, next);
    maxDrawdown = Math.max(maxDrawdown, (peak - next) / peak);
  }
  return { equity, totalReturn: equity.at(-1) - 1, maxDrawdown,
    recoveryRequired: maxDrawdown === 1 ? null : maxDrawdown / (1 - maxDrawdown) };
}

export function riskMetrics(returns, periods = 252, riskFreeAnnual = 0) {
  integer(periods, '年化期数');
  finite(riskFreeAnnual, '无风险年利率');
  if (riskFreeAnnual <= -1) throw new Error('无风险年利率必须大于 -100%');
  const result = compound(returns);
  const n = returns.length;
  const mean = n ? returns.reduce((sum, r) => sum + r, 0) / n : 0;
  const deviation = n > 1 ? Math.sqrt(returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (n - 1)) : 0;
  const annualizedReturn = n ? (result.equity.at(-1) ** (periods / n) - 1) : 0;
  if (!Number.isFinite(annualizedReturn)) throw new Error('年化结果超出可计算范围');
  return { totalReturn: result.totalReturn, annualizedReturn,
    volatility: deviation * Math.sqrt(periods),
    sharpe: deviation > 1e-14 ? (mean - ((1 + riskFreeAnnual) ** (1 / periods) - 1)) / deviation * Math.sqrt(periods) : null,
    maxDrawdown: result.maxDrawdown, equity: result.equity };
}

export function portfolioRisk(weight, volA, volB, correlation) {
  bound(weight, '资产 A 权重', 0, 1);
  bound(volA, '资产 A 波动率', 0, 10);
  bound(volB, '资产 B 波动率', 0, 10);
  bound(correlation, '相关系数', -1, 1);
  return Math.sqrt(Math.max(0, weight ** 2 * volA ** 2 + (1 - weight) ** 2 * volB ** 2 + 2 * weight * (1 - weight) * correlation * volA * volB));
}

export function positionSize({ equity, riskPercent, entry, stop, lotSize = 100, maxWeight = 1 }) {
  if (finite(equity, '账户权益') <= 0 || finite(entry, '买入价') <= 0 || finite(stop, '止损价') <= 0 || stop >= entry) {
    throw new Error('权益与价格须为正，做多计划须满足止损价低于买入价');
  }
  bound(riskPercent, '风险比例', 0, 1);
  bound(maxWeight, '仓位上限', 0, 1);
  integer(lotSize, '交易单位');
  const riskCash = equity * riskPercent;
  const shares = Math.floor(Math.min(riskCash / (entry - stop), equity * maxWeight / entry) / lotSize) * lotSize;
  return { shares, riskCash, notional: shares * entry, actualRisk: shares * (entry - stop) };
}

export const SYNTHETIC_DATA_NOTICE = '合成日线，仅用于学习计算；不是市场历史数据、盈利证据或交易建议。日期排除周末，未排除交易所节假日。';

export function generatePrices(seed = 42, count = 504) {
  integer(seed, '随机种子', 0, 4294967295);
  integer(count, '样本数量', 2, 100000);
  let state = seed >>> 0;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return (state + 0.5) / 4294967296; };
  const normal = () => Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random());
  const rows = [];
  const day = new Date('2020-01-02T00:00:00Z');
  let previous = 100;
  while (rows.length < count) {
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) {
      const open = Math.max(0.01, Math.round(previous * Math.exp(normal() * 0.006) * 100) / 100);
      const close = Math.max(0.01, Math.round(open * Math.exp(0.0003 + normal() * 0.012) * 100) / 100);
      rows.push({ date: day.toISOString().slice(0, 10), open, close, volume: Math.floor(100000 + random() * 900000) });
      previous = close;
    }
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return rows;
}

export function validatePrices(rows) {
  const errors = [], warnings = [];
  if (!Array.isArray(rows) || rows.length < 2) return { valid: false, errors: ['至少需要两行价格数据'], warnings };
  const seen = new Set();
  let previousDate = '';
  rows.forEach((row, index) => {
    const prefix = `第 ${index + 1} 行：`;
    if (!row || typeof row !== 'object') { errors.push(prefix + '缺少数据'); return; }
    const date = typeof row.date === 'string' ? row.date : '';
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) errors.push(prefix + '日期必须是有效 YYYY-MM-DD');
    if (seen.has(date)) errors.push(prefix + '日期重复');
    if (previousDate && date <= previousDate) errors.push(prefix + '日期必须严格递增，不会自动排序');
    seen.add(date); previousDate = date;
    for (const field of ['open', 'close']) {
      if (typeof row[field] !== 'number' || !Number.isFinite(row[field]) || row[field] <= 0) errors.push(prefix + `${field} 必须为正的有限数字`);
    }
    if (typeof row.volume !== 'number' || !Number.isFinite(row.volume) || row.volume < 0 || !Number.isInteger(row.volume)) errors.push(prefix + 'volume 必须是非负整数');
    else if (row.volume === 0) warnings.push(prefix + '成交量为 0，该日不执行订单');
    if (!Number.isNaN(parsed.valueOf()) && [0, 6].includes(parsed.getUTCDay())) warnings.push(prefix + '日期为周末，请核对市场日历');
    if (index && rows[index - 1]?.close > 0 && row.open > 0 && Math.abs(row.open / rows[index - 1].close - 1) > 0.3) warnings.push(prefix + '隔夜价格变化超过 30%，请核对复权、拆股或异常值');
  });
  warnings.push('仅核验格式与基础数值；还需人工核对数据许可、复权口径、上市/退市样本、交易日历与停牌信息。');
  return { valid: errors.length === 0, errors, warnings };
}

export function runBacktest(prices, { fast = 10, slow = 40, costBps = 10, slippageBps = 5, initialCash = 100000, trainFraction = 0.7 } = {}) {
  const validation = validatePrices(prices);
  if (!validation.valid) throw new Error(validation.errors.join('；'));
  integer(fast, '快均线', 1, 100000);
  integer(slow, '慢均线', 2, 100000);
  if (fast >= slow) throw new Error('快均线必须小于慢均线');
  if (prices.length < slow + 2) throw new Error('数据至少需要慢均线窗口 + 2 行，以完成预热和成交');
  bound(costBps, '单边手续费（bps）', 0, 1000);
  bound(slippageBps, '单边滑点（bps）', 0, 1000);
  if (finite(initialCash, '初始现金') <= 0) throw new Error('初始现金必须大于 0');
  bound(trainFraction, '训练集占比', 0.1, 0.9);
  const splitIndex = Math.floor(prices.length * trainFraction);
  if (splitIndex <= slow) throw new Error('训练集必须大于慢均线窗口，请增加数据或训练集占比');
  const fee = costBps / 10000, slip = slippageBps / 10000;
  let cash = initialCash, shares = 0, previousEquity = initialCash, previousSignal = 0;
  let fastSum = 0, slowSum = 0, totalCost = 0;
  let benchmarkShares = 0, benchmarkCash = initialCash, previousBenchmark = initialCash;
  const rows = [], transactions = [], returns = [], benchmarkReturns = [];
  for (let i = 0; i < prices.length; i++) {
    const { date, open, close, volume } = prices[i];
    const oldShares = shares, previousClose = i ? prices[i - 1].close : open;
    let cost = 0, turnover = 0;
    const executedSignal = previousSignal;
    if (volume > 0 && ((executedSignal === 1 && shares === 0) || (executedSignal === 0 && shares > 0))) {
      const side = executedSignal ? 'buy' : 'sell';
      const executionPrice = open * (side === 'buy' ? 1 + slip : 1 - slip);
      const quantity = side === 'buy' ? cash / (executionPrice * (1 + fee)) : shares;
      const commission = quantity * executionPrice * fee;
      const slippage = quantity * Math.abs(executionPrice - open);
      cost = commission + slippage;
      turnover = quantity * open / previousEquity;
      if (side === 'buy') { shares = quantity; cash = Math.max(0, cash - quantity * executionPrice - commission); }
      else { cash += quantity * executionPrice - commission; shares = 0; }
      transactions.push({ date, signalDate: prices[i - 1].date, side, quantity, price: executionPrice, commission, slippage, cash, shares });
    }
    const equity = cash + shares * close;
    const netReturn = equity / previousEquity - 1;
    const grossReturn = (oldShares * (open - previousClose) + shares * (close - open)) / previousEquity;
    totalCost += cost;
    // The benchmark enters at its first tradable opening and then holds fixed shares.
    if (benchmarkShares === 0 && volume > 0) {
      benchmarkShares = benchmarkCash / (open * (1 + slip) * (1 + fee));
      benchmarkCash = 0;
    }
    const benchmark = benchmarkCash + benchmarkShares * close;
    benchmarkReturns.push(benchmark / previousBenchmark - 1);
    previousBenchmark = benchmark;
    fastSum += close; slowSum += close;
    if (i >= fast) fastSum -= prices[i - fast].close;
    if (i >= slow) slowSum -= prices[i - slow].close;
    const warmup = i < slow - 1;
    const signal = !warmup && fastSum / fast > slowSum / slow ? 1 : 0;
    rows.push({ date, open, close, signal, executedSignal, position: shares * close / equity,
      turnover, grossReturn, netReturn, equity, benchmark, cash, shares, cost, warmup,
      fastAverage: i >= fast - 1 ? fastSum / fast : null, slowAverage: !warmup ? slowSum / slow : null });
    returns.push(netReturn);
    previousEquity = equity; previousSignal = signal;
  }
  return { rows, metrics: riskMetrics(returns), benchmarkMetrics: riskMetrics(benchmarkReturns),
    trainMetrics: riskMetrics(returns.slice(0, splitIndex)), testMetrics: riskMetrics(returns.slice(splitIndex)),
    trades: transactions.length, transactions, totalCost, splitIndex,
    assumptions: ['仅做多或现金、不借款、不做空；固定股数持仓，信号变化才交易。',
      '收盘计算均线，下一交易日开盘成交；停牌/零成交量日不成交，下一日重新依据最新信号。',
      '手续费按实际成交金额扣取；滑点作用于成交价格，现金足额后才买入。',
      '回测允许碎股且假设有足够流动性；整手、T+1、涨跌停、部分成交须另做执行验证。',
      '隔夜损益归属于原持仓，开盘后损益归属于成交后持仓；净收益与现金账本对账。',
      '年化采用 252 期、样本标准差、无风险利率为 0；短样本年化与夏普不稳定。',
      '基准在首个可成交日开盘买入并持有，也扣买入成本；策略预热时持有现金。',
      '按时间顺序分训练/测试，测试段延续既有持仓；没有自动选参，反复查看测试结果会污染样本外。',
      '期末按收盘价估值而不强制卖出，未扣尚未发生的退出成本；未建模现金利息及税种差异。',
      '真实数据必须保证开盘/收盘使用一致复权口径；本引擎未单独处理分红、拆股与幸存者偏差。'] };
}

export function orderSimulation({ side, quantity, price, cash, holdings, availableShares = holdings,
  lotSize = 100, maxParticipation = 0.1, volume, tradable = true, halted = false }) {
  if (!['buy', 'sell'].includes(side)) throw new Error('side 必须是 buy 或 sell');
  integer(quantity, '申报数量'); integer(lotSize, '交易单位'); integer(volume, '当日成交量', 0, Number.MAX_SAFE_INTEGER);
  if (finite(price, '委托价格') <= 0) throw new Error('委托价格必须大于 0');
  bound(cash, '可用现金', 0, Number.MAX_VALUE);
  integer(holdings, '持仓数量', 0, Number.MAX_SAFE_INTEGER);
  integer(availableShares, '可卖数量', 0, holdings);
  bound(maxParticipation, '成交参与上限', 0, 1);
  if (typeof tradable !== 'boolean' || typeof halted !== 'boolean') throw new Error('可交易/停牌状态必须是布尔值');
  const reject = reason => ({ status: 'rejected', filled: 0, remaining: quantity, cash, holdings, reason });
  if (halted || !tradable) return reject(halted ? '标的停牌，不能成交' : '标的不在可交易状态（例如价格限制）');
  if (quantity % lotSize !== 0) return reject(`教学规则：数量必须是 ${lotSize} 的整数倍；真实市场零股卖出规则须另核对`);
  if (side === 'sell' && quantity > availableShares) return reject('可卖库存不足（可能受到 T+1 或冻结限制）');
  if (side === 'buy' && quantity * price > cash + 1e-8) return reject('可用现金不足，订单被拒绝');
  const liquidity = Math.floor(volume * maxParticipation / lotSize) * lotSize;
  const filled = Math.min(quantity, liquidity);
  if (!filled) return reject('参与率限制下不足一个交易单位，没有成交');
  const remaining = quantity - filled;
  return { status: remaining ? 'partial' : 'filled', filled, remaining,
    cash: cash + (side === 'buy' ? -1 : 1) * filled * price,
    holdings: holdings + (side === 'buy' ? 1 : -1) * filled,
    reason: remaining ? '成交量参与上限导致部分成交；未成交余量不会自动视为成交' : '按指定价格完成模拟成交（此练习未计手续费）' };
}

/** Small RFC-4180 style parser; rejects empty numeric fields instead of coercing to zero. */
export function parsePriceCsv(text) {
  if (typeof text !== 'string') throw new Error('CSV 必须为文本');
  const records = []; let record = [], field = '', quoted = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let i = 0; i <= source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else if (ch === undefined) throw new Error('CSV 引号未闭合');
      else field += ch;
    } else if (ch === '"' && !field) quoted = true;
    else if (ch === ',') { record.push(field.trim()); field = ''; }
    else if (ch === '\n' || ch === undefined) {
      record.push(field.trim()); field = '';
      if (record.some(value => value !== '')) records.push(record);
      record = [];
    } else if (ch !== '\r') field += ch;
  }
  if (!records.length) throw new Error('CSV 为空');
  const headers = records.shift().map(value => value.toLowerCase());
  const required = ['date', 'open', 'close', 'volume'];
  if (required.some(key => headers.filter(header => header === key).length !== 1)) throw new Error('CSV 需要且只能有一列 date、open、close、volume');
  const rows = records.map((values, index) => {
    if (values.length !== headers.length) throw new Error(`CSV 第 ${index + 2} 行列数不一致`);
    const row = {};
    for (const key of required) {
      const value = values[headers.indexOf(key)];
      if (!value) throw new Error(`CSV 第 ${index + 2} 行 ${key} 为空`);
      row[key] = key === 'date' ? value : Number(value);
    }
    return row;
  });
  const validation = validatePrices(rows);
  if (!validation.valid) throw new Error(validation.errors.join('；'));
  return rows;
}

export function pricesToCsv(rows) {
  const validation = validatePrices(rows);
  if (!validation.valid) throw new Error(validation.errors.join('；'));
  return 'date,open,close,volume\n' + rows.map(row => `${row.date},${row.open},${row.close},${row.volume}`).join('\n') + '\n';
}
