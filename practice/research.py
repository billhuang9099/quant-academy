#!/usr/bin/env python3
"""Quant Academy: reproducible, standard-library-only long/cash research.

Python 3.10+. This program never connects to a broker or submits a live order.
Single-file quick start:
  python research.py --generate-sample prices.csv --output results
Existing data:
  python research.py --data prices.csv --fast 10 --slow 40 --output results
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import statistics
import sys

SYNTHETIC_NOTICE = (
    "合成日线，只用于学习计算，不是市场历史数据或盈利证据；"
    "排除周末但没有排除交易所节假日。"
)
ASSUMPTIONS = [
    "做多或现金，不借款不做空；允许碎股，假设有足够流动性。",
    "当日收盘计算均线，次日开盘成交；零成交量日不执行订单。",
    "成交价承受不利滑点，实际成交金额扣单边手续费；买入量受现金约束。",
    "隔夜损益归原持仓，开盘后损益归新持仓，股数只在信号变化时调整。",
    "基准在首个可成交日开盘买入持有，含买入费用；策略预热期持有现金。",
    "时间顺序划分训练/测试；测试段延续原有持仓，不自动选参。",
    "年化 252 期、样本标准差、无风险利率 0；短样本年化和夏普不稳定。",
    "期末按收盘价估值，不强制卖出，不扣尚未发生的退出成本。",
    "未建模税种差异、T+1、涨跌停、整手、部分成交、现金利息。",
    "必须人工核对许可、复权一致性、分红拆股、退市样本、交易所日历与停牌。",
    "反复看测试段调参会污染样本外；回测或模拟通过都不保证实盘盈利。",
]


def finite(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{label} 必须是有限数字")
    return value


def integer(value, label, minimum=1, maximum=1000000):
    finite(value, label)
    if int(value) != value or not minimum <= value <= maximum:
        raise ValueError(f"{label} 必须是 {minimum} 到 {maximum} 之间的整数")
    return int(value)


def generate_prices(seed=42, count=504):
    """Same seeded LCG/Box-Muller sample as the JavaScript learning engine."""
    integer(seed, "种子", 0, 4294967295)
    integer(count, "样本数量", 2, 100000)
    state = seed

    def uniform():
        nonlocal state
        state = (state * 1664525 + 1013904223) & 0xFFFFFFFF
        return (state + 0.5) / 4294967296

    def normal():
        return math.sqrt(-2 * math.log(uniform())) * math.cos(2 * math.pi * uniform())

    rows, previous = [], 100
    day = dt.date(2020, 1, 2)
    while len(rows) < count:
        if day.weekday() < 5:
            opening = max(0.01, math.floor(previous * math.exp(normal() * 0.006) * 100 + 0.5) / 100)
            close = max(0.01, math.floor(opening * math.exp(0.0003 + normal() * 0.012) * 100 + 0.5) / 100)
            rows.append({"date": day.isoformat(), "open": opening, "close": close,
                         "volume": math.floor(100000 + uniform() * 900000)})
            previous = close
        day += dt.timedelta(days=1)
    return rows


def validate_prices(rows):
    if not isinstance(rows, list) or len(rows) < 2:
        raise ValueError("至少需要两行价格数据")
    previous_date = ""
    warnings = []
    for index, row in enumerate(rows, 1):
        if not isinstance(row, dict):
            raise ValueError(f"第 {index} 行没有字段")
        date = row.get("date", "")
        try:
            parsed = dt.date.fromisoformat(date)
        except (TypeError, ValueError):
            raise ValueError(f"第 {index} 行日期无效，须为 YYYY-MM-DD") from None
        if parsed.isoformat() != date or date <= previous_date:
            raise ValueError(f"第 {index} 行日期须标准格式、唯一且严格递增")
        previous_date = date
        for name in ["open", "close"]:
            if finite(row.get(name), f"第 {index} 行 {name}") <= 0:
                raise ValueError(f"第 {index} 行 {name} 须为正数")
        volume = finite(row.get("volume"), f"第 {index} 行 volume")
        if volume < 0 or int(volume) != volume:
            raise ValueError(f"第 {index} 行 volume 须为非负整数")
        if volume == 0:
            warnings.append(f"第 {index} 行成交量为 0，不执行订单")
        if parsed.weekday() >= 5:
            warnings.append(f"第 {index} 行为周末，核对市场日历")
        if index > 1 and abs(row["open"] / rows[index - 2]["close"] - 1) > 0.3:
            warnings.append(f"第 {index} 行隔夜变化超过 30%，核对复权/拆股/异常")
    return warnings


def read_prices(path):
    with Path(path).open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        fields = reader.fieldnames or []
        required = ["date", "open", "close", "volume"]
        if any(fields.count(key) != 1 for key in required):
            raise ValueError("CSV 需要且只能有一列 date、open、close、volume")
        rows = []
        for index, raw in enumerate(reader, 2):
            if None in raw or any(raw.get(key) is None or not raw[key].strip() for key in required):
                raise ValueError(f"CSV 第 {index} 行列数错误或必要字段为空")
            try:
                rows.append({"date": raw["date"].strip(), "open": float(raw["open"]),
                             "close": float(raw["close"]), "volume": float(raw["volume"])})
            except ValueError:
                raise ValueError(f"CSV 第 {index} 行数值格式错误") from None
    validate_prices(rows)
    return rows


def risk_metrics(returns, periods=252):
    integer(periods, "年化期数")
    equity, peak, max_drawdown = [1.0], 1.0, 0.0
    for value in returns:
        if finite(value, "收益率") < -1:
            raise ValueError("收益率不能低于 -100%")
        equity.append(equity[-1] * (1 + value))
        peak = max(peak, equity[-1])
        max_drawdown = max(max_drawdown, (peak - equity[-1]) / peak)
    n = len(returns)
    mean = statistics.mean(returns) if n else 0
    stdev = statistics.stdev(returns) if n > 1 else 0
    return {"totalReturn": equity[-1] - 1,
            "annualizedReturn": equity[-1] ** (periods / n) - 1 if n else 0,
            "volatility": stdev * math.sqrt(periods),
            "sharpe": mean / stdev * math.sqrt(periods) if stdev > 1e-14 else None,
            "maxDrawdown": max_drawdown, "equity": equity}


def run_backtest(prices, fast=10, slow=40, cost_bps=10, slippage_bps=5,
                 initial_cash=100000, train_fraction=0.7):
    warnings = validate_prices(prices)
    integer(fast, "快均线", 1, 100000)
    integer(slow, "慢均线", 2, 100000)
    if fast >= slow:
        raise ValueError("快均线必须小于慢均线")
    if len(prices) < slow + 2:
        raise ValueError("至少需要慢均线窗口 + 2 行")
    for value, label in [(cost_bps, "手续费"), (slippage_bps, "滑点")]:
        if not 0 <= finite(value, label) <= 1000:
            raise ValueError(f"{label} 必须在 0 到 1000 bps 之间")
    if finite(initial_cash, "初始现金") <= 0:
        raise ValueError("初始现金必须大于 0")
    if not 0.1 <= finite(train_fraction, "训练占比") <= 0.9:
        raise ValueError("训练占比须在 0.1 到 0.9 之间")
    split = math.floor(len(prices) * train_fraction)
    if split <= slow:
        raise ValueError("训练集必须大于慢均线窗口")
    fee, slip = cost_bps / 10000, slippage_bps / 10000
    cash, shares, previous_equity, previous_signal = initial_cash, 0, initial_cash, 0
    fast_sum, slow_sum, total_cost = 0, 0, 0
    benchmark_shares, benchmark_cash, previous_benchmark = 0, initial_cash, initial_cash
    rows, trades, returns, benchmark_returns = [], [], [], []
    for i, bar in enumerate(prices):
        date, opening, close, volume = bar["date"], bar["open"], bar["close"], bar["volume"]
        old_shares = shares
        previous_close = prices[i - 1]["close"] if i else opening
        cost, turnover = 0, 0
        executed_signal = previous_signal
        if volume > 0 and ((executed_signal == 1 and shares == 0) or (executed_signal == 0 and shares > 0)):
            side = "buy" if executed_signal else "sell"
            price = opening * (1 + slip if side == "buy" else 1 - slip)
            quantity = cash / (price * (1 + fee)) if side == "buy" else shares
            commission = quantity * price * fee
            slippage = quantity * abs(price - opening)
            cost = commission + slippage
            turnover = quantity * opening / previous_equity
            if side == "buy":
                shares = quantity
                cash = max(0, cash - quantity * price - commission)
            else:
                cash += quantity * price - commission
                shares = 0
            trades.append({"date": date, "signalDate": prices[i - 1]["date"], "side": side,
                           "quantity": quantity, "price": price, "commission": commission,
                           "slippage": slippage, "cash": cash, "shares": shares})
        equity = cash + shares * close
        net_return = equity / previous_equity - 1
        gross_return = (old_shares * (opening - previous_close) + shares * (close - opening)) / previous_equity
        total_cost += cost
        if benchmark_shares == 0 and volume > 0:
            benchmark_shares = benchmark_cash / (opening * (1 + slip) * (1 + fee))
            benchmark_cash = 0
        benchmark = benchmark_cash + benchmark_shares * close
        benchmark_returns.append(benchmark / previous_benchmark - 1)
        previous_benchmark = benchmark
        fast_sum += close
        slow_sum += close
        if i >= fast:
            fast_sum -= prices[i - fast]["close"]
        if i >= slow:
            slow_sum -= prices[i - slow]["close"]
        warmup = i < slow - 1
        signal = int(not warmup and fast_sum / fast > slow_sum / slow)
        rows.append({"date": date, "open": opening, "close": close, "signal": signal,
                     "executedSignal": executed_signal, "position": shares * close / equity,
                     "turnover": turnover, "grossReturn": gross_return, "netReturn": net_return,
                     "equity": equity, "benchmark": benchmark, "cash": cash, "shares": shares,
                     "cost": cost, "warmup": warmup,
                     "fastAverage": fast_sum / fast if i >= fast - 1 else None,
                     "slowAverage": slow_sum / slow if not warmup else None})
        returns.append(net_return)
        previous_equity, previous_signal = equity, signal
    return {"rows": rows, "metrics": risk_metrics(returns), "benchmarkMetrics": risk_metrics(benchmark_returns),
            "trainMetrics": risk_metrics(returns[:split]), "testMetrics": risk_metrics(returns[split:]),
            "trades": len(trades), "transactions": trades, "totalCost": total_cost,
            "splitIndex": split, "assumptions": ASSUMPTIONS, "warnings": warnings}


def write_csv(path, rows, fields, exclusive=False):
    with Path(path).open("x" if exclusive else "w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data", type=Path, help="输入 CSV，默认 prices.csv")
    parser.add_argument("--generate-sample", type=Path, metavar="CSV", help="生成合成数据并回测；拒绝覆盖已有样本")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--days", type=int, default=504)
    parser.add_argument("--fast", type=int, default=10)
    parser.add_argument("--slow", type=int, default=40)
    parser.add_argument("--cost-bps", type=float, default=10)
    parser.add_argument("--slippage-bps", type=float, default=5)
    parser.add_argument("--initial-cash", type=float, default=100000)
    parser.add_argument("--train-fraction", type=float, default=0.7)
    parser.add_argument("--output", type=Path, default=Path("results"))
    args = parser.parse_args(argv)
    try:
        if args.generate_sample and args.data:
            raise ValueError("请选择 --generate-sample 或 --data，不要同时提供")
        data = args.generate_sample or args.data or Path("prices.csv")
        if args.generate_sample:
            sample = generate_prices(args.seed, args.days)
            write_csv(data, sample, ["date", "open", "close", "volume"], exclusive=True)
            print(SYNTHETIC_NOTICE)
        prices = read_prices(data)
        result = run_backtest(prices, args.fast, args.slow, args.cost_bps, args.slippage_bps,
                              args.initial_cash, args.train_fraction)
        args.output.mkdir(parents=True, exist_ok=True)
        summary = {key: value for key, value in result.items() if key not in ("rows", "transactions")}
        for key in ("metrics", "benchmarkMetrics", "trainMetrics", "testMetrics"):
            summary[key] = {name: value for name, value in summary[key].items() if name != "equity"}
        summary["input"] = {"file": data.name, "sha256": hashlib.sha256(data.read_bytes()).hexdigest(),
                            "rowCount": len(prices), "firstDate": prices[0]["date"], "lastDate": prices[-1]["date"],
                            "testStartDate": prices[result["splitIndex"]]["date"],
                            "source": "synthetic" if args.generate_sample else "user-supplied; independently verify provenance"}
        summary["parameters"] = {"fast": args.fast, "slow": args.slow, "costBps": args.cost_bps,
                                 "slippageBps": args.slippage_bps, "initialCash": args.initial_cash,
                                 "trainFraction": args.train_fraction}
        with (args.output / "metrics.json").open("w", encoding="utf-8") as handle:
            json.dump(summary, handle, ensure_ascii=False, indent=2, allow_nan=False)
            handle.write("\n")
        write_csv(args.output / "trades.csv", result["transactions"],
                  ["date", "signalDate", "side", "quantity", "price", "commission", "slippage", "cash", "shares"])
        write_csv(args.output / "equity.csv", result["rows"], list(result["rows"][0]))
        print(f"输入 {data.name}：{len(prices)} 行，测试段从 {summary['input']['testStartDate']} 开始")
        for key, label in [("metrics", "全区间"), ("trainMetrics", "训练段"), ("testMetrics", "测试段"), ("benchmarkMetrics", "买入持有基准")]:
            metric = summary[key]
            sharpe = "无定义" if metric["sharpe"] is None else f"{metric['sharpe']:.3f}"
            print(f"{label}：总收益 {metric['totalReturn']:.2%}，最大回撤 {metric['maxDrawdown']:.2%}，夏普 {sharpe}")
        print(f"成交 {result['trades']} 笔，手续费与滑点合计 {result['totalCost']:.2f}；输出：{args.output.resolve()}")
        print("请阅读 metrics.json 的假设与警告，并核对 trades.csv 的成交和 equity.csv 的资金。此脚本不连接实盘。")
        return 0
    except (ValueError, OSError, OverflowError) as error:
        print(f"错误：{error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
