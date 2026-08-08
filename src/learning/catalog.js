export const MODULES = [
  { id: "foundations", title: "基础认知", color: "#ff7a59" },
  { id: "risk-return", title: "收益风险", color: "#f1b84b" },
  { id: "backtesting", title: "回测验证", color: "#55b987" },
  { id: "factors", title: "因子选股", color: "#75a7d8" },
  { id: "strategy", title: "策略规则", color: "#9a83d1" },
  { id: "portfolio", title: "组合管理", color: "#d37ba2" },
  { id: "execution", title: "执行系统", color: "#e06f68" },
  { id: "python", title: "Python 实战", color: "#a8ce4d" }
];

const question = (moduleId, index, prompt, answer, accepted = []) => ({
  id: `${moduleId}-${index}`, moduleId, prompt, answer, accepted: accepted.length ? accepted : [answer]
});

export const QUESTIONS = [
  question("foundations", 0, "哪一项最接近完整的量化策略？", "2"),
  question("foundations", 1, "计算机自动执行是否等于策略可靠？", "1"),
  question("foundations", 2, "量化假设必须能够被数据怎样处理？", "证伪", ["证伪", "否定", "推翻"]),
  question("foundations", 3, "20 个无效信号按 5% 显著性筛选，期望几个假阳性？", "1", ["1", "1个", "一个"]),
  question("risk-return", 0, "哪个指标描述净值从历史高点到低点的路径损失？", "1"),
  question("risk-return", 1, "相同年化收益是否意味着相同风险体验？", "1"),
  question("risk-return", 2, "超过 VaR 阈值后的平均损失叫什么？", "CVaR", ["cvar", "条件风险价值", "预期损失"]),
  question("risk-return", 3, "先涨 20% 再跌 20%，累计收益是多少？", "-4%", ["-4%", "-4", "负4%", "负4"]),
  question("backtesting", 0, "财务因子的信息可用日应优先使用哪个日期？", "1"),
  question("backtesting", 1, "测试集不佳后是否应继续调参直到通过？", "1"),
  question("backtesting", 2, "只使用当前存续股票会产生什么偏差？", "幸存者", ["幸存者", "生存者", "幸存者偏差", "生存者偏差"]),
  question("backtesting", 3, "年换手 12 倍、单边成本 10bp，年度拖累约多少？", "1.2%", ["1.2%", "1.2", "约1.2%"]),
  question("factors", 0, "因子分层回测最希望看到什么特征？", "1"),
  question("factors", 1, "高 IC 是否保证扣费后盈利？", "1"),
  question("factors", 2, "剔除行业和市值暴露的过程叫什么？", "中性化", ["中性化", "风险中性化"]),
  question("factors", 3, "12 个月中 8 个月 IC 为正，胜率约多少？", "67%", ["67%", "67", "约67%"]),
  question("strategy", 0, "稳健参数通常应位于怎样的区域？", "1"),
  question("strategy", 1, "退出规则是否只影响收益而不影响风险？", "1"),
  question("strategy", 2, "避免阈值附近反复交易可设置什么？", "缓冲区", ["缓冲区", "缓冲", "buffer"]),
  question("strategy", 3, "毛优势 18bp、成本 12bp，净优势是多少？", "6bp", ["6bp", "6", "6个基点"]),
  question("portfolio", 0, "什么最能揭示多只股票仍高度集中？", "1"),
  question("portfolio", 1, "低波资产权重更高是否必然实现风险平价？", "1"),
  question("portfolio", 2, "拆分组合收益来源的过程叫什么？", "归因", ["归因", "绩效归因"]),
  question("portfolio", 3, "两资产各 50%、波动均 20%、相关为 0，组合波动约多少？", "14.1%", ["14.1%", "14.14%", "约14.1%", "0.141"]),
  question("execution", 0, "重复提交不造成重复交易的性质叫什么？", "1"),
  question("execution", 1, "限价单是否一定比市价单成本低？", "1"),
  question("execution", 2, "自身成交量占同期市场成交量的比例叫什么？", "参与率", ["参与率", "成交参与率"]),
  question("execution", 3, "目标 1500 股、当前 900 股、未成交买单 200 股，应新增多少？", "400", ["400", "400股"]),
  question("python", 0, "收盘后信号验证次日收益最关键的操作是什么？", "1"),
  question("python", 1, "代码无报错是否说明回测逻辑正确？", "1"),
  question("python", 2, "pandas 的滚动窗口方法叫什么？", "rolling", ["rolling", ".rolling", "rolling()"]),
  question("python", 3, "权重 [50%,50%] 调至 [60%,40%]，绝对变化和口径换手多少？", "20%", ["20%", "20", "0.2"])
];

export const QUESTION_BY_ID = Object.fromEntries(QUESTIONS.map(item => [item.id, item]));

export const PYTHON_PREP = [
  {
    id: "environment",
    title: "环境与可复现项目",
    duration: "35 分钟",
    summary: "安装 Python，建立虚拟环境、requirements 与清晰目录。",
    code: "python -m venv .venv\nsource .venv/bin/activate\npip install pandas numpy matplotlib pytest",
    task: "创建 data/raw、data/clean、notebooks、src、tests 五个目录，并保存依赖版本。"
  },
  {
    id: "pandas",
    title: "pandas 与时间索引",
    duration: "50 分钟",
    summary: "读取价格 CSV，处理日期、排序、重复值、缺失与数值类型。",
    code: "df = pd.read_csv(path, parse_dates=['date'])\ndf = df.sort_values(['symbol', 'date'])\nassert not df.duplicated(['symbol', 'date']).any()",
    task: "对一份价格数据输出行数、日期范围、重复行、缺失率和异常价格报告。"
  },
  {
    id: "returns",
    title: "收益、rolling 与 shift",
    duration: "60 分钟",
    summary: "明确 t 时点信息与 t+1 收益，避免最常见的未来函数。",
    code: "df['ret_1d'] = df.groupby('symbol').close.pct_change()\ndf['mom_20'] = df.groupby('symbol').close.pct_change(20)\ndf['future_ret'] = df.groupby('symbol').ret_1d.shift(-1)",
    task: "用 6 行手工数据验证 shift 方向，并写一个断言证明信号没有使用未来价格。"
  },
  {
    id: "first-backtest",
    title: "第一个可审计回测",
    duration: "90 分钟",
    summary: "生成信号、目标持仓、换手、成本、净收益和净值。",
    code: "position = signal.shift(1).fillna(0)\nturnover = position.diff().abs().fillna(0)\nnet_ret = position * returns - turnover * cost\nequity = (1 + net_ret).cumprod()",
    task: "完成一个均线或动量策略，输出毛/净收益、最大回撤、换手和参数敏感性。"
  }
];
