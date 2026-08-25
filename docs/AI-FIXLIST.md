# 测试问题清单（AI 修复专用 · Test Findings / Fix-List）

> 项目：github-trending-chat（GH-TRENDING // TERMINAL）
> 测试类型：黑盒 HTTP 审计 + 环境变量边界 + 并发/健壮性 + 代码走查
> 环境：Windows · Node v24.19.0 · 2026-08-25
> 基线：`node --test` 现有 17 个用例全部通过；本清单只列**发现的问题**，不含正常项描述。
> 每条按【严重度 / 位置 / 复现 / 期望 vs 实际 / 修复建议】组织，可直接按条修复并补回归测试。

---

## ISSUE-01 ／中／无效 PORT 导致裸堆栈崩溃，违背 README 承诺
- **位置**: `server.js` L182 附近 `createServer().listen(PORT)` 与 `server.on('error')`（只特判 EADDRINUSE）
- **复现**: `PORT=99999 node server.js`
- **期望**: README 称端口类故障应给出友好提示而非堆栈报错
- **实际**:
  ```
  RangeError [ERR_SOCKET_BAD_PORT]: options.port should be >= 0 and < 65536. Received type number (99999)
      at Server.listen (node:net:2333:7)
  ```进程以 exit 1 崩溃，打印完整 Node 内部堆栈。
- **附带**: `PORT=abc` 时 `Number('abc')||3000` → NaN 回退 3000，**静默**在错误端口启动，无任何警告。
- **建议**: 启动前校验 `Number.isInteger(PORT) && PORT>=0 && PORT<=65535`，否则友好报错退出；非法字符串显式告警而非静默回退。

## ISSUE-02 ／中／PORT=0 被 `Number(x)||默认值` 吞掉
- **位置**: `server.js` 顶部 `const PORT = Number(process.env.PORT) || 3000;`
- **复现**: `PORT=0 node server.js`
- **期望**: 按 Node 惯例 0 = 随机可用端口（随机高端口监听）
- **实际**: `0` 为 falsy → 强制变成 3000。本项目 key 记忆中 TTL 已为此坑专门改用 `parseInt+isFinite`（`TRENDING_TTL_MS=0` 合法），PORT 未同步该约定，同类缺陷残留。
- **建议**: 与 TTL 相同的解析策略（`parseInt`+`isFinite`），保留合法的 0。

## ISSUE-03 ／中／IPv4 单栈占用时服务“假启动成功”（双栈通配绑定分流）
- **位置**: `server.js` `.listen(PORT)`（未指定 host，默认绑 `[::]` 通配双栈）
- **复现**:
  1. 另一程序只占用 IPv4：`net.createServer().listen(3790,'127.0.0.1')`
  2. `PORT=3790 node server.js` → 打印启动横幅、无任何报错
  3. 浏览器访问 `http://127.0.0.1:3790` → 连到**别的程序**；仅 `http://[::1]:3790` 才是本服务
- **期望**: 端口冲突时明确失败（同配置双开会正确触发 EADDRINUSE 友好提示并退出，此场景却被绕过）
- **实际**: Windows 允许 `[::]` 通配与具体 IPv4 bind 共存 → 服务自认为启动成功，localhost 用户被静默分流到未知应用。
- **建议**: 显式 `listen(PORT, '127.0.0.1')`（或在错误处理里补充 `EACCES`/`EADDRNOTAVAIL` 分支），冲突时给出与双开一致的提示。

## ISSUE-04 ／中／TRENDING_TTL_MS 接受负数，进入“永久 STALE”模式
- **位置**: `server.js` `CACHE_TTL_MS` 解析处（isFinite 校验无下界）
- **复现**: `TRENDING_TTL_MS=-1000 node server.js` 后连续请求 `/api/trending`
- **实测数据**:
  | 请求 | 耗时 | stale |
  |---|---|---|
  | 第1次(冷) | 2981ms | false |
  | 第2次 | 20ms | **true** |
  | 第3次 | 16ms | **true** |
- **影响**: 新鲜期窗口为负 → 缓存永不过期地处于 STALE 态，且**每个请求都触发一轮后台回源**（见 ISSUE-05 放大效应）；前端状态栏恒亮 STALE。
- **建议**: 下界钳制（负数回退默认值或拒绝启动），与 ISSUE-01 一并在配置入口做 range 校验。

## ISSUE-05 ／中／上游持续故障时后台刷新无退避，形成回源风暴
- **位置**: `server.js` `startRefresh()` / `getTrending()` SWR 路径
- **机理**: 缓存过期 + 上游失败时：每次进来的请求都会（在上一轮 inflight 结束后）再发起一轮 `2 次尝试 × 最长 10s + 700ms 间隔` 的完整回源。single-flight 只合并**同时刻**并发者，不限制**连续**失败重试频率。
- **影响**: GitHub 宕机/限流期间，只要还有用户在线轮询，就对上游形成不间断的重试循环，加剧限流、浪费带宽；配合 ISSUE-04（TTL≤0）退化为每请求必回源。
- **建议**: 对同一 period 的连续失败增加指数退避冷却窗（如 30s→60s→…上限 5min），冷却期内直接回 STALE 不回源。

