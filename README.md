# 万能视频下载站

React + FastAPI + yt-dlp 的轻量视频下载站首版实现，当前已经完成核心下载闭环。

## 当前已完成

- 视频链接解析
- 视频基础信息展示
- 成片格式整理与选择
- 直链 / 服务端代理混合下载
- 抖音专用解析与下载支持

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

## 当前边界

- 支持公开视频链接解析与下载
- 不支持 DRM、登录态私有内容、破解类场景
- 当前版本不接数据库、登录、支付、批量任务系统

## 文档

- [需求分析文档](docs/requirements-analysis.md)
- [方案设计文档](docs/solution-design.md)
- [项目总结文档](docs/project-summary.md)
