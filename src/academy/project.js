import { getValue, getRecords, putValue, lessonStatus, downloadFile } from './state.js';
import { escapeHTML } from './labs.js';

const PROJECT_FIELDS = [
  { id: 'hypothesis', title: '1. 研究假设与失败条件', hint: '你研究哪类股票 / ETF、为什么可能存在优势、持有多久？预先写出至少两个能否定假设的观察结果。不要用“回测好看”代替机制。', placeholder: '可投资池与市场是……我预计……，因为……。若样本外出现……或成本提高后……，我将放弃 / 暂停这个假设。' },
  { id: 'data', title: '2. 数据与信息时间', hint: '记录来源、许可、下载日期、币种、时区、原始 / 复权价格口径、分红与退市处理。如何检查缺失、重复、停牌与真实交易日历？每项数据何时可知？', placeholder: '数据来自……，覆盖……。一行代表……。复权与分红采用……。我保留原始文件……。对缺失 / 重复 / 停牌的处理是……，信号可获知时间是……。' },
  { id: 'method', title: '3. 规则、样本外与基准', hint: '让别人能照着复做：入场、退出、权重、订单时点、费用 / 滑点、数量规则。写开发 / 验证 / 最终留出日期，以及同口径基准；记录试过的全部参数。', placeholder: '信号为……，在……计算，最早于……成交。仓位规则……。成本假设……。开发期……，验证期……，最终未见区间……。基准……，参数选择次数……。' },
  { id: 'results', title: '4. 结果与反证', hint: '填写实际运行的指标及证据文件位置：扣费收益、基准差异、回撤、交易数、各阶段表现。比较成本翻倍 / 延迟执行 / 参数扰动。合成行情只能验证流程。', placeholder: '本次结果来自真实历史 / 合成数据……，代码版本……。样本外收益……，基准……，最大回撤……，交易次数……。结果文件位于……。压力测试后……。当前证据不足的地方……。' },
  { id: 'risk', title: '5. 风险预算与停机线', hint: '明确可承受损失、单资产 / 总仓位上限、现金余量、跳空情景、最大订单限制，以及触发暂停的量化条件。止损价不是保证成交价。', placeholder: '研究账户假设权益……，单笔计划风险……，仓位和现金约束……。若跳空 / 流动性消失……。触发……时停止新增订单，已有持仓的处理步骤……。' },
  { id: 'operations', title: '6. 执行、对账与异常处理', hint: '核实具体品种和券商的权限、订单类型、时段、数量步长、可卖 / 结算规则、费用与税。写数据中断、拒单、部分成交、重复订单、重启后的检查及停机 / 恢复方案。', placeholder: '待使用券商与品种……，已核实的规则及官方来源……，仍未知……。信号 / 订单 / 成交使用……编号。每日对账比较……。异常时……停止 / 撤单 / 联系券商；只有……后恢复。' },
];
const TABS = [
  ['plan', '研究方案'], ['code', '运行代码'], ['journal', '前向日志'], ['assessment', '验收自查'],
];
let activeTab = 'plan';
// Unsaved text stays in this tab's memory across workspace rerenders and routes.
// It is deliberately separate from saved evidence and cloud-sync completion records.
const formDrafts = new Map();
const PROJECT_FORMS = ['plan', 'code', 'drill', 'journal'];
globalThis.window?.addEventListener('beforeunload', event => {
  if (!formDrafts.size) return;
  event.preventDefault();
  event.returnValue = '';
});

function formSnapshot(form) {
  return Object.fromEntries(Array.from(form.elements).filter(control => control.name).map(control => [
    control.name, control.type === 'checkbox' ? control.checked : control.value,
  ]));
}
function restoreForm(form, snapshot) {
  for (const [name, value] of Object.entries(snapshot)) {
    const control = form.elements.namedItem(name);
    if (!control) continue;
    if (control.type === 'checkbox') control.checked = value === true;
    else control.value = value;
  }
}

