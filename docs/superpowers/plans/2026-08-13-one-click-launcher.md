# 一键启动器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 `一键启动.vbs`：双击后静默启动本地服务并自动打开浏览器。

**Architecture:** 单个 VBScript 文件，使用 `WScript.Shell` 隐藏启动 `node server.js`，等待 2 秒后用默认浏览器打开 `http://localhost:3000`。

**Tech Stack:** VBScript（Windows 自带），零第三方依赖。

## Global Constraints

- 脚本内容必须为纯 ASCII（避免 VBS 编码问题）。
- 不创建任何可见控制台窗口（window style 0）。
- 工作目录必须基于脚本自身所在目录（`WScript.ScriptFullName`），保证从任何位置双击都正确。
- 不改动现有服务、前端与测试代码。
- 交付时同时更新 `outputs/github-trending-chat/` 与 zip。

---

### Task 1: 创建一键启动器并验证

**Files:**
- Create: `一键启动.vbs`（项目根目录）
- Modify: `README.md`（补充一键启动说明）
- Deliver: `outputs/github-trending-chat/` 与 zip 同步更新

**Interfaces:**
- Consumes: 现有 `server.js`（`node server.js` 启动，默认端口 3000）。
- Produces: 无（独立交付物）。

- [ ] **Step 1: 创建 `一键启动.vbs`**

```vbs
' One-click launcher for GitHub Trending Chat
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
sh.Run "node server.js", 0, False
WScript.Sleep 2000
sh.Run "http://localhost:3000", 1, False
```

- [ ] **Step 2: 语法与逻辑验证（不弹浏览器）**

创建临时测试副本 `work/launcher-test.vbs`（去掉最后一行浏览器打开语句，其余相同），运行：

```bash
cscript //nologo work/launcher-test.vbs
```

Expected: 无报错、立即返回；随后确认 `http://localhost:3000` 返回 200（说明隐藏启动 node 生效、工作目录正确）。

验证后停掉测试启动的 node 进程（仅限命令行包含 `server.js` 且路径为项目目录的进程），删除测试副本。

- [ ] **Step 3: 真实运行验证**

运行：

```bash
cscript //nologo 一键启动.vbs
```

Expected: 3 秒内默认浏览器打开 `http://localhost:3000`，页面可访问；无可见控制台窗口。

- [ ] **Step 4: 更新 README.md**

在“运行”小节追加：

```markdown
Windows 用户也可以直接双击项目根目录的 `一键启动.vbs`：会自动后台启动服务并打开浏览器。
```

- [ ] **Step 5: 回归测试**

Run: `node --test`
Expected: 8/8 PASS（现有功能不受影响）。

- [ ] **Step 6: 更新交付物并提交**

复制 `一键启动.vbs` 到 `outputs/github-trending-chat/`，重新打包 `outputs/github-trending-chat.zip`，然后：

```bash
git add 一键启动.vbs README.md
git commit -m "feat: add one-click launcher"
```

---

## Self-Review 记录

- 规格覆盖：隐藏启动 ✅（Step 1 window style 0）、自动开浏览器 ✅（Step 3）、工作目录正确 ✅（Step 1 `ScriptFullName`）、无黑窗口 ✅、重复双击无副作用（设计文档第 4 节，脚本不额外处理端口占用，依赖 node 静默退出）。
- 占位符扫描：无 TBD/TODO。
- 类型/签名一致性：无跨任务接口。
