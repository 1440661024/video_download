# 万能视频下载器

一个基于 React + FastAPI + yt-dlp 的公开视频下载工具，当前已经完成下载主流程，并扩展了 AI 视频总结能力。

## 当前已完成

### 下载主流程

- 视频链接解析
- 视频基础信息展示
- 下载格式整理与选择
- 直链 / 服务端代理混合下载
- 抖音专用解析与下载支持
- 缩略图代理加载

### AI 增强能力

- AI 总结摘要
- 字幕文本查看
- 字幕文件下载（`.srt` / `.txt`）
- 思维导图生成
- 思维导图全屏与导出
- 视频单轮问答

## 快速启动

### 启动后端

```powershell
cd backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

### 启动前端

```powershell
cd frontend
npm run dev
```

默认地址：

- 前端：`http://127.0.0.1:5173`
- 后端：`http://127.0.0.1:8000`

## AI 能力说明

当前 AI 总结能力通过下载结果区的 `AI 总结` 按钮进入，采用单独弹层承载，不影响原有下载主流程。

已支持的页签能力：

- 总结摘要
- 字幕文本
- 思维导图
- AI 问答

文本来源优先级：

1. 人工字幕
2. 自动字幕
3. Bilibili 官方字幕接口
4. ASR 语音识别兜底

## 本地验证

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

## 当前边界

- 仅支持公开视频链接解析与下载
- 不支持 DRM 内容
- 不支持需要登录态的私密内容
- 当前版本不包含数据库、账号、支付、批量任务中心
- AI 总结当前仍以轻量增强为主，不做平台化沉淀

## 文档

- [需求分析文档](docs/requirements-analysis.md)
- [方案设计文档](docs/solution-design.md)
- [项目总结](docs/project-summary.md)
- [Git 工作流](docs/git-workflow.md)