function todayLocal() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
function realDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return date;
}
function textLength(value) { return [...String(value ?? '').trim().replace(/\s/g, '')].length; }
function money(value) { return Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function finiteInput(value) {
  return (typeof value === 'number' || typeof value === 'string') && String(value).trim() !== '' && Number.isFinite(Number(value));
}
function flattenLessons(lessons) {
  return Array.isArray(lessons) ? lessons.flatMap(item => Array.isArray(item.lessons) ? item.lessons : [item]) : [];
}

// Pure validation: no DOM, account connection or external verification is performed.
export function validateJournal(row, now = todayLocal()) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return '日志格式无效，请重新填写。';
  const date = realDate(row.date);
  if (!date || !realDate(now)) return '请填写真实存在的日期，格式为 YYYY-MM-DD。';
  if (row.date > now) return '不能提前填写尚未发生日期的前向日志。';
  if (date.getUTCDay() === 0 || date.getUTCDay() === 6) return '周末记录不计入股票 / ETF 前向交易日日志。';
  if (row.tradingDay !== true) return '请核实该市场当日实际开市；仅排除周末无法排除节假日。';
  if (!finiteInput(row.equity) || Number(row.equity) <= 0) return '账户权益必须是大于 0 的有限数值。';
  if (!finiteInput(row.difference) || Number(row.difference) < 0) return '对账绝对差额必须是大于或等于 0 的有限数值。';
  if (typeof row.note !== 'string' || textLength(row.note) < 30) return '请写至少 30 个非空白字符，说明信号、订单 / 未下单原因与对账观察。';
  if (typeof row.evidence !== 'string' || !row.evidence.trim()) return '请填写当日证据位置，例如模拟账户回报文件与账本路径。';
  if (typeof row.reconciled !== 'boolean') return '请明确是否已完成当日对账。';
  if (row.reconciled && Number(row.difference) !== 0) return '当前仍有对账差额，请保留未完成对账状态并记录排查结果。';
  return '';
}

function journalEntries() {
  return getRecords('journal:').map(([key, record]) => {
    const row = record.value;
    const error = validateJournal(row) || (key !== `journal:${row?.date}` ? '记录键与日期不一致，不计入有效天数。' : '');
    return { key, row, error };
  }).sort((a, b) => String(b.row?.date || b.key).localeCompare(String(a.row?.date || a.key)));
}

export function projectAssessment(lessons) {
  const all = flattenLessons(lessons);
  const valid = journalEntries().filter(entry => !entry.error);
  return {
    completed: all.filter(lesson => lessonStatus(lesson).complete).length,
    total: all.length,
    documented: PROJECT_FIELDS.filter(field => textLength(getValue(`project:${field.id}`, '')) >= 100).length,
    entries: valid.length,
    verified: valid.filter(({ row }) => row.reconciled === true && Number(row.difference) === 0).length,
    code: getValue('project:code-run', false) === true,
    drill: getValue('project:drill', false) === true,
  };
}

