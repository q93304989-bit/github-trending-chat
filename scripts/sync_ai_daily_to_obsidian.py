# -*- coding: utf-8 -*-
"""把 outputs/ 下的 AI 日报（ai_daily_YYYY-MM-DD.md）同步到 Obsidian 库。

行为：
1. 读取 outputs/ai_daily_*.md，统一为 UTF-8 无 BOM + LF。
2. 若缺少 YAML frontmatter，则补上 title / date / tags。
3. 写入 F:\\obsidian\\github日榜\\AI日报\\<date>.md。
4. 重建 AI日报索引.md（按日期倒序的 wikilink 表格）。

源文件只读，不改动。
"""
from __future__ import annotations

import glob
import os
import re
import sys

SRC_DIR = r"F:\github-trending-chat\outputs"
DST_DIR = r"F:\obsidian\github日榜\AI日报"
TAGS = ["AI日报", "AIcoding", "具身智能"]


def main() -> int:
    os.makedirs(DST_DIR, exist_ok=True)

    rows = []
    for path in sorted(glob.glob(os.path.join(SRC_DIR, "ai_daily_*.md"))):
        name = os.path.basename(path)
        m = re.search(r"(\d{4}-\d{2}-\d{2})", name)
        if not m:
            print(f"SKIP (no date): {name}")
            continue
        date = m.group(1)

        raw = open(path, "rb").read()
        if raw.startswith(b"\xef\xbb\xbf"):
            raw = raw[3:]
        text = raw.decode("utf-8").replace("\r\n", "\n").replace("\r", "\n")

        lines = text.split("\n")
        first_h1 = next((ln[2:].strip() for ln in lines if ln.startswith("# ")), "")
        title = first_h1 or f"AI 日报 · {date}"

        # 首个主条标题，用于索引里的摘要列
        GENERIC = {
            "今日速览", "速览", "今日 5 条", "今日5条", "今日 5 条 ", "目录", "摘要",
            "附注", "信息来源", "筛选原则", "今日话题", "数据速览", "今日焦点",
            "其他值得记录", "其他动态",
        }
        first_item = ""
        for ln in lines:
            m2 = re.match(r"^#{2,3}\s+(?:\d+[.、)]\s*)?(.+?)\s*$", ln)
            if not m2:
                continue
            cand = m2.group(1).strip()
            if cand in GENERIC or "附注" in cand or "来源" in cand or "原则" in cand:
                continue
            # 跳过「一、今日要点」这类层级小节标题（取真正的第一条主选题）
            if re.match(r"^[一二三四五六七八九十]+[、.．]", cand) or "要点" in cand:
                continue
            first_item = cand
            break

        if not text.startswith("---\n"):
            fm = (
                "---\n"
                f'title: "{title}"\n'
                f"date: {date}\n"
                "tags:\n" + "".join(f"  - {t}\n" for t in TAGS) + "---\n\n"
            )
            text = fm + text

        out_path = os.path.join(DST_DIR, f"{date}.md")
        with open(out_path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
        rows.append((date, title, first_item))
        print(f"OK  {date}  <- {name}  ({len(text)} chars)")

    rows.sort(key=lambda r: r[0], reverse=True)
    idx = [
        "---",
        'title: "AI 日报索引"',
        "tags:",
        *[f"  - {t}" for t in TAGS],
        "  - MOC",
        "---",
        "",
        "# AI 日报索引",
        "",
        f"共 {len(rows)} 篇，按日期倒序。来源：`F:\\github-trending-chat\\outputs\\ai_daily_*.md`。",
        "",
        "| 日期 | 首条主选题 |",
        "| --- | --- |",
    ]
    for date, _title, first_item in rows:
        idx.append(f"| [[{date}]] | {first_item or '—'} |")
    idx.append("")
    with open(os.path.join(DST_DIR, "AI日报索引.md"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(idx))

    print(f"\nDONE: {len(rows)} reports -> {DST_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
