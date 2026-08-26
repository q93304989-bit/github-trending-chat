# AI 动效迭代计划（MOTION v2 · 跟手性专项）

> 触发：用户实测反馈——「现在的动画太粗糙了，相应动画也不跟手」。
> 性质：AI 可直接消费的下一轮迭代清单。每项含【严重度 / 位置 / 现状 / 目标 / 改法 / 验收】，照条执行即可，无需重新考古。
> 基线：commit ed79aed（30/30 tests）。动效代码集中两处：`public/style.css` 的 MOTION SYSTEM 段（L223 起）、`public/app.js` 渲染钩子（SWAP_MS/animateCards/paintResult 附近）。
> 术语约定：**跟手 = 用户主动操作到首次视觉反馈的延迟 ≤100ms，且反馈真实生效（不被其他样式机制覆盖）**。

---

## 一、根因诊断（为什么现在不跟手 · 已逐一实证）

### RD-1 · hover 位移被动画 fill 锁死（真 bug，P0）
- **位置**: `style.css` L257-261（`.repo.card-in`）vs L355（`.repo:hover`）
- **现状**: `animation: card-in .32s ... both;` —— fill-mode `both` 在动画结束后**永久保持结束帧**，其级联优先级高于普通规则。`.repo:hover { transform: translateX(2px) }` 从第一天起就被覆盖，**卡片 hover 位移从未生效**。`::before` 的 `>` 提示符滑入正常（伪元素属性独立），但卡片本体纹丝不动 → 手感"死了"。
- **改法**: `both` → `backwards`（保留 delay 期间的透明初帧，动画结束后释放控制权，hover transition 正常接管）。一行修复。
- **验收**: CDP 断言 hover 态 `getComputedStyle(card).transform` 为位移矩阵而非 `none`。

### RD-2 · 主动操作的感知延迟超标（P0）
- **位置**: `app.js` L185 `SWAP_MS = 130`，`renderResult` 无档位区分
- **现状**: 点击 tab 后，旧榜要等 130ms 才开始退场。人眼对**主动操作**的延迟感知阈值 ~100ms，130ms 的"点了没反应"感明显。
- **改法**: `renderResult(data, opts)` 增加 `opts.pace: 'user' | 'bg'`——用户触发的切换（tab 点击/R 键）用快档（swap 70ms + 瀑布步进 24ms），后台静默刷新保持从容档（130ms + 40ms）。调用点：`selectPeriod`/快捷键路径传 `'user'`，`runSync(true)` 完成回调传 `'bg'`。
- **验收**: 点击 tab 后 ≤80ms 内旧榜开始退场（连续采样 opacity）。

### RD-3 · 同榜刷新全量重放瀑布（P0）
- **位置**: `app.js` `paintResult` → `animateCards`（无条件注入 `--i` + `card-in`）
- **现状**: 按 R / 后台刷新完成时，15 张卡**全部**重新从透明飘起（40ms×10 步进 + 320ms ≈ 720ms），正在阅读的位置被打断——"粗糙+烦"的直接来源。
- **改法**: `paintResult` 前对比新旧看板指纹（`since` 相同且 `JSON.stringify(items)` 相同 → 跳过全部动画，仅更新 sync-head 时间；数据有变化 → 卡片不做位移入场，只做 120ms opacity 交叉淡入）。**瀑布入场只属于"换榜"**。
- **验收**: 同榜刷新前后所有卡片 `opacity === '1'` 且 transform 无变化。

### RD-4 · 滚动对齐瞬跳（P1）
- **位置**: `app.js` L90 `alignToBoard`（`messagesEl.scrollTop += ... - 2`）
- **现状**: 切榜后视口瞬移到 #01，无连续感。
- **改法**: 记录目标值后 `messagesEl.scrollTo({ top, behavior: REDUCED_MOTION ? 'auto' : 'smooth' })`；注意与 RD-3 联动——同榜刷新**不触发**滚动。
- **验收**: 连续采样 scrollTop 出现 ≥5 个中间帧值（平滑插值）。