function stat(label, value, explanation) {
  return `<div class="stat"><span>${escapeHTML(label)}</span><strong>${escapeHTML(value)}</strong><small>${escapeHTML(explanation)}</small></div>`;
}
function planMarkup() {
  return `<article class="article-card"><h2>把想法写成可复查的研究协议</h2><p>每项至少 100 个非空白字符时显示“已留档”。字数与勾选只检查材料是否填写，不判断策略质量；引用可回查的结果和证据。</p><form data-project-plan>${PROJECT_FIELDS.map(field => {
    const value = getValue(`project:${field.id}`, '');
    return `<label class="field"><span>${field.title} <small data-count="${field.id}">${textLength(value)} / 100 字</small></span><p class="hint">${field.hint}</p><textarea name="${field.id}" rows="6" maxlength="12000" placeholder="${escapeHTML(field.placeholder)}">${escapeHTML(value)}</textarea></label>`;
  }).join('')}<button type="submit" class="primary">保存六项方案</button><p class="hint">可以先保存草稿，补足后再纳入材料统计。最终测试看过后再调参，需要重新披露该区间已参与开发。</p></form></article>`;
}
function codeMarkup() {
  return `<article class="article-card"><h2>在自己的电脑上跑通完整研究</h2><p>下载以下四个文件放进同一个文件夹。研究脚本使用 Python 3.10 或以上版本，仅依赖标准库，无需安装 pandas，也不会连接券商或下单。</p><div class="form-grid"><a class="secondary" href="./practice/research.py" download>研究脚本 research.py</a><a class="secondary" href="./practice/prices.csv" download>合成样例 prices.csv</a><a class="secondary" href="./practice/README.md" download>运行说明 README.md</a><a class="secondary" href="./practice/test_research.py" download>校验脚本 test_research.py</a></div><div class="callout">样例是固定种子的合成行情，只排除周末，不是真实市场历史或交易所日历。它用于复核代码与账本；不能把它的回测、图表或日期填入真实前向模拟日志。</div><h3>1. 确认环境与项目目录</h3><p>终端切换到保存四个文件的文件夹。macOS 输入 python3 --version，Windows 输入 py --version。下列命令中的 python 在 macOS 可替换为 python3，在 Windows 可替换为 py；如果已激活项目虚拟环境，则使用环境中的 python。</p><pre><code>python --version
python research.py --help
python -m unittest test_research.py -v</code></pre><h3>2. 用已下载的合成样例运行</h3><pre><code>python research.py --data prices.csv --fast 10 --slow 40 --cost-bps 10 --slippage-bps 5 --train-fraction 0.7 --initial-cash 100000 --output results</code></pre><p>输出位于 results/metrics.json、results/trades.csv、results/equity.csv。先检查逐笔成交与逐日现金、持仓、权益，再解释指标；文件存在不代表研究假设有效。</p><h3>3. 换成有来源的真实历史数据</h3><p>CSV 必须含 date,open,close,volume 列；日期为唯一且严格递增的 YYYY-MM-DD，价格为正，成交量为非负整数。示例是一只标的的日线。自行核实交易日历、复权口径、分红与拆股、数据许可；脚本不会自动补齐缺日或推断公司行动。</p><pre><code>python research.py --data my_prices.csv --fast 10 --slow 40 --cost-bps 10 --slippage-bps 5 --train-fraction 0.7 --initial-cash 100000 --output my_results</code></pre><p>教学执行模型为收盘形成信号、下一交易期开盘执行、现金账户与碎股，不使用杠杆。零成交量 / 不可交易时不成交；实际股票 / ETF 的整手、可卖规则、价格限制、税费与权限仍要在方案中核实。不要将这个教学模型直接当作券商交易程序。</p><h3>4. 保存运行证据与解释</h3><form data-project-code><label class="field"><span>命令、版本、结果与证据位置</span><textarea name="notes" rows="5" maxlength="12000" placeholder="运行日期 / Python 版本 / 数据来源 / 代码版本或校验值 / 实际命令 / 测试结果 / 三个输出文件位置 / 我手算核对的一笔交易……">${escapeHTML(getValue('project:code-notes', ''))}</textarea></label><label class="check-label"><input type="checkbox" name="code-run" ${getValue('project:code-run', false) === true ? 'checked' : ''}>我已亲自运行测试与研究脚本，并用逐笔账本核对结果（用户自报）</label><button type="submit" class="primary">保存运行记录</button></form></article>`;
}
function journalMarkup() {
  const entries = journalEntries();
  return `<article class="article-card"><h2>每日前向记录：先决策，再等待结果</h2><p>记录你在真实日历推进中完成的模拟账户 / 纸面交易观察。即使当天没有订单，也要解释信号、未交易原因、持仓与现金对账。事后历史回放与合成实验不属于前向记录。</p><div class="callout">这些信息由你自行填写，系统没有读取券商账户或核验证据文件。20 个无差额交易日仅是教学起点；低频策略需要更长观察期以及足够真实的信号、订单和异常情景。</div><form data-project-journal><div class="form-grid"><label class="field"><span>实际交易日</span><input type="date" name="date" value="${todayLocal()}" max="${todayLocal()}" required></label><label class="field"><span>期末账户权益（账户币种）</span><input type="number" name="equity" min="0.01" step="any" required placeholder="例如 100000"></label><label class="field"><span>对账绝对差额（同一币种与精度）</span><input type="number" name="difference" min="0" step="any" required placeholder="0 表示已无差额"></label></div><p class="hint">权益 = 现金 + 持仓市值（其他资产 / 负债另按账户口径计入）。差额填写 |账户权益 − 自己账本权益|，不能用负数抵消。资金划转、分红、费用与未完成结算要先对齐口径。</p><label class="field"><span>当日观察（至少 30 个非空白字符）</span><textarea name="note" rows="4" maxlength="6000" required placeholder="当天信号……，订单编号 / 不下单原因……，成交与未成交数量……，现金 / 持仓对账……，发现的问题及处理……"></textarea></label><label class="field"><span>证据位置（文件名、报告路径或文档链接）</span><input type="text" name="evidence" maxlength="2000" required placeholder="例如 paper/2026-10-05/broker-report.csv 与 ledger.csv"></label><p class="hint">仅保存位置文字，不会上传或自动打开证据。不要填写账户口令、Token 或完整敏感身份信息。</p><label class="check-label"><input type="checkbox" name="tradingDay" required>已核实这一天是对应市场的实际交易日，已排除节假日</label><label class="check-label"><input type="checkbox" name="reconciled">我已核对现金、持仓和成交，确认差额为 0（用户自报）</label><p class="hint" data-journal-mode>相同日期再次保存会更新该日，不会增加天数。</p><p class="error" role="alert" data-journal-error></p><button type="submit" class="primary">保存当日日志</button> <button type="button" class="secondary" data-journal-reset>填写新一天</button></form></article><article class="article-card"><h2>已保存的日志</h2>${entries.length ? `<div class="table-wrap"><table><thead><tr><th>日期</th><th>权益</th><th>绝对差额</th><th>记录状态</th><th>操作</th></tr></thead><tbody>${entries.map(({ key, row, error }) => `<tr><td>${escapeHTML(row?.date || key.slice(8))}</td><td>${finiteInput(row?.equity) ? money(row.equity) : '—'}</td><td>${finiteInput(row?.difference) ? money(row.difference) : '—'}</td><td>${error ? `不计入：${escapeHTML(error)}` : row.reconciled ? '自报无差额 · 未第三方核验' : '待完成对账'}</td><td>${realDate(row?.date) ? `<button type="button" class="text-button" data-journal-edit="${escapeHTML(key)}">查看 / 更新</button>` : '需检查导入数据'}</td></tr>`).join('')}</tbody></table></div>` : '<p>尚无前向日志。先在真实交易日按冻结规则观察，再在这里保存证据。</p>'}</article>`;
}
function assessmentMarkup(lessons) {
  const assessment = projectAssessment(lessons);
  const checks = [
    [assessment.completed === assessment.total && assessment.total > 0, '课程证据', `${assessment.completed} / ${assessment.total} 课符合题目、实验和自评作业的完成规则。答题和自评不证明实际操作能力。`],
    [assessment.documented === 6, '六项方案留档', `${assessment.documented} / 6 项达到 100 字填写门槛。系统未评价文字中的正确性或结果可靠性。`],
    [assessment.code, '代码运行记录', '由你确认在自己的环境中运行过测试、研究脚本并核对账本。'],
    [assessment.verified >= 20, '前向观察起点', `${assessment.verified} 个用户自报已对账、差额为 0 的交易日 / 20 日教学起点。有效日志 ${assessment.entries} 日。`],
    [assessment.drill, '异常与停机演练', '由你确认完成下述故障情景，并记录恢复前必须检查的证据。'],
  ];
  return `<article class="article-card"><h2>核对证据，不领取“实盘认证”</h2><div class="callout">以下是学习材料自查。全部达到也不表示策略有效、能够盈利，或已经获得实盘交易资格。自填日志、字数门槛和勾选未经过第三方核验；真实资金决策还依赖品种规则、个人风险承受能力与持续执行证据。</div>${checks.map(([ready, title, detail]) => `<div class="callout"><strong>${ready ? '已记录' : '待补充'} · ${title}</strong><p>${escapeHTML(detail)}</p></div>`).join('')}<h3>异常演练要说清“发现 → 停止 → 对账 → 恢复”</h3><ul><li>行情缺失、延迟或日期异常：如何识别、停止新增订单，并确认最新可用数据？</li><li>拒单与部分成交：如何区别目标仓位、已成交仓位和未完成订单？</li><li>重复提交与程序重启：如何依据唯一订单编号查现状，避免重复买入？</li><li>账户与账本出现差额：如何核查费用、分红、入出金、币种和持仓数量？</li><li>触及预定风险线或服务失联：如何停机、处理未完成订单，并获得恢复依据？</li><li>实际品种 / 券商权限变化：如何确认订单类型、交易单位、可卖规则及限制仍适用？</li></ul><form data-project-drill><label class="field"><span>演练记录与证据位置</span><textarea name="notes" rows="6" maxlength="12000" placeholder="演练日期……，模拟的异常……，发现方式……，停止和撤单步骤……，对账结果……，恢复条件……，证据位置……。仍未验证的环节……">${escapeHTML(getValue('project:drill-notes', ''))}</textarea></label><label class="check-label"><input type="checkbox" name="drill" ${assessment.drill ? 'checked' : ''}>我已在模拟环境演练上述情景，知道怎样停机、对账和恢复（用户自报）</label><button type="submit" class="primary">保存演练记录</button></form><p>对于低频策略，20 日可能连一次完整交易都没有。应根据持有期和信号频率延长观察，直到能够解释多次完整成交与压力情景；不要为了满足天数而伪造交易或改变冻结规则。</p></article>`;
}

