# -*- coding: utf-8 -*-
"""把「历史github日榜汇总」下的日榜归档同步到 Obsidian 库。

行为：
1. 扫描 历史github日榜汇总/<年>年/<月>月/<YYYY-MM-DD>.md。
2. 补上 YAML frontmatter（title / date / tags），统一 UTF-8 无 BOM + LF。
3. 写入 F:\\obsidian\\github日榜\\GitHub每日榜单\\<YYYY-MM-DD>.md。
4. 重建 GitHub日榜索引.md（按日期倒序的 wikilink 表格，含上榜数与 Top1 仓库）。

源文件只读，不改动。
"""
from __future__ import annotations

import glob
import os
import re
import sys

SRC_ROOT = r"F:\github-trending-chat\历史github日榜汇总"
DST_DIR = r"F:\obsidian\github日榜\GitHub每日榜单"
TAGS = ["GitHub日榜", "Trending", "开源项目"]
REPO_URL = "https://github.com/q93304989-bit/github-trending-chat/blob/main"


def _repo_url(rel_path: str) -> str:
    from urllib.parse import quote

    return f"{REPO_URL}/{quote(rel_path.replace(os.sep, '/'))}"


def main() -> int:
    os.makedirs(DST_DIR, exist_ok=True)

    rows = []
    for path in sorted(glob.glob(os.path.join(SRC_ROOT, "*年", "*月", "*.md"))):
        name = os.path.basename(path)
        m = re.fullmatch(r"(\d{4}-\d{2}-\d{2})\.md", name)
        if not m:
            continue
        date = m.group(1)
        rel = os.path.relpath(path, r"F:\github-trending-chat").replace(os.sep, "/")

        raw = open(path, "rb").read()
        if raw.startswith(b"\xef\xbb\xbf"):
            raw = raw[3:]
        text = raw.decode("utf-8").replace("\r\n", "\n").replace("\r", "\n")

        # 上榜仓库数
        m_count = re.search(r"上榜仓库[:：]\s*(\d+)", text)
        count = m_count.group(1) if m_count else "0"

        # 榜单首行仓库（Top1）
        top1 = ""
        for ln in text.split("\n"):
            m_row = re.match(r"^\|\s*01\s*\|\s*\[([^\]]+)\]", ln)
            if m_row:
                top1 = m_row.group(1)
                break

        fm = (
            "---\n"
            f'title: "GitHub 日榜 {date}"\n'
            f"date: {date}\n"
            "tags:\n" + "".join(f"  - {t}\n" for t in TAGS) + "---\n\n"
        )
        body = text if text.startswith("---\n") else fm + text

        body = body.rstrip("\n") + f"\n\n---\n\n> 仓库归档：[{rel}]({_repo_url(rel)})\n"

        out_path = os.path.join(DST_DIR, f"{date}.md")
        with open(out_path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(body)
        rows.append((date, count, top1))
        print(f"OK  {date}  ({count} repos, top1={top1 or '-'})")

    rows.sort(key=lambda r: r[0], reverse=True)
    idx = [
        "---",
        'title: "GitHub 日榜索引"',
        "tags:",
        *[f"  - {t}" for t in TAGS],
        "  - MOC",
        "---",
        "",
        "# GitHub 日榜索引",
        "",
        f"共 {len(rows)} 篇，按日期倒序。来源：`历史github日榜汇总/<年>年/<月>月/`（脚本 `scripts/sync_daily_to_obsidian.py`）。",
        "",
        "| 日期 | 上榜数 | Top1 仓库 |",
        "| --- | --- | --- |",
    ]
    for date, count, top1 in rows:
        idx.append(f"| [[{date}]] | {count} | {top1 or '—'} |")
    idx.append("")
    with open(os.path.join(DST_DIR, "GitHub日榜索引.md"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(idx))

    print(f"\nDONE: {len(rows)} archives -> {DST_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
