# Git 工作流

## 1. 目标

本项目当前以“小步提交、快速验证、避免回滚事故”为基本原则。

推荐工作方式：

- 先明确变更范围
- 小步修改
- 本地验证
- 再提交

## 2. 日常流程

### 2.1 开始前

先查看当前工作区状态：

```powershell
git status
```

如果需要同步主分支：

```powershell
git pull
```

### 2.2 开发中

建议按功能拆小提交，不要把不相关改动混在一起。

查看改动：

```powershell
git diff
```

查看某个文件的改动：

```powershell
git diff -- docs/project-summary.md
```

### 2.3 提交前

先完成最基本验证：

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

### 2.4 提交

添加指定文件：

```powershell
git add docs/project-summary.md docs/requirements-analysis.md docs/solution-design.md docs/git-workflow.md
```

提交：

```powershell
git commit -m "docs: refresh project documentation"
```

## 3. 提交信息建议

推荐格式：

- `feat: ...`
- `fix: ...`
- `refactor: ...`
- `docs: ...`
- `test: ...`
- `style: ...`

示例：

```powershell
git commit -m "feat: add stripe membership flow"
git commit -m "fix: normalize bilibili source url before parsing"
git commit -m "docs: refresh solution design and project summary"
```

## 4. 分支建议

如果后续多人协作，建议使用：

- `main`：稳定主分支
- `feature/...`：功能开发
- `fix/...`：问题修复
- `docs/...`：文档更新

示例：

```powershell
git checkout -b feature/ai-membership
git checkout -b fix/bilibili-asr-download
git checkout -b docs/refresh-project-docs
```

## 5. 合并前检查

合并前至少确认：

- 改动范围清晰
- 无明显无关文件混入
- 前端构建通过
- 后端测试通过
- 文案未引入新的乱码

## 6. 不建议的操作

当前项目开发阶段，不建议随意执行：

- `git reset --hard`
- `git checkout -- .`
- 未确认内容前直接覆盖他人改动

如果工作区很脏，先通过 `git status` 和 `git diff` 看清楚再处理。

## 7. 当前文档更新建议

当出现以下变化时，建议同步更新 `docs`：

- 新增或删除核心接口
- AI 链路策略变化
- 登录、会员、支付能力变化
- 下载主流程变化
- 产品定位或范围变化
