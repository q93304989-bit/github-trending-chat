# GitHub 本周热门项目聊天应用 — 设计文档

日期：2026-08-12

## 1. 背景与目标

构建一个本地网页聊天应用，用户点击“拉取本周热门”按钮即可获取 GitHub 官方 Trending 页面（每周榜）的仓库列表，并以聊天消息 + 项目卡片的形式展示。

成功标准：

- 一条命令启动本地服务，浏览器打开即可使用。
- 点击按钮后能在聊天里看到本周热门仓库的卡片列表。
- 数据来自 `https://github.com/trending?since=weekly` 的实时抓取。
- 抓取失败或 GitHub 限流时，聊天界面给出友好错误提示。

## 2. 技术选型

- Node.js（本机 v23，自带 `fetch`），零第三方依赖。
- 后端使用内置 `http` 模块提供静态文件服务和 API。
- 前端为原生 HTML/CSS/JavaScript，无框架、无构建步骤。

## 3. 架构

单进程 Node.js 服务，职责如下：

1. 托管 `public/` 下的静态前端文件。
2. 提供 `GET /api/trending` 接口，抓取并解析 GitHub Trending 每周榜，返回 JSON。

数据流：

```
用户点击按钮 → 前端 GET /api/trending
  → 后端请求 https://github.com/trending?since=weekly
  → 正则解析 HTML 为仓库对象数组
  → 返回 JSON → 前端渲染聊天卡片消息
```

## 4. 组件与接口

### 后端 `server.js`

- `GET /`：返回 `public/index.html`。
- `GET /api/trending`：
  - 响应头 `Content-Type: application/json; charset=utf-8`。
  - 成功返回 `{ "ok": true, "updatedAt": <ISO 时间>, "items": [...] }`。
  - 失败返回 HTTP 502/504 及 `{ "ok": false, "error": "..." }`。
- 抓取时携带浏览器 User-Agent。
- 60 秒内存缓存，避免短时间重复点击反复请求 GitHub。

### 仓库对象字段

| 字段 | 说明 |
| --- | --- |
| `name` | 仓库全名，如 `owner/repo` |
| `url` | 仓库链接 |
| `description` | 简介（可能为空） |
| `language` | 主要语言（可能为空） |
| `stars` | 总星标数（整数） |
| `todayStars` | 今日新增星标（整数，解析 `X stars today`） |
| `forks` | fork 数（整数） |

### 前端 `public/`

- `index.html`：聊天窗口骨架、消息容器、输入区（含“拉取本周热门”按钮）。
- `style.css`：聊天气泡、项目卡片、加载动画样式，适配移动端宽度。
- `app.js`：
  - 页面加载时插入欢迎消息。
  - 点击按钮 → 插入“正在加载…”气泡 → 请求 `/api/trending`。
  - 成功 → 将加载气泡替换为项目卡片列表消息。
  - 失败 → 显示友好错误气泡。
  - 卡片包含：排名、仓库名（链接）、简介、语言、今日新增星标、总星标、fork 数。

## 5. 错误处理

- GitHub 返回非 200：返回 502 与错误信息，前端显示“暂时拿不到数据，请稍后再试”。
- 解析后条目为空：视为异常，提示“没有解析到数据”。
- 前端请求失败（服务未启动等）：显示“无法连接服务器”。

## 6. 验证方式

1. **解析器验证**：保存一段真实 Trending HTML 作为 fixture，用 Node 脚本直接调用解析函数，确认各字段提取正确（含“stars today”和空简介场景）。
2. **端到端验证**：启动服务后实际请求 `/api/trending`，确认返回非空 JSON；再通过浏览器页面确认卡片渲染正常。

## 7. 文件结构与启动

```
server.js          # HTTP 服务 + 抓取 + 解析
public/index.html  # 聊天页面结构
public/style.css   # 聊天与卡片样式
public/app.js      # 前端交互逻辑
README.md          # 启动说明
```

启动：`node server.js`，默认监听 `http://localhost:3000`（端口可用环境变量 `PORT` 覆盖）。

## 8. 范围外（YAGNI）

- 不做语言筛选、多轮对话、历史持久化。
- 不做第三方缓存服务或数据库。
- 不做登录、鉴权、部署。
