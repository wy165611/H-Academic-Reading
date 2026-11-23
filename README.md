# H文献大师 · Scholaread Self-Hosted (Editorial Edition)

个人自用的 AI 学术文献流式阅读与管理平台，采用「编辑杂志风（Editorial Magazine Style）」版面设计，原生支持 PC 桌面端与 iPhone/iPad Safari PWA（添加到主屏幕全屏使用）实时云端同步。针对 **2 核 4GB 内存**轻量级云主机进行深度内存优化，默认集成阿里云百炼（OpenAI 兼容接口）。

## 核心特性

1. **编辑杂志风与沉浸式阅读体验**
   - 暖米纸底色 `#f9f8f6`、墨黑 `#1c1c1c`、石墨次要字色 `#6b7280` 与陈玫点缀 `#816d70`，全站直角与 `1px` 发丝线分隔，消除视觉噪音。
   - **流式重排 / 原版 PDF** 一键切换；**双语对照 / 纯中文 / 纯英文** 三种阅读视图；支持字号、行距、版心宽度与衬线/无衬线字体调节。
   - 正文自动识别 `Fig. X` / `Table X` 与 `[1]` 参考文献角标，点击原地弹出高清图表、双语图注或文献引用卡片。

2. **低内存单并发逐页流式 AI 解析引擎**
   - 后台异步队列**严格限制并发数为 1**，逐页渲染 PDF 图像、识别双栏阅读顺序并转换为标准 LaTeX 公式（`$...$` / `$$...$$`），每页解析裁剪图表后立即关闭句柄并 `gc.collect()` 释放内存。
   - 自动结合 PDF 首页文本、Crossref / OpenAlex API 与 LLM 结构化输出，提取标题、中文译题、作者、年份、期刊及**期刊分区徽章**（中科院分区 / JCR 分区 / CCF 等级 / arXiv）。

3. **划词工具条与「段落锚点 AI 对话持久化」**
   - 选中正文任意英文或中文段落，立即在选区正上方弹出：`AI 解释`、`问问 AI`、`翻译`（支持就地更新保存段落译文）、`高亮`（4 色高亮 + 云端批注）。
   - 发起 **`AI 解释`** 或 **`问问 AI`** 后，自动在数据库持久化保存 `qa_anchor` 锚点及完整问答历史，并在正文对应文字下方渲染陈玫色虚线及星标角标；无论在 Mac 还是 iPhone 上重新打开论文，点击该标记即可回看当时选中的原文与问答并继续追问。

4. **多模型分模块动态配置（前端设置页可改可测）**
   - 视觉重排与图表坐标解析模型（默认 `qwen3.5-ocr`）
   - 后台整篇并发翻译 & 元数据/分区提取模型（默认 `deepseek-v4.1-flash-1017`）
   - 侧边栏 AI 伴读 & 划词深度解释模型（默认 `deepseek-v4.1-flash-1017`，支持调节思考强度 `high` / `medium` / `low`）

## 系统架构

```
+-------------------------------------------------------------------+
|                   Browser / iPhone & iPad PWA                     |
|           Next.js App Router + Tailwind + KaTeX + react-pdf       |
+---------------------------------+---------------------------------+
                                  | Same-Origin /api/* Proxy
                                  v
+-------------------------------------------------------------------+
|                 FastAPI Backend (Single Worker)                   |
|   JWT Auth  |  Library & Reader APIs  |  Single-Concurrency Queue |
+----------+------------------------------------------+-------------+
           |                                          |
           v                                          v
+---------------------+                 +---------------------------+
|  PostgreSQL 16      |                 |  Local ./data Storage     |
|  Papers, Blocks,    |                 |  pdfs/ figures/ thumbs/   |
|  Highlights,        |                 |  (JWT-protected streaming)|
|  QA Anchors & Chat  |                 +---------------------------+
+---------------------+
```

## 自托管 Docker 快速启动

### 方式一：使用预构建镜像（推荐 2C4G 云主机）

```bash
cp .env.example .env
# 编辑 .env，设置 ADMIN_PASSWORD、JWT_SECRET、POSTGRES_PASSWORD 与百炼 DEFAULT_LLM_API_KEY
mkdir -p data/pdfs data/figures data/thumbnails
docker compose -f docker-compose.prod.yml up -d
```

### 方式二：本地源码构建

```bash
cp .env.example .env
mkdir -p data/pdfs data/figures data/thumbnails
docker compose up -d --build
```

启动完成后访问 `http://localhost:3000`，使用 `.env` 中配置的 `ADMIN_USERNAME` 和 `ADMIN_PASSWORD` 登录。iOS / iPadOS 用户可在 Safari 中打开后点击「分享 → 添加到主屏幕」获得全屏沉浸式 PWA 体验。
