# 方案设计文档

## 1. 技术选型

- 前端：React + Vite + TypeScript
- 样式：Tailwind CSS
- 后端：FastAPI
- 下载核心：yt-dlp
- 媒体合并：FFmpeg
- AI 服务：OpenAI-compatible API
- 字幕简体化：OpenCC

整体采用前后端分离架构，下载与 AI 总结共用同一套视频解析上下文。

## 2. 整体架构

### 2.1 下载链路

1. 用户在前端输入公开视频链接
2. React 前端调用 `POST /api/video/parse`
3. FastAPI 调用 `yt-dlp` 提取视频信息与格式列表
4. 后端将底层格式整理为用户可理解的下载选项
5. 前端展示标题、封面、平台、作者、时长、可下载格式
6. 用户选择目标格式
7. 前端调用 `POST /api/video/download-link`
8. 后端判断当前格式是否适合直链下载
9. 若可直链则浏览器直接下载，否则回退到 `GET /api/video/download`
10. 服务端代理下载并在必要时完成音视频合并

### 2.2 AI 总结链路

1. 用户在下载结果区域点击 `AI 总结`
2. 前端打开 AI 总结弹层
3. 弹层默认进入“总结摘要”页签
4. 前端通过 SSE 调用 `GET /api/summarize`
5. 后端按固定优先级获取视频文本
6. 后端将字幕或 ASR 结果统一转为简体中文
7. 若文本较长，则进行分块总结和聚合总结
8. 前端流式展示总结结果
9. 用户可进一步查看字幕、生成思维导图、进行问答

## 3. 下载相关 API

### `POST /api/video/parse`

输入：

- `url`

输出：

- 标题
- 封面
- 作者
- 时长
- 平台
- 下载格式列表
- 推荐格式与推荐策略

### `POST /api/video/download-link`

输入：

- `url`
- `format_id`

输出：

- 是否适合直链下载
- 下载策略说明
- 若可直链则返回目标下载地址

### `GET /api/video/download`

输入：

- `url`
- `format_id`

输出：

- 服务端下载完成后的最终文件流

### `GET /api/video/thumbnail`

作用：

- 代理拉取缩略图
- 规避浏览器直接加载时的 Referer / 防盗链问题

## 4. AI 总结相关 API

### `GET /api/summarize`

参数：

- `video_url`
- `preferred_language`

说明：

- 通过 `text/event-stream` 方式返回总结内容
- 支持 `progress`、`source-status`、`done`、`app-error` 等事件

### `GET /api/mindmap`

参数：

- `video_url`
- `preferred_language`

输出：

- 思维导图结构数据

### `GET /api/qa`

参数：

- `video_url`
- `question`
- `preferred_language`

说明：

- 通过 SSE 流式返回问答内容

### `GET /api/transcript`

参数：

- `video_url`
- `preferred_language`

输出：

- 完整字幕文本
- 字幕时间轴分段
- 文本来源信息

## 5. AI 文本获取策略

当前采用固定优先级链路：

1. 人工字幕
2. 自动字幕
3. Bilibili 官方字幕接口
4. ASR 语音识别

补充规则：

- 不再把仅元数据总结作为正常成功路径
- 若无可用文本则直接返回不支持总结
- 对外展示文本来源类型，便于前端提示“字幕总结”或“语音识别总结”

## 6. AI 输出设计

### 6.1 总结摘要

总结采用结构化文本输出，适合学习场景快速阅读。前端对 Markdown 结果进行二次样式化渲染，增强可读性。

### 6.2 字幕文本

字幕页支持：

- 时间轴分段查看
- 简体中文展示
- `.srt` 下载
- `.txt` 下载

### 6.3 思维导图

V1 采用画布型导图展示，而不是简单的纯文本 JSON：

- 支持拖拽查看
- 支持缩放
- 支持适配画布
- 支持全屏查看
- 支持导出高清 PNG

### 6.4 视频问答

问答要求：

- 严格基于可用字幕或转写文本回答
- 文本不足时明确提示
- 当前前端仅支持单轮问答

## 7. 前端页面设计

### 7.1 首页

首页结构保持“下载优先”的主路径：

- 顶部导航
- Hero 主标题
- 链接输入框
- 解析结果区
- 下载格式卡片区

### 7.2 AI 总结入口

当前方案为：

- 下载结果区提供 `AI 总结` 按钮
- 点击后打开独立弹层
- 不干扰下载主流程

### 7.3 AI 总结弹层结构

弹层包含：

- 顶部信息区
- 四个页签
  - 总结摘要
  - 字幕文本
  - 思维导图
  - AI 问答
- 左侧信息与操作区
- 右侧内容显示区

## 8. 缓存与错误语义

### 8.1 缓存

继续沿用文件缓存能力，缓存键基于：

- `url`
- `preferred_language`
- `model`

V1 不新增数据库。

### 8.2 错误语义

后端已约定以下错误语义：

- `SUMMARY_NOT_SUPPORTED`
- `TRANSCRIPT_UNAVAILABLE`
- `AI_PROVIDER_ERROR`
- `SUMMARY_TIMEOUT`
- `AI_RESPONSE_INVALID`

前端基于这些错误语义显示更明确的失败提示。

## 9. 本地运行与验证

### 9.1 后端

```powershell
cd backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

### 9.2 前端

```powershell
cd frontend
npm run dev
```

### 9.3 构建与测试

前端：

```powershell
cd frontend
npm run build
```

后端：

```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest -q
```

## 10. 后续演进建议

1. 继续统一清理代码与文档中的乱码问题
2. 优化 AI 总结弹层与下载结果区的视觉一致性
3. 增补更多 AI 总结与字幕链路自动化测试
4. 评估后续是否引入“弹层 / 页内分栏”双展示模式
5. 如需平台化扩展，再评估账号、历史记录、导出分享、知识库沉淀能力
