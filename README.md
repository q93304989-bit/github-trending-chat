# GitHub 本周热门聊天

一个极简的网页聊天应用：一键拉取 GitHub 官方 Trending 每周榜，以聊天卡片的形式展示本周热门项目。

![Node](https://img.shields.io/badge/Node.js-18%2B-339933) ![Dependencies](https://img.shields.io/badge/dependencies-zero-brightgreen) ![Tests](https://img.shields.io/badge/tests-8%20passing-brightgreen)

![界面预览](docs/screenshot.png)

## 功能特性

- **一键抓取**：点击按钮即可获取 GitHub Trending 每周榜（`since=weekly`）
- **聊天卡片展示**：排名、仓库名链接、简介、语言、总星标、本周新增星标、fork 数一目了然
- **一键启动**：Windows 下双击 `一键启动.vbs`，后台启动服务并自动打开浏览器
- **零依赖**：仅使用 Node.js 内置模块，无需 `npm install`
- **缓存友好**：后端带 60 秒内存缓存，避免重复点击反复请求 GitHub

## 快速开始

需要 Node.js 18+（Node 23 已测试）。

```bash
node server.js
```

打开 http://localhost:3000，点击“拉取本周热门”。

Windows 用户也可以直接双击项目根目录的 `一键启动.vbs`：会自动后台启动服务并打开浏览器。

可用环境变量：`PORT`（默认 3000）。

## 使用说明

1. 打开页面后，点击底部绿色按钮“拉取本周热门”。
2. 等待片刻，聊天区会列出本周 GitHub 热门项目卡片。
3. 点击任意卡片，直接跳转到对应仓库。

## 项目结构

```
server.js          # HTTP 服务 + 抓取 + 解析
lib/parser.js      # Trending 页面 HTML 解析
public/            # 前端聊天界面
test/              # 单元与集成测试
一键启动.vbs       # Windows 一键启动脚本
docs/screenshot.png # 界面预览图
```

## 测试

```bash
node --test
```

## 数据说明

- 数据来源：https://github.com/trending?since=weekly
- 每周榜页面显示的是 `stars this week`，因此字段命名为 `weeklyStars`（本周新增星标）
- 解析规则针对真实页面结构：仓库名取自 `<h2>` 链接，星标数取自 SVG 图标后的裸文本

## 技术栈

- Node.js（内置 `http` + `fetch`）
- 原生 HTML / CSS / JavaScript
- `node:test` 测试框架
