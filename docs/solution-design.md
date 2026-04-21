# 方案设计文档

## 1. 技术选型

- 前端：React + Vite + TypeScript
- 样式：Tailwind CSS
- 后端：FastAPI
- 下载核心：yt-dlp
- 媒体处理：FFmpeg
- 语音识别：faster-whisper
- AI 服务：DeepSeek API
- 数据库：SQLite + SQLAlchemy
- 支付：Stripe Checkout + Webhook

整体采用前后端分离架构，下载主流程、AI 总结、登录支付共用同一套视频解析上下文。

## 2. 整体架构

### 2.1 下载链路

1. 用户在前端输入公开视频链接
2. 前端调用 `POST /api/video/parse`
3. 后端解析视频信息和可用格式
4. 后端将底层格式整理为用户可理解的下载选项
5. 前端展示封面、标题、平台、作者、时长、格式等信息
6. 用户选择目标格式
7. 前端调用 `POST /api/video/download-link`
8. 后端判断当前格式适合直链还是服务端代理
9. 若可直链则直接下载，否则走 `GET /api/video/download`
10. 服务端在必要时完成音视频合并并返回成片

### 2.2 AI 总结链路

1. 用户点击下载结果区中的 `AI 总结`
2. 前端打开 AI 面板
3. 面板默认进入“总结摘要”标签页
4. 前端通过 SSE 调用 `GET /api/summarize`
5. 后端按优先级获取视频文本
6. 若无字幕则尝试 ASR
7. 后端将文本统一做规范化处理
8. AI 生成结构化总结并通过 SSE 流式返回
9. 用户可继续查看字幕、导图或基于文本提问

### 2.3 账号与支付链路

1. 用户注册或登录
2. 后端通过 HttpOnly Cookie 维护会话
3. 用户点击开通会员
4. 前端调用 `POST /api/billing/create-checkout-session`
5. 后端创建 Stripe Checkout Session
6. 用户支付完成后由 Stripe Webhook 回调
7. 后端更新会员有效期
8. 前端通过 `/api/auth/me` 和 `/api/billing/checkout-session/{session_id}` 刷新状态

## 3. 模块划分

### 3.1 视频服务

职责：

- 解析视频基础信息
- 归一化可下载格式
- 生成下载策略
- 处理服务端下载与文件清理
- 针对抖音提供专用解析链路

### 3.2 转写与总结服务

职责：

- 获取字幕
- 处理 Bilibili 官方字幕接口
- 执行 ASR 语音识别
- 组织总结上下文
- 流式输出总结结果

### 3.3 前端结果区

职责：

- 展示视频基础信息
- 展示格式列表
- 发起下载
- 承载 AI 总结入口

### 3.4 AI 面板

职责：

- 展示总结摘要
- 展示字幕文本
- 展示思维导图
- 承载视频问答

### 3.5 账号与支付模块

职责：

- 注册、登录、退出
- 查询当前用户状态
- 判断是否具备 AI 权限
- 创建支付会话
- 处理支付成功回写

## 4. 关键 API

### 4.1 健康检查

#### `GET /api/health`

返回服务状态。

### 4.2 视频相关

#### `POST /api/video/parse`

输入：

- `url`

输出：

- 标题
- 封面
- 作者
- 平台
- 时长
- 描述
- 播放量
- 下载格式列表

#### `POST /api/video/download-link`

输入：

- `url`
- `format_id`

输出：

- 当前格式的下载策略
- 直链地址或代理说明

#### `GET /api/video/download`

输入：

- `url`
- `format_id`

输出：

- 服务端下载完成后的最终文件流

#### `GET /api/video/thumbnail`

作用：

- 代理拉取缩略图
- 规避浏览器直接加载时的 Referer / 防盗链问题

### 4.3 AI 相关

#### `GET /api/summarize`

参数：

- `video_url`
- `preferred_language`

说明：

- 通过 `text/event-stream` 返回总结内容
- 支持 `progress`、`source-status`、`preview-summary`、`summary-reset`、`done`、`app-error` 等事件

#### `GET /api/mindmap`

参数：

- `video_url`
- `preferred_language`

输出：

- 思维导图结构数据

#### `GET /api/transcript`

参数：

- `video_url`
- `preferred_language`

输出：

- 完整字幕文本
- 时间轴分段
- 文本来源信息

#### `GET /api/qa`

参数：

- `video_url`
- `question`
- `preferred_language`

说明：

- 通过 SSE 流式返回问答内容

### 4.4 账号与支付

#### `POST /api/auth/register`

- 注册账号并写入登录 Cookie

#### `POST /api/auth/login`

- 登录并写入登录 Cookie

#### `POST /api/auth/logout`

- 清除登录 Cookie

#### `GET /api/auth/me`

- 获取当前用户、会员状态和免费额度

#### `POST /api/billing/create-checkout-session`

- 创建 Stripe Checkout 会话

#### `POST /api/billing/webhook`

- 处理 Stripe Webhook，回写会员权益

#### `GET /api/billing/checkout-session/{session_id}`

- 前端支付跳转后补查支付状态

## 5. AI 文本获取策略

当前采用固定优先级：

1. 人工字幕
2. 自动字幕
3. Bilibili 官方字幕接口
4. ASR 语音识别

补充规则：

- 不再把仅元数据总结视为正常成功链路
- 若无可用文本则直接返回不支持总结
- 对前端明确暴露文本来源，便于展示“字幕总结”或“语音识别总结”

## 6. ASR 设计要点

- 默认使用 faster-whisper
- 服务启动时后台预热模型，减少首次调用等待
- 支持预转写，用于更早给用户展示首屏总结内容
- 当原始音频识别失败时，支持关闭 VAD、转换 PCM WAV 等兜底尝试
- 明确暴露错误码，例如 `ASR_AUDIO_DOWNLOAD_FAILED`

## 7. 缓存与状态

### 7.1 轻量缓存

当前继续使用文件缓存和少量内存缓存：

- 视频解析结果缓存
- 文本载荷缓存
- 转写结果缓存

### 7.2 用户状态

数据库保存：

- 用户账号
- 密码哈希
- 会员有效期
- 免费 AI 使用时间
- Stripe Webhook 幂等事件

## 8. 错误设计

后端当前强调“明确失败”，典型错误包括：

- 视频解析失败
- 下载失败
- 无可用字幕
- ASR 音频提取失败
- AI 提供方异常
- 登录态缺失
- 会员权限不足
- Stripe 未配置或支付失败

前端基于这些错误语义展示明确提示，不做伪成功。

## 9. 本地运行与验证

### 9.1 启动后端

```powershell
cd backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

### 9.2 启动前端

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

1. 继续清理代码和文档中的历史乱码
2. 补更多平台的结构化元信息
3. 增强支付、会员、AI 链路的自动化测试
4. 继续优化 AI 面板与下载主流程的视觉一致性
5. 视业务阶段再评估历史记录、收藏、分享等平台能力
