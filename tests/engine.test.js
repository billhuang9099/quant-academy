import test from 'node:test';
import assert from 'node:assert/strict';
import { compound, riskMetrics, portfolioRisk, positionSize, generatePrices, validatePrices,
  runBacktest, orderSimulation, parsePriceCsv, pricesToCsv } from '../src/academy/engine.js';

const near = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
const sample = () => [10, 12, 14, 11, 10, 12, 13, 12].map((close, i) => ({
  date: `2024-01-${String(i + 1).padStart(2, '0')}`, open: [10, 10, 20, 15, 9, 10, 12, 12][i], close, volume: 100000,
}));

test('复利、最大回撤与回本涨幅使用手算结果，而非收益简单相加', () => {
  const result = compound([0.1, -0.2, 0.25]);
  near(result.totalReturn, 0.1); near(result.maxDrawdown, 0.2); near(result.recoveryRequired, 0.25);
  assert.deepEqual(result.equity.map(x => Math.round(x * 100)), [100, 110, 88, 110]);
  assert.equal(compound([-1]).recoveryRequired, null);
  assert.throws(() => compound([-1.01])); assert.throws(() => compound([NaN]));
});

test('风险指标使用样本标准差与几何年化；零波动夏普不伪造数值', () => {
  const r = riskMetrics([0.1, -0.1], 2);
  near(r.totalReturn, -0.01); near(r.annualizedReturn, -0.01); near(r.volatility, 0.2); near(r.sharpe, 0);
  assert.equal(riskMetrics([0, 0]).sharpe, null);
  assert.deepEqual(riskMetrics([]).equity, [1]);
});

test('分散化和整手仓位遵循手算与现金限制', () => {
  near(portfolioRisk(0.5, 0.2, 0.2, 1), 0.2);
  near(portfolioRisk(0.5, 0.2, 0.2, -1), 0);
  near(portfolioRisk(0.5, 0.2, 0.2, 0), Math.sqrt(0.02));
  assert.deepEqual(positionSize({ equity: 100000, riskPercent: 0.01, entry: 20, stop: 18 }),
    { shares: 500, riskCash: 1000, notional: 10000, actualRisk: 1000 });
  assert.equal(positionSize({ equity: 1000, riskPercent: 0.9, entry: 10, stop: 9, maxWeight: 0.5 }).shares, 0);
  assert.throws(() => positionSize({ equity: 100, riskPercent: 0.1, entry: 5, stop: 6 }));
});

test('可复现合成数据排周末，CSV 往返且拒绝空值/错日期/重复/乱序', () => {
  const rows = generatePrices(42, 80);
  assert.deepEqual(rows, generatePrices(42, 80));
  assert.notDeepEqual(rows, generatePrices(43, 80));
  assert.ok(rows.every(row => ![0, 6].includes(new Date(row.date).getUTCDay())));
  assert.equal(validatePrices(rows).valid, true);
  assert.deepEqual(parsePriceCsv(pricesToCsv(rows)), rows);
  for (const changed of [
    [{ ...rows[0], date: '2024-02-30' }, ...rows.slice(1)],
    [rows[0], rows[0]], [...rows].reverse(),
    [{ ...rows[0], close: 0 }, ...rows.slice(1)],
    [{ ...rows[0], volume: -1 }, ...rows.slice(1)],
  ]) assert.equal(validatePrices(changed).valid, false);
  assert.throws(() => parsePriceCsv('date,open,close,volume\n2024-01-01,10,11,\n2024-01-02,11,12,20'));
});

test('收盘信号只能次日开盘成交：含跳空的手算现金账本', () => {
  const result = runBacktest(sample(), { fast: 1, slow: 2, initialCash: 100, costBps: 0, slippageBps: 0 });
  assert.equal(result.rows[0].warmup, true); assert.equal(result.rows[1].warmup, false);
  assert.equal(result.rows[1].signal, 1); assert.equal(result.rows[1].shares, 0);
  near(result.rows[2].shares, 5); near(result.rows[2].equity, 70);
  near(result.rows[3].equity, 55); near(result.rows[4].equity, 45);
  assert.equal(result.transactions[0].signalDate, '2024-01-02');
  near(result.transactions[0].price, 20); near(result.transactions[1].price, 9);
  near(result.rows[4].grossReturn, 9 / 11 - 1);
  near(result.rows.at(-1).equity / 100 - 1, result.metrics.totalReturn);
});