export function projectMarkup(lessons) {
  const assessment = projectAssessment(lessons);
  return `<section data-project-workspace><div class="page-heading"><div><span class="eyebrow">CAPSTONE PROJECT</span><h1>你的第一份量化研究</h1><p>将概念、代码、真实前向观察与执行演练整理成可复查的证据。</p></div><button type="button" class="secondary" data-export-project>导出全部项目材料（Markdown）</button></div><div class="stat-grid four">${stat('课程完成记录', `${assessment.completed} / ${assessment.total}`, '含答题、实验与作业自评')}${stat('方案已留档', `${assessment.documented} / 6`, '字数门槛，不代表内容通过')}${stat('自报无差额日', `${assessment.verified} / 20`, '教学起点，未第三方核验')}${stat('代码 / 演练', `${assessment.code ? '已记录' : '待完成'} / ${assessment.drill ? '已记录' : '待完成'}`, '均由你自行确认')}</div><nav class="local-tabs" role="tablist" aria-label="毕业项目工作区">${TABS.map(([id, label]) => `<button type="button" role="tab" id="project-tab-${id}" aria-controls="project-panel-${id}" aria-selected="${activeTab === id}" tabindex="${activeTab === id ? 0 : -1}" class="${activeTab === id ? 'active' : ''}" data-project-tab="${id}">${label}</button>`).join('')}</nav>${TABS.map(([id]) => `<section role="tabpanel" id="project-panel-${id}" aria-labelledby="project-tab-${id}" ${activeTab === id ? '' : 'hidden'}>${id === 'plan' ? planMarkup() : id === 'code' ? codeMarkup() : id === 'journal' ? journalMarkup() : assessmentMarkup(lessons)}</section>`).join('')}</section>`;
}