### RD-5 · COPY 按钮布局抖动（P1）
- **位置**: `style.css` `.mini`（无宽度预留）
- **现状**: `[COPY]` → `[ COPIED ]` 文字变宽，同行仓库名/排名被推动，产生"跳一下"的粗糙感。
- **改法**: `.mini { min-width: 11ch; text-align: center; }`（等宽字体下 ch 精确；11ch 覆盖 `[ COPIED ]`）。
- **验收**: 点击 COPY 时同行元素 offsetLeft 零变化。

### RD-6 · 手感参数粗糙 + 无 token 体系（P1）
- **现状**: hover 位移 .16s、提示符滑入 .2s（>120ms 显拖沓）；按钮 `:active` 位移带 .09s 过渡（按下应**瞬时**）；全站时长/缓动硬编码、无统一节奏。
- **改法**: 引入 Motion Tokens（见第三节）并全站替换；按下瞬时、抬起过渡。
- **验收**: grep 无裸 `\.16s|\.2s` 残留于交互路径；按下首帧即有位移。

---

## 二、迭代项清单

> P0 = 跟手实锤（建议一次提交完成）；P1 = 手感升级；P2 = 打磨。

| 编号 | 级别 | 一句话 | 依赖 |
|---|---|---|---|
| M-01 | P0 | `card-in` fill-mode `both`→`backwards`，解锁 hover | 无 |
| M-02 | P0 | 动效双档位：用户触发快档 / 后台刷新从容档 | 无 |
| M-03 | P0 | 同榜刷新免动画（指纹比对），瀑布只属于换榜 | 无 |
| M-04 | P1 | `alignToBoard` 平滑滚动；同榜刷新不滚动 | M-03 |
| M-05 | P1 | `.mini` 等宽预留，消除 COPY 布局抖动 | 无 |
| M-06 | P1 | Motion Tokens 体系（:root 变量）全站替换硬编码 | 无 |
| M-07 | P1 | hover/active 参数收紧（位移 ≤120ms、按下瞬时） | M-06 |
| M-08 | P2 | 骨架屏进出过渡（80ms 淡入 / 120ms 淡出），节奏与真卡对齐 | M-06 |
| M-09 | P2 | 开机动画两段式：水平扫描亮线 + 磷光余晖衰减 | 无 |
| M-10 | P2 | 卫生：`animationend` 一次性清理入场类 + 动画期 `will-change` | M-01 |
| M-11 | P2 | 状态栏 flash 降噪：同文本不闪、连续变化 300ms 节流 | 无 |
| M-12 | P2 | demo 冻结模式 `#/demo/frozen`（截图用：跳过全部入场动画直接终态） | 无 |

### 关键项实施细节

**M-02 档位签名**
```js
// app.js
function renderResult(data, opts) // opts.pace: 'user'(默认) | 'bg'
// SWAP_MS → { user: 70, bg: 130 }; 瀑布步进 → { user: 24, bg: 40 }
// 调用点：selectPeriod / 快捷键 / RETRY → 'user'；runSync(true) 完成回调 → 'bg'
```

**M-03 指纹比对**
```js
// paintResult 开头：
var fingerprint = since + ':' + JSON.stringify((data.items || []).map(function (i) { return i.url; }));
if (fingerprint === lastPaintedFingerprint) { /* 仅更新 sync-head 时间文本，return */ }
lastPaintedFingerprint = fingerprint;
// 数据有变化但同榜 → cards 加 'card-swap'（仅 opacity 交叉淡入 120ms，无位移无步进）
```

**M-06 Tokens**
```css
:root {
  --motion-fast: 100ms;  /* hover/press 即时反馈 */
  --motion-move: 180ms;  /* 元素位移/展开 */
  --motion-scene: 320ms; /* 场景级：瀑布/换榜/开机 */
  --ease-out-soft: cubic-bezier(.22, 1, .36, 1);
  --ease-spring: cubic-bezier(.34, 1.56, .64, 1); /* 仅"确认"类：copied pop / tab bloom */
}
```

**M-10 卫生模式**
```js
// animateCards 注入后：
card.addEventListener('animationend', function h() {
  card.classList.remove('card-in');
  card.removeEventListener('animationend', h);
});
```
（双保险：即使未来有人把 fill-mode 改回 both，类移除后也不会锁 hover。）

---

## 三、验收协议（"跟手"的量化定义 · 全部可自动化）

