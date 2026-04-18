# Git 工作流

## 1. 为什么要用分支

分支的目标，是让项目在不影响 `main` 稳定性的前提下，独立开发新功能、修复问题、尝试新方案。

这个项目后续仍会持续扩展，例如：

- AI 视频总结
- 字幕翻译
- 批量下载
- 会员能力
- 后台管理

这些能力都不建议直接在 `main` 上开发，而应先开功能分支，开发和验证通过后再合并回 `main`。

## 2. 建议保留的分支角色

### `main`

作用：

- 存放当前稳定、可运行、可演示的版本

原则：

- 尽量不要直接在 `main` 上做复杂开发
- 只有确认稳定的改动才合并进 `main`

### `feature/*`

作用：

- 用于开发新功能

示例：

- `feature/video-summary`
- `feature/subtitle-translate`
- `feature/batch-download`
- `feature/member-system`

### `fix/*`

作用：

- 用于修复独立 Bug

示例：

- `fix/douyin-download`
- `fix/frontend-layout`
- `fix/parse-error-handling`

## 3. 推荐工作方式

每做一个新功能，建议都按下面流程走：

1. 先切回 `main`
2. 拉取最新代码
3. 新建功能分支
4. 在分支上开发和测试
5. 分支开发完成后提交并推送
6. 验证通过后再合并回 `main`

## 4. 常用命令

### 4.1 从 `main` 创建新功能分支

```bash
git checkout main
git pull
git checkout -b feature/video-summary
```

### 4.2 功能开发后提交

```bash
git add .
git commit -m "feat: add video summary module"
git push -u origin feature/video-summary
```

### 4.3 合并回 `main`

```bash
git checkout main
git pull
git merge feature/video-summary
git push
```

### 4.4 修复问题时创建修复分支

```bash
git checkout main
git pull
git checkout -b fix/douyin-download
```

开发完成后：

```bash
git add .
git commit -m "fix: improve douyin download stability"
git push -u origin fix/douyin-download
```

再合并回 `main`：

```bash
git checkout main
git pull
git merge fix/douyin-download
git push
```

## 5. 本项目建议遵循的规则

- `main` 永远保持可运行
- 新功能尽量都走 `feature/*`
- 修 Bug 尽量都走 `fix/*`
- 分支开发完成后再合并回 `main`
- 每次合并回 `main` 前，至少执行一次基本验证

建议最低验证包括：

- 前端：`npm run build`
- 后端：`pytest -q`

## 6. 适合当前项目的后续分支示例

- `feature/video-summary`
- `feature/subtitle-translate`
- `feature/member-ui`
- `feature/batch-download`
- `fix/douyin-parser`
- `fix/mobile-layout`
- `fix/summary-modal-layout`

## 7. 什么情况下可以直接改 `main`

只有非常小、风险极低的改动，可以考虑直接在 `main` 上处理，例如：

- 一两处文案修正
- 很小的样式修正
- README 或文档补充

但只要涉及：

- 新功能开发
- 结构调整
- 下载逻辑变更
- AI 总结核心逻辑变更

都建议统一走分支。

## 8. 当前项目的实践建议

从现在开始，建议长期采用下面这套模式：

- `main`：保存当前稳定版本
- 每做一个功能扩展，先创建新分支
- 开发完成并通过验证后，再合并回 `main`

这样做的好处：

- 主线更稳定
- 出问题更容易回退
- 每次改动边界更清晰
- 后续无论是你自己继续开发，还是让 AI / 其他人协作接手，都更容易理解