test('未来价格不影响过去结果，同日收盘不决定同日开盘下单', () => {
  const data = sample(); const options = { fast: 1, slow: 2, initialCash: 100, costBps: 10, slippageBps: 5 };
  const original = runBacktest(data, options);
  const futureChanged = data.map((row, i) => i < 5 ? row : { ...row, open: row.open * 3, close: row.close * 4 });
  assert.deepEqual(runBacktest(futureChanged, options).rows.slice(0, 5), original.rows.slice(0, 5));
  const currentChanged = data.map((row, i) => i === 2 ? { ...row, close: 1 } : row);
  near(runBacktest(currentChanged, options).rows[2].shares, original.rows[2].shares);
  assert.equal(original.rows[2].executedSignal, original.rows[1].signal);
});

test('每根K线毛收益减成本等于净收益，成交后的现金与持仓逐笔对账', () => {
  const result = runBacktest(sample(), { fast: 1, slow: 2, initialCash: 100, costBps: 20, slippageBps: 30 });
  let before = 100, cash = 100, shares = 0;
  for (const row of result.rows) {
    near(row.grossReturn - row.cost / before, row.netReturn);
    near(row.cash + row.shares * row.close, row.equity);
    assert.ok(row.cash >= 0 && row.shares >= 0 && row.position <= 1 + 1e-12);
    before = row.equity;
  }
  for (const trade of result.transactions) {
    cash += (trade.side === 'buy' ? -1 : 1) * trade.quantity * trade.price - trade.commission;
    shares += (trade.side === 'buy' ? 1 : -1) * trade.quantity;
    near(cash, trade.cash); near(shares, trade.shares);
  }
  near(result.totalCost, result.transactions.reduce((sum, t) => sum + t.commission + t.slippage, 0));
});

test('成本增加不会改善同一信号策略的净收益；样本外延续历史仓位', () => {
  const data = generatePrices();
  const free = runBacktest(data, { costBps: 0, slippageBps: 0 });
  const paid = runBacktest(data, { costBps: 30, slippageBps: 20 });
  assert.ok(paid.trades > 0); assert.equal(paid.trades, free.trades);
  assert.ok(paid.metrics.totalReturn < free.metrics.totalReturn);
  near(paid.testMetrics.totalReturn, paid.rows.at(-1).equity / paid.rows[paid.splitIndex - 1].equity - 1);
  assert.equal(paid.rows[paid.splitIndex].executedSignal, paid.rows[paid.splitIndex - 1].signal);
});

test('非法回测参数抛错，零成交量开盘不成交', () => {
  const data = generatePrices(42, 80);
  for (const options of [{ fast: 0 }, { fast: 40, slow: 10 }, { slow: 1.5 }, { costBps: -1 }, { slippageBps: NaN },
    { initialCash: 0 }, { trainFraction: 1 }, { slow: 79 }, { slow: 50, trainFraction: 0.5 }]) {
    assert.throws(() => runBacktest(data, options));
  }
  const halted = sample(); halted[2].volume = 0;
  const result = runBacktest(halted, { fast: 1, slow: 2 });
  assert.equal(result.rows[2].shares, 0); assert.ok(result.rows[3].shares > 0);
});

test('订单训练区分拒单、部分成交和不可卖库存，不能把申报视为成交', () => {
  const order = { side: 'buy', quantity: 1000, price: 10, cash: 20000, holdings: 0, availableShares: 0,
    volume: 4000, maxParticipation: 0.1, lotSize: 100, tradable: true, halted: false };
  const partial = orderSimulation(order);
  assert.equal(partial.status, 'partial'); assert.equal(partial.filled, 400); assert.equal(partial.remaining, 600);
  assert.equal(partial.cash, 16000); assert.equal(partial.holdings, 400);
  assert.equal(orderSimulation({ ...order, cash: 100 }).status, 'rejected');
  assert.equal(orderSimulation({ ...order, halted: true }).status, 'rejected');
  assert.equal(orderSimulation({ ...order, quantity: 150 }).status, 'rejected');
  const locked = orderSimulation({ ...order, side: 'sell', holdings: 1000, availableShares: 0 });
  assert.equal(locked.filled, 0); assert.equal(locked.holdings, 1000); assert.match(locked.reason, /可卖库存不足/);
  const sold = orderSimulation({ ...order, side: 'sell', quantity: 200, holdings: 1000, availableShares: 500 });
  assert.equal(sold.status, 'filled'); assert.equal(sold.holdings, 800); assert.equal(sold.cash, 22000);
});
