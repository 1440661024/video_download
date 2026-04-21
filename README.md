# SaveAny

一个面向公开视频链接的 Web 工具，支持视频解析、格式选择、下载成片，并提供基于 DeepSeek API 的 AI 视频理解能力。

## 项目定位

`SaveAny` 当前聚焦两类核心能力：

- 下载主流程：输入链接、解析视频、选择格式、下载成片
- AI 增强能力：总结摘要、字幕查看与下载、思维导图、视频问答

产品定位依然是“下载优先，AI 增强”，不是内容社区，也不是知识库平台。

## 当前已支持

### 下载能力

- 公开视频链接解析
- 视频基础信息展示
- 下载格式整理与选择
- 直链优先、服务端代理兜底
- 音视频分离场景下服务端合并 MP4
- 缩略图代理加载
- 抖音专用解析与下载链路
- Bilibili 链接归一化处理

### AI 能力

- AI 总结摘要
- 字幕文本查看
- 字幕文件下载
- 思维导图生成与导出
- 基于字幕或 ASR 文本的视频问答

### 用户与会员

- 邮箱注册、登录、退出
- HttpOnly Cookie 登录态
- 免费用户每天 1 次 AI 总结额度
- Stripe 国际支付开通会员
- 支付完成后会员权益同步

## 文本来源优先级

AI 总结当前按固定优先级获取文本：

1. 人工字幕
2. 自动字幕
3. Bilibili 官方字幕接口
4. ASR 语音识别

如果没有可用文本，则直接返回不支持 AI 总结，不再走仅元数据降级总结。

## 技术栈

- 前端：React + Vite + TypeScript
- 样式：Tailwind CSS
- 后端：FastAPI
- 视频解析与下载：yt-dlp
- 媒体处理：FFmpeg
- AI 服务：DeepSeek API（通过 OpenAI-compatible SDK 接入）
- 语音识别：faster-whisper
- 简繁转换：OpenCC
- 数据库：SQLite + SQLAlchemy
- 支付：Stripe Checkout + Webhook

## 项目结构

```text
video_download/
├─ frontend/          # React 前端
├─ backend/           # FastAPI 后端
├─ docs/              # 项目文档
└─ README.md
```

## 快速启动

### 1. 启动后端

```powershell
cd backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

### 2. 启动前端

```powershell
cd frontend
npm run dev
```

默认地址：

- 前端：`http://127.0.0.1:5173`
- 后端：`http://127.0.0.1:8000`

## 常用验证

### 前端构建

```powershell
cd frontend
npm run build
```

### 后端测试

```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest -q
```

## 核心接口

### 健康检查

- `GET /api/health`

### 视频相关

- `POST /api/video/parse`
- `POST /api/video/download-link`
- `GET /api/video/download`
- `GET /api/video/thumbnail`

### AI 相关

- `GET /api/summarize`
- `GET /api/mindmap`
- `GET /api/transcript`
- `GET /api/qa`

### 账号相关

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

### 支付相关

- `POST /api/billing/create-checkout-session`
- `POST /api/billing/webhook`
- `GET /api/billing/checkout-session/{session_id}`

## 环境说明

当前后端通过 `backend/.env` 加载关键配置，包括：

- `AI_API_KEY`
- `AI_API_BASE_URL`
- `AI_MODEL`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `FRONTEND_BASE_URL`

当前实际 AI 配置为 DeepSeek 官网接口：

- `AI_API_BASE_URL=https://api.deepseek.com/v1`
- `AI_MODEL=deepseek-chat`

## 当前边界

- 仅支持公开视频内容
- 不支持 DRM 内容
- 不支持需要登录态的私密内容
- 暂不支持批量任务中心
- 暂不支持多轮问答历史管理
- 暂不支持导出到 Word、PDF、Notion 等外部平台

## 文档索引

- [需求分析](docs/requirements-analysis.md)
- [方案设计](docs/solution-design.md)
- [项目总结](docs/project-summary.md)
- [Git 工作流](docs/git-workflow.md)