## ISSUE-06 ／低／前后端超时预算不匹配（15s < 20.7s）
- **位置**: `public/app.js` `FETCH_TIMEOUT_MS=15000` vs `server.js` `FETCH_TIMEOUT_MS=10000 × UPSTREAM_ATTEMPTS=2 + RETRY_DELAY_MS=700`
- **场景**: 冷缓存 + 上游慢（非快速拒绝）：后端最坏 ≈20.7s 才放弃，前端 15s 即 abort → 用户看到「请求超时」错误气泡；几秒后后端其实成功并把数据写进缓存，用户手动重试反而秒开——体验自相矛盾。
- **建议**: 前端超时 ≥ 后端最坏链路（如 22s），或后端冷路径总预算压到 ≤12s。

## ISSUE-07 ／低／HEAD /api/trending 返回 404
- **复现**: 原始 socket 发送 `HEAD /api/trending HTTP/1.1` → 404（API 分支仅匹配 `req.method === 'GET'`，其余落入静态分支找不到文件）
- **影响**: 探活/监控工具常用 HEAD 请求，会误判服务不可用。
- **建议**: API 分支放宽为 `GET/HEAD`（HEAD 走相同逻辑，http 模块自动省略 body）。

## ISSUE-08 ／低／静态处理器不区分 HTTP 方法
- **复现**: 原始 socket 发送 `DELETE /style.css HTTP/1.1` → **200** 并返回文件全文
- **影响**: 只读实现（fs.readFile）故无实际破坏，但违反 HTTP 方法语义，对代理/扫描器行为不可预期。
- **建议**: `serveStatic` 入口仅放行 GET/HEAD，其余 405。

## ISSUE-09 ／低／安全响应头缺失
- **现状**: 所有响应均无 `X-Content-Type-Options`、`X-Frame-Options`（或 CSP `frame-ancestors`）、`Referrer-Policy`、CSP。
- **影响**: JSON 接口可被 MIME-sniffing；页面可被任意 iframe 嵌套（点击劫持面）。
- **建议**: 全局补 `X-Content-Type-Options: nosniff` + `X-Frame-Options: DENY`（或 CSP frame-ancestors 'none'）；可选加最简 CSP。

## ISSUE-10 ／低／index.html 与 JS 以 max-age=300 强缓存且无版本化
- **复现**: `curl -I http://127.0.0.1:3000/index.html` → `Cache-Control: public, max-age=300`
- **影响**: 发版后回访用户最长 5 分钟内跑旧 `app.js/render.js`（文件名无 hash、引用无 ?v= 参数），出现「更新不同步」窗口甚至新旧 JS 混搭。API 已正确使用 `no-cache+ETag`，HTML/JS 却相反。
- **建议**: HTML 改 `no-cache`；静态 JS/CSS 加内容 hash 或 `?v=<version>` 查询参数后再保留长缓存。

## ISSUE-11 ／低·加固／escapeHtml 不约束 URL scheme + localStorage 缓存条目形状未校验
- **PoC**（node 直接调 `public/render.js`）:
  输入 item `{ url: 'javascript:alert(document.cookie)//' }` → 输出原样包含 `href="javascript:alert(document.cookie)//"`（文本字段转义正常，scheme 不设防）。
- **攻击面**: 服务端数据源目前安全（name 被正则限定为 `[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+`，url 由服务端拼接）；但 `app.js` 的 `getCache()` 读 `ght.cache.v2` 时仅校验 `Array.isArray && length`，不校验条目字段——localStorage 被污染（恶意扩展/共用机器/手工改 DevTools）即可把 javascript: URL 送进 `href` 与 `data-copy`。
- **建议**: `getCache` 校验每条的 `name/url/stars` 形状；render 层对 `item.url` 做 `^https://github\.com/` 白名单，不合格则丢弃该属性或整条。

## ISSUE-12 ／低／README 文档漂移 + 标题栏硬编码端口
- README「项目结构」写 `test/ # 单元与集成测试（14 个）`，实际与徽章均为 **17**。
- `public/index.html` 标题栏硬编码 `gh-trending@localhost:3000`：换端口启动时显示假信息。
- **建议**: 文档同步为动态事实；标题栏由 app.js 按 `location.port` 渲染。

## ISSUE-13 ／信息／a11y：tabs 语义不完整
- `role="tablist"/tab` 存在，但无对应 `tabpanel`、无左右方向键切换（WAI-ARIA Tabs 模式不完整）；CSS 侧 `focus-visible` 与 `prefers-reduced-motion` 已达标（L206/L211）。
- 建议：补 `aria-controls`+方向键导航，或降级为普通按钮组去掉 tab 角色。

