# GitHub 本周热门聊天

一个极简网页聊天应用：点击按钮即可获取 GitHub 官方 Trending 每周榜，并以聊天卡片展示。

## 运行

需要 Node.js 18+（本机 v23 已测试）。

```bash
node server.js
```

打开 http://localhost:3000，点击“拉取本周热门”。

可用环境变量：`PORT`（默认 3000）。

## 测试

```bash
node --test
```

## 说明

- 数据来自 https://github.com/trending?since=weekly
- 后端带 60 秒内存缓存，避免重复点击反复请求 GitHub
- 零第三方依赖