function markdownBlock(value) {
  return String(value ?? '').replace(/\r\n/g, '\n').split('\n').map(line => `> ${line}`).join('\n');
}
function projectMarkdown(lessons) {
  const all = flattenLessons(lessons);
  const assessment = projectAssessment(all);
  const lines = [
    '# 量化学习毕业项目材料', '', `导出日期：${todayLocal()}`, '',
    '本文件为用户自填研究、学习与前向观察记录。字数和勾选不代表内容审核；日志未第三方核验。20 日仅是教学起点，不是实盘认证或盈利保证。合成样例和历史回放不得冒充真实前向模拟。', '',
    '## 自查统计', '', `课程完成记录：${assessment.completed}/${assessment.total}；方案留档：${assessment.documented}/6；有效交易日日志：${assessment.entries}；自报已对账且零差额：${assessment.verified}；代码自报：${assessment.code ? '已记录' : '未记录'}；演练自报：${assessment.drill ? '已记录' : '未记录'}。`, '',
    '## 研究方案', '',
  ];
  for (const field of PROJECT_FIELDS) {
    const value = getValue(`project:${field.id}`, '');
    lines.push(`### ${field.title}`, '', `填写长度：${textLength(value)} 个非空白字符；${textLength(value) >= 100 ? '已留档，未评价内容' : '草稿 / 待补充'}。`, '', markdownBlock(value || '尚未填写'), '');
  }
  lines.push('## 代码运行记录（用户自报）', '', markdownBlock(getValue('project:code-notes', '') || '尚未填写'), '', '## 异常与停机演练（用户自报）', '', markdownBlock(getValue('project:drill-notes', '') || '尚未填写'), '', '## 前向日志', '');
  const journals = journalEntries();
  if (!journals.length) lines.push('尚无记录。', '');
  for (const { key, row, error } of [...journals].reverse()) {
    lines.push(`### ${row?.date || key}`, '', `状态：${error ? `无效，不计入：${error}` : row.reconciled ? '用户自报已对账、差额为零；未第三方核验' : '尚未完成对账'}。`, '', `账户权益：${row?.equity ?? '缺失'}；对账绝对差额：${row?.difference ?? '缺失'}；实际交易日自报：${row?.tradingDay === true ? '已确认' : '未确认'}。`, '', '观察：', '', markdownBlock(row?.note || '缺失'), '', '证据位置（未读取或核验）：', '', markdownBlock(row?.evidence || '缺失'), '');
  }
  lines.push('## 课程提交与实验附录', '');
  for (const lesson of all) {
    const status = lessonStatus(lesson);
    const task = getValue(`task:${lesson.id}`, {});
    const experiment = getValue(`experiment:${lesson.id}`);
    lines.push(`### ${lesson.title}`, '', `课程 ID：${lesson.id}；答题：${status.right}/${status.total}；实验记录：${status.exercise ? '有' : '无'}；作业自评：${status.task ? '符合填写规则' : '待补充'}。`, '');
    if (task.text) lines.push('作业：', '', markdownBlock(task.text), '', `自评勾选条目：${(task.rubric || []).map(index => lesson.task.rubric[index]).filter(Boolean).join('；') || '无'}`, '');
    if (experiment) lines.push('实验记录（教学实验）：', '', markdownBlock(JSON.stringify(experiment, null, 2)), '');
  }
  return `${lines.join('\n')}\n`;
}