## ISSUE-14 ／信息／测试覆盖缺口
1. `test/server.test.js` 的 HTTP 集成用例全部经 `createServer(fetcher)` 注入 fetcher —— 该注入**完全绕过** `getTrending` 的缓存/SWR/single-flight 管线（本次审计实测：注入路径下并发 10 请求触发 10 次上游调用），缓存逻辑只有直调 `getTrending` 的单测覆盖，「HTTP 层 × 真实管线」的组合无自动化覆盖。
2. 无配置边界用例：负 TTL、PORT=0/越界/非数字、HEAD 方法等本清单问题均无回归测试拦截。
- **建议**: 增加「真实管线」集成用例（不注入 fetcher，用子进程 + 可控上游或环境开关），并为 ISSUE-01~08 各补一条回归。

---

## 附：本次验证通过的项（无需处理，供 AI 排除误报）
- 路径遍历/编码绕过 9 种变体（../ ..%2f %2e%2e 反斜杠 %5c %00 等）全部被拦（403/404），无泄漏。
- 同端口双开 → EADDRINUSE 友好提示 + exit 1 ✓（README 承诺在该主路径成立）。
- 生产管线冷启动并发 8 请求 → 上游仅 1 次调用（8 响应 updatedAt 完全一致），single-flight 生效。
- ETag/304、STALE 秒回（16–20ms）、502 错误体格式 ✓。
- XSS 文本字段转义（<>&"'`) ✓（scheme 问题单列为 ISSUE-11）。
- 首测曾出现的「POST /api/trending 挂起」经 5 次复测确认为测试脚本偶发误报，服务端稳定 404，**不是缺陷**。

---

# 修复记录（2026-08-25 · AI 消费后回写）

| 编号 | 状态 | 落点 | 回归拦截 |
|---|---|---|---|
| ISSUE-01 | ✅ 已修 | `server.js` `resolvePort()`：越界返回 `error`，启动块友好输出并 exit 1；非法字符串显式告警回退 | `resolvePort refuses out-of-range integers` / `warns loudly on junk` |
| ISSUE-02 | ✅ 已修 | 同上：`parseInt+isFinite`，`PORT=0` 合法保留（横幅打印真实随机端口） | `resolvePort keeps legitimate 0` |
| ISSUE-03 | ✅ 已修 | 默认绑定 `HOST=127.0.0.1`（可用 `HOST` env 覆盖），双栈通配假启动不再发生；错误处理补 `EACCES/EADDRNOTAVAIL` 友好分支 | 复用既有 EADDRINUSE 用例 + 手工冒烟 |
| ISSUE-04 | ✅ 已修 | `resolveTtlMs()`：负数钳制回默认 60s，保留合法 0 | `resolveTtlMs clamps negative values` |
| ISSUE-05 | ✅ 已修 | `startRefresh/getTrending` 增加按榜单指数冷却（30s→60s→…上限 5min）：冷却期 SWR 只回 stale、冷路径快速失败；成功清零；`resetTrendingCache()` 一并复位 | `failure cooldown suppresses revalidation storms` / `cold miss during cool-down fails fast` |
| ISSUE-06 | ✅ 已修 | 前端 `FETCH_TIMEOUT_MS` 15s→22s（≥ 后端最坏 ~20.7s） | `client timeout covers the backend worst case` |
| ISSUE-07 | ✅ 已修 | API 分支放行 GET/HEAD，HEAD 显式 `Content-Length` | `HEAD /api/trending answers 200` |
| ISSUE-08 | ✅ 已修 | `serveStatic` 仅放行 GET/HEAD，其余 405+`Allow` | `static handler rejects write-ish methods` |
| ISSUE-09 | ✅ 已修 | 全响应补 `X-Content-Type-Options/X-Frame-Options/Referrer-Policy`；HTML 另加 CSP（self + img data:） | `every response carries baseline security headers` |
| ISSUE-10 | ✅ 已修 | HTML 改 `no-cache` 且引用本地 js/css 时自动追加 `?v=<mtime36>` 指纹；资源缓存升至 1h | `index.html revalidates and fingerprints its assets` |
| ISSUE-11 | ✅ 已修 | 双层防御：`render.js safeUrl()` 白名单（不安全 url 连 COPY 钮一起丢弃）+ `app.js getCache()` 条目形状校验过滤毒化数据 | `cardsHtml drops href and copy button for unsafe urls` |
| ISSUE-12 | ✅ 已修 | README 测试数/缓存策略已按事实更新；标题栏由 app.js 按 `location.host` 动态渲染 | — |
| ISSUE-13 | ✅ 已修 | tabs 补齐：`aria-controls=messages`、面板 `role=tabpanel`、roving tabindex、←/→/Home/End 自动激活 | 手工键盘冒烟 |
| ISSUE-14 | ✅ 已补 | 新增 `test/regression.test.js` 13 条：含 **GH_UPSTREAM_BASE 可注入上游 + PORT=0 子进程** 的「HTTP 层 × 真实管线」集成用例（3 并发→上游恰 1 次）；01~08 各有回归 | 本文件全部 ✅ 行 |

> 修复后基线：`node --test` **30/30 通过**；headless 截图零控制台错误（CSP 生效下页面/动效完好）。
> 备注：ISSUE-14.2 中「PORT 越界」类用例通过导出的纯函数 `resolvePort/resolveTtlMs` 直接断言，无需 spawn 进程即可拦截。
