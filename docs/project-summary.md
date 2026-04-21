# 项目总结

## 1. 项目概述

`SaveAny` 是一个面向公开视频链接的 Web 工具，核心目标是帮助用户完成：

- 粘贴公开视频链接
- 解析视频基础信息
- 选择清晰度和格式
- 下载最终成片

在下载主链路稳定运行的基础上，项目继续扩展了 AI 视频理解能力，用于提升用户对视频内容的获取效率，包括：

- AI 总结摘要
- 字幕查看与下载
- 思维导图生成
- 基于字幕或转写文本的视频问答

当前产品定位依然是“下载优先，AI 增强”，不是内容平台，也不是知识库产品。

## 2. 当前技术栈

- 前端：React + Vite + TypeScript
- 样式：Tailwind CSS
- 后端：FastAPI
- 视频解析与下载：yt-dlp
- 媒体处理：FFmpeg
- AI 调用：DeepSeek API（通过 OpenAI-compatible SDK 接入）
- 语音识别：faster-whisper
- 简繁转换：OpenCC
- 数据库：SQLite + SQLAlchemy
- 支付：Stripe Checkout + Webhook

## 3. 已完成能力

### 3.1 视频解析与下载

- 支持输入公开视频链接并解析基础信息
- 支持展示标题、封面、作者、平台、时长等信息
- 支持将底层格式流整理成用户可理解的下载选项
- 支持“直链优先，代理兜底”的下载策略
- 支持音视频分离场景下由服务端合并输出 MP4 成片
- 支持下载缩略图代理加载，规避浏览器防盗链问题

### 3.2 平台支持

- 通用公开平台通过 `yt-dlp` 支持，包括 YouTube、Bilibili 等
- 抖音已接入专用解析链路，不依赖用户手动提供 Cookie
- 已对 Bilibili 裸域名链接做归一化处理，减少解析失败

### 3.3 AI 能力

- AI 总结摘要
- 字幕文本查看
- 字幕文件下载
- 思维导图生成与导出
- 基于字幕或 ASR 文本的视频问答

### 3.4 文本来源策略

后端当前按固定优先级获取可用文本：

1. 人工字幕
2. 自动字幕
3. Bilibili 官方字幕接口
4. ASR 语音识别

如果以上链路都失败，则明确返回“当前视频暂不支持 AI 总结”，不再把仅元数据降级为正常总结结果。

### 3.5 账号与会员

- 支持邮箱注册、登录、退出登录
- 使用 HttpOnly Cookie 维护登录态
- 支持 Stripe Checkout 创建支付会话
- 支持 Stripe Webhook 回写会员有效期
- 免费用户每天可体验 1 次 AI 总结
- 会员用户可使用完整 AI 能力

## 4. 当前前端状态

### 4.1 首页主流程

- 首页主路径已经聚焦“输入链接 -> 解析视频 -> 选择格式 -> 下载成片”
- 下载结果区支持封面、标题、平台、作者、时长、格式选择等信息展示
- 移动端和桌面端均可访问

### 4.2 AI 总结面板

- AI 功能通过下载结果区入口进入
- 当前采用独立弹层承载，不影响下载主流程
- 面板内包含 4 个标签页：
  - 总结摘要
  - 字幕文本
  - 思维导图
  - AI 问答

### 4.3 当前 UI 状态

- 下载结果卡片已重构为横向信息卡片风格
- 思维导图和总结摘要区域已做过一轮产品化样式优化
- 当前代码中仍存在部分历史乱码文案，后续需要继续清理

## 5. 当前后端接口

### 5.1 健康检查

- `GET /api/health`

### 5.2 视频相关

- `POST /api/video/parse`
- `POST /api/video/download-link`
- `GET /api/video/download`
- `GET /api/video/thumbnail`

### 5.3 AI 相关

- `GET /api/summarize`
- `GET /api/mindmap`
- `GET /api/transcript`
- `GET /api/qa`

### 5.4 账号相关

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

### 5.5 支付相关

- `POST /api/billing/create-checkout-session`
- `POST /api/billing/webhook`
- `GET /api/billing/checkout-session/{session_id}`

## 6. 本地运行方式

### 6.1 启动后端

```powershell
cd backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

### 6.2 启动前端

```powershell
cd frontend
npm run dev
```

默认地址：

- 前端：`http://127.0.0.1:5173`
- 后端：`http://127.0.0.1:8000`

## 7. 已验证内容

### 7.1 自动化验证

- 前端 `npm run build` 可通过
- 后端已补充视频解析、字幕、ASR、总结流相关测试

### 7.2 手工验证

已验证过的典型场景包括：

- 抖音链接解析成功
- 抖音代理下载成功
- Bilibili 链接解析成功
- Bilibili 无字幕视频可触发 ASR
- AI 总结流式返回成功
- 思维导图可正常生成和导出
- 会员支付成功后可获取会员能力

## 8. 当前边界

- 仅支持公开视频内容
- 不支持 DRM 内容
- 不支持需要登录态的私密内容
- 暂不支持批量任务中心
- 暂不支持多轮问答历史管理
- 暂不支持导出到 Word、PDF、Notion 等外部平台

## 9. 下一步建议

1. 继续清理前后端历史乱码文案
2. 补更多平台的元信息字段，例如播放量、简介、发布时间
3. 提升 AI 总结与 ASR 链路的自动化测试覆盖
4. 继续打磨下载结果区与 AI 面板之间的视觉一致性
5. 视业务需要评估后续是否扩展收藏、历史记录、分享能力