1. **延迟预算**: pointerdown→首帧反馈 ≤100ms；tab 点击→旧榜开始退场 ≤80ms
2. **hover 实效性**: hover 态卡片 `transform` 为位移矩阵（防 fill 锁死复发的哨兵断言）
3. **瀑布只属于换榜**: 同榜刷新前后所有卡片 opacity 恒为 1、transform 恒为 none
4. **滚动连续性**: 切榜后 scrollTop 连续采样出现 ≥5 个中间帧值
5. **布局稳定性**: COPY 点击前后同行元素 offsetLeft 不变
6. **reduced-motion 全量回归**: 既有全局开关下一切动画归零（含新增项）
7. **落地方式**: 扩展 `work/ui-motion-check.mjs` 增加上述 CDP 断言；M-01/M-02 可另加源码哨兵测试（参照 `FETCH_TIMEOUT_MS` 那条的模式写进 `test/regression.test.js`）

## 四、明确不做（防过度动画）

- ❌ 视差 / 3D 倾斜 / 光标跟随——与 CRT 终端气质不符
- ❌ 路由级转场——单页无路由
- ❌ 引入动画库（GSAP/framer-motion）——现有体量纯 CSS + 原生足够，依赖为零是本项目的优点
- ❌ 列表虚拟化——当前 ≤15 项，无性能问题

## 四·五、入场编排专项（ENTRY v3 · 读条式 · 已实施）

> 演进：v2 电子束/显影方案被用户否决（「太丑了」）→ 改为**复古终端自检读条式**，与 CRT 主题天然同源。

### 序列设计（app.js playBootSequence + body.booted 门控）

1. **黑底覆盖层**（.boot-seq，z-70）逐行蹦自检文字（85ms/行）：
   `GH-TRENDING TERMINAL v2.1` → `(c) phosphor systems` → `POST ... OK` → `MEMORY ... OK` → `UPLINK ... OK` → `LOADING BOARD`
2. **块状读条**：`██████████░░░░░░ 47%`（20 格，磷光亮块 + 30% 透明度轨道 + 琥珀色百分比），约 1.3s 走完
3. **100% 驻留 150ms** → 覆盖层 190ms 淡出移除 → `body.booted` 触发主界面 seg-focus 逐段聚焦 + crt-lock 锁定抖动 + 打字机 + 榜单瀑布

### 实测时间线（headless 采样）

| 时刻 | 状态 |
|---|---|
| t=200 | 覆盖层在场 · 3 行 · 聚焦未触发 |
| t=1000 | 9 行全出 · 读条 55% |
| t=2000 | 覆盖层移除 · body.booted · seg-focus 运行 · 缓存卡秒显 |
| t=3000 | 15 卡全渲染 |
| reduced-motion | overlayNever:true · 内容直接可见（序列整体跳过） |

### 实现要点（维护者必读）

1. **覆盖层由 JS 动态创建**（app.js playBootSequence），index.html 零改动——demo 模式（__GHT_DEMO__ 提前 return）天然免疫。
2. **RM 双保险**：REDUCED_MOTION 时函数直接 resolve（覆盖层永不创建）；即使创建，transition 也被全局开关杀掉。
3. **主界面入场动画全部由 body.booted 门控**（seg-focus ×4 / crt-lock），读条完成才触发——时序由 JS 单点驱动，改读条节奏不会失配聚焦动画。RM 下 booted 照加但动画被杀 = 静态直出。
4. **可见 boot 行（打字机/提示）在读条结束后才开始**；数据请求亦然（firstPaint 在 then 内）。读条是纯仪式，不并行网络——本地工具可接受，若要并行需拆 runSync 的请求/渲染两段。
5. **v2 电子束方案已完全移除**（.crt-power 三层 + index.html 覆盖层 div），style.css 无残留。

## 五、建议实施顺序

1. **第一批（P0，预计 ~50 行改动）**: M-01 + M-02 + M-03 → 手工跟手验收（重点：hover 位移真实生效、按 R 不再全屏跳舞）
2. **第二批（P1）**: M-04~M-07（Tokens 先行，参数收紧随后）
3. **第三批（P2 按需）**: M-08~M-12
4. 每批完成跑 `node --test`（30 条基线）+ `work/ui-shot.mjs` 截图 + `work/ui-motion-check.mjs` 扩展断言