export function bindProject(container, lessons, { notify = () => {}, rerender = () => {} } = {}) {
  const root = container.querySelector('[data-project-workspace]');
  if (!root) return;
  const draftNotice = document.createElement('p');
  draftNotice.className = 'callout';
  draftNotice.setAttribute('role', 'status');
  draftNotice.dataset.projectDraftNotice = '';
  root.querySelector('.local-tabs').before(draftNotice);
  const updateDraftNotice = () => {
    draftNotice.hidden = !formDrafts.size;
    draftNotice.textContent = '有未保存输入，已暂存在当前页面内存。切换标签或课程后可恢复；刷新、关闭或换设备不能恢复，请保存。导出仅包含已保存材料。';
  };
  const baselines = new Map();
  const rememberDraft = id => {
    const form = root.querySelector(`[data-project-${id}]`);
    const snapshot = formSnapshot(form);
    if (JSON.stringify(snapshot) === baselines.get(id)) formDrafts.delete(id);
    else formDrafts.set(id, snapshot);
    updateDraftNotice();
  };
  for (const id of PROJECT_FORMS) {
    const form = root.querySelector(`[data-project-${id}]`);
    baselines.set(id, JSON.stringify(formSnapshot(form)));
    if (formDrafts.has(id)) restoreForm(form, formDrafts.get(id));
    form.addEventListener('input', () => rememberDraft(id));
    form.addEventListener('change', () => rememberDraft(id));
    rememberDraft(id);
  }
  const saved = (id, message) => {
    formDrafts.delete(id);
    updateDraftNotice();
    notify(message);
    rerender();
  };
  const saveFailed = error => notify(`保存未完成：${error?.message || '请稍后重试'}。部分字段可能已保存；当前输入已保留，请检查后重新保存。`);
  const activate = id => {
    if (!TABS.some(([tab]) => tab === id)) return;
    activeTab = id;
    for (const button of root.querySelectorAll('[data-project-tab]')) {
      const selected = button.dataset.projectTab === id;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      button.classList.toggle('active', selected);
    }
    for (const [tab] of TABS) root.querySelector(`#project-panel-${tab}`).hidden = tab !== id;
  };
  root.querySelectorAll('[data-project-tab]').forEach(button => {
    button.addEventListener('click', () => activate(button.dataset.projectTab));
    button.addEventListener('keydown', event => {
      const index = TABS.findIndex(([id]) => id === button.dataset.projectTab);
      const next = event.key === 'ArrowRight' ? (index + 1) % TABS.length : event.key === 'ArrowLeft' ? (index + TABS.length - 1) % TABS.length : event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : null;
      if (next === null) return;
      event.preventDefault(); activate(TABS[next][0]); root.querySelector(`[data-project-tab="${TABS[next][0]}"]`).focus();
    });
  });
  const plan = root.querySelector('[data-project-plan]');
  for (const field of PROJECT_FIELDS) root.querySelector(`[data-count="${field.id}"]`).textContent = `${textLength(plan.elements.namedItem(field.id).value)} / 100 字`;
  plan.addEventListener('input', event => {
    const field = PROJECT_FIELDS.find(item => item.id === event.target.name);
    if (field) root.querySelector(`[data-count="${field.id}"]`).textContent = `${textLength(event.target.value)} / 100 字`;
  });
  plan.addEventListener('submit', event => {
    event.preventDefault();
    rememberDraft('plan');
    try {
      const data = new FormData(plan);
      const values = PROJECT_FIELDS.map(field => [field.id, String(data.get(field.id) || '').trim()]);
      values.forEach(([id, value]) => putValue(`project:${id}`, value));
      saved('plan', '研究方案已保存。达到字数门槛仅表示已留档，内容仍需依据证据审查。');
    } catch (error) { saveFailed(error); }
  });
  root.querySelector('[data-project-code]').addEventListener('submit', event => {
    event.preventDefault(); rememberDraft('code');
    try {
      const data = new FormData(event.currentTarget);
      putValue('project:code-notes', String(data.get('notes') || '').trim()); putValue('project:code-run', data.has('code-run'));
      saved('code', '运行记录已保存，标记为用户自报。');
    } catch (error) { saveFailed(error); }
  });
  root.querySelector('[data-project-drill]').addEventListener('submit', event => {
    event.preventDefault(); rememberDraft('drill');
    try {
      const data = new FormData(event.currentTarget);
      putValue('project:drill-notes', String(data.get('notes') || '').trim()); putValue('project:drill', data.has('drill'));
      saved('drill', '演练记录已保存，标记为用户自报。');
    } catch (error) { saveFailed(error); }
  });
  const journal = root.querySelector('[data-project-journal]');
  const status = root.querySelector('[data-journal-mode]');
  const journalError = root.querySelector('[data-journal-error]');
  const updateMode = () => {
    const date = journal.elements.namedItem('date').value;
    status.textContent = getValue(`journal:${date}`) ? `已存在 ${date} 的日志，保存将更新该日，不会重复计数。` : '相同日期再次保存会更新该日，不会增加天数。';
  };
  journal.elements.namedItem('date').addEventListener('change', () => {
    journal.elements.namedItem('tradingDay').checked = false;
    journal.elements.namedItem('reconciled').checked = false;
    journalError.textContent = ''; updateMode();
  });
  journal.addEventListener('submit', event => {
    event.preventDefault(); rememberDraft('journal');
    try {
      const data = new FormData(journal);
      const row = { date: String(data.get('date') || ''), equity: data.get('equity'), difference: data.get('difference'), note: String(data.get('note') || '').trim(), evidence: String(data.get('evidence') || '').trim(), tradingDay: data.has('tradingDay'), reconciled: data.has('reconciled') };
      const error = validateJournal(row);
      journalError.textContent = error;
      if (error) { notify(error); return; }
      row.equity = Number(row.equity); row.difference = Number(row.difference);
      putValue(`journal:${row.date}`, row);
      saved('journal', `${row.date} 日志已保存${row.reconciled ? '，无差额状态由你自行确认' : '，待完成对账'}。`);
    } catch (error) { journalError.textContent = error?.message || '保存失败，请重试。'; saveFailed(error); }
  });
  root.querySelector('[data-journal-reset]').addEventListener('click', () => {
    if (formDrafts.has('journal') && !window.confirm('当前日志有未保存输入。要放弃这些输入并填写新一天吗？')) return;
    journal.reset(); journal.elements.namedItem('date').value = todayLocal(); journalError.textContent = ''; updateMode();
    baselines.set('journal', JSON.stringify(formSnapshot(journal)));
    formDrafts.delete('journal'); updateDraftNotice();
  });
  root.querySelectorAll('[data-journal-edit]').forEach(button => button.addEventListener('click', () => {
    const row = getValue(button.dataset.journalEdit);
    if (!row || typeof row !== 'object') return;
    if (formDrafts.has('journal') && !window.confirm('当前日志有未保存输入。要放弃这些输入并打开已保存的日志吗？')) return;
    for (const key of ['date', 'equity', 'difference', 'note', 'evidence']) journal.elements.namedItem(key).value = row[key] ?? '';
    for (const key of ['tradingDay', 'reconciled']) journal.elements.namedItem(key).checked = row[key] === true;
    baselines.set('journal', JSON.stringify(formSnapshot(journal)));
    formDrafts.delete('journal'); updateDraftNotice();
    journalError.textContent = validateJournal(row); updateMode(); journal.elements.namedItem('date').focus();
  }));
  root.querySelector('[data-export-project]').addEventListener('click', () => {
    try {
      downloadFile(`quant-project-${todayLocal()}.md`, projectMarkdown(lessons), 'text/markdown;charset=utf-8');
      notify('已导出已保存的方案、运行 / 演练记录、日志和课程实验材料。未保存的输入不在导出内。');
    } catch (error) { notify(`导出失败：${error?.message || '请稍后重试'}。已保存材料与当前输入保持不变。`); }
  });
  updateMode();
}
