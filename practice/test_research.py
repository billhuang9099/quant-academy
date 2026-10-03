"""Run from practice: python -m unittest test_research.py -v"""
import copy
import csv
import json
from pathlib import Path
import tempfile
import unittest

from research import generate_prices, main, read_prices, risk_metrics, run_backtest, validate_prices


def hand_data():
    return [{"date": f"2024-01-{i + 1:02}", "open": [10, 10, 20, 15, 9, 10, 12, 12][i],
             "close": close, "volume": 100000} for i, close in enumerate([10, 12, 14, 11, 10, 12, 13, 12])]


class ResearchTests(unittest.TestCase):
    def test_hand_accounting_with_gap(self):
        result = run_backtest(hand_data(), fast=1, slow=2, initial_cash=100, cost_bps=0, slippage_bps=0)
        self.assertEqual(result["rows"][1]["shares"], 0)
        self.assertEqual(result["rows"][2]["shares"], 5)
        self.assertAlmostEqual(result["rows"][2]["equity"], 70)
        self.assertAlmostEqual(result["rows"][3]["equity"], 55)
        self.assertAlmostEqual(result["rows"][4]["equity"], 45)
        self.assertEqual(result["transactions"][0]["signalDate"], "2024-01-02")
        self.assertEqual(result["transactions"][0]["price"], 20)

    def test_future_cannot_change_the_past(self):
        prices = hand_data()
        options = {"fast": 1, "slow": 2, "initial_cash": 100}
        original = run_backtest(prices, **options)
        changed = copy.deepcopy(prices)
        for row in changed[5:]:
            row["open"] *= 3
            row["close"] *= 4
        self.assertEqual(run_backtest(changed, **options)["rows"][:5], original["rows"][:5])
        changed = copy.deepcopy(prices)
        changed[2]["close"] = 1
        self.assertEqual(run_backtest(changed, **options)["rows"][2]["shares"], original["rows"][2]["shares"])

    def test_cash_and_cost_reconcile(self):
        result = run_backtest(hand_data(), fast=1, slow=2, initial_cash=100, cost_bps=20, slippage_bps=30)
        previous, cash, shares = 100, 100, 0
        for row in result["rows"]:
            self.assertAlmostEqual(row["grossReturn"] - row["cost"] / previous, row["netReturn"])
            self.assertAlmostEqual(row["cash"] + row["shares"] * row["close"], row["equity"])
            self.assertGreaterEqual(row["cash"], 0)
            previous = row["equity"]
        for trade in result["transactions"]:
            direction = 1 if trade["side"] == "buy" else -1
            cash -= direction * trade["quantity"] * trade["price"] + trade["commission"]
            shares += direction * trade["quantity"]
            self.assertAlmostEqual(cash, trade["cash"])
            self.assertAlmostEqual(shares, trade["shares"])
        self.assertAlmostEqual(result["totalCost"], sum(t["commission"] + t["slippage"] for t in result["transactions"]))

    def test_metrics_by_hand_and_cost_monotonic(self):
        metrics = risk_metrics([0.1, -0.1], periods=2)
        self.assertAlmostEqual(metrics["totalReturn"], -0.01)
        self.assertAlmostEqual(metrics["volatility"], 0.2)
        self.assertIsNone(risk_metrics([0, 0])["sharpe"])
        prices = generate_prices()
        free = run_backtest(prices, cost_bps=0, slippage_bps=0)
        paid = run_backtest(prices, cost_bps=30, slippage_bps=20)
        self.assertLess(paid["metrics"]["totalReturn"], free["metrics"]["totalReturn"])
        self.assertEqual(free["trades"], paid["trades"])
        self.assertAlmostEqual(paid["testMetrics"]["totalReturn"],
                               paid["rows"][-1]["equity"] / paid["rows"][paid["splitIndex"] - 1]["equity"] - 1)

    def test_bad_inputs_and_untradable_day(self):
        for options in [{"fast": 0}, {"fast": 40, "slow": 10}, {"cost_bps": -1},
                        {"slippage_bps": float("nan")}, {"initial_cash": 0}, {"train_fraction": 1}]:
            with self.assertRaises(ValueError):
                run_backtest(generate_prices(), **options)
        for row_change in [{"close": 0}, {"volume": -1}, {"date": "2024-02-30"}]:
            prices = hand_data()
            prices[0].update(row_change)
            with self.assertRaises(ValueError):
                validate_prices(prices)
        prices = hand_data()
        prices[2]["volume"] = 0
        result = run_backtest(prices, fast=1, slow=2)
        self.assertEqual(result["rows"][2]["shares"], 0)
        self.assertGreater(result["rows"][3]["shares"], 0)

    def test_single_file_cli_outputs_and_reproducibility(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            data = path / "sample.csv"
            output = path / "results"
            self.assertEqual(main(["--generate-sample", str(data), "--output", str(output)]), 0)
            self.assertEqual(read_prices(data), generate_prices())
            report = json.loads((output / "metrics.json").read_text(encoding="utf-8"))
            self.assertEqual(report["input"]["source"], "synthetic")
            self.assertEqual(report["input"]["rowCount"], 504)
            with (output / "trades.csv").open() as handle:
                trades = list(csv.DictReader(handle))
            self.assertEqual(len(trades), report["trades"])
            with (output / "equity.csv").open() as handle:
                rows = list(csv.DictReader(handle))
            self.assertEqual(len(rows), 504)
            self.assertAlmostEqual(float(rows[-1]["equity"]) / 100000 - 1, report["metrics"]["totalReturn"])
            original = data.read_bytes()
            self.assertEqual(main(["--generate-sample", str(data), "--output", str(output)]), 2)
            self.assertEqual(data.read_bytes(), original)


if __name__ == "__main__":
    unittest.main()
