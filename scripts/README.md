# 项目脚本

从项目根目录运行命令。自动化测试入口见 [项目说明](../README.md)。

- `prepare-paper-pets.py`：从保存的蜡笔原图重建透明宠物资源；属于素材工具，日常构建不需要运行。
- `desktop/`：当前结束页与休息页的原生验收，使用独立 debug 标识和独立数据目录。
- `diagnostics/`：只读进程诊断。显式传入目标 PID；历史默认 PID 不可复用。
- `archive/`：旧版本一次性验收源码，留作取证参考，依赖已经删除的历史测试环境或旧文案，不属于当前验证入口。尤其不要用旧正式版空库检查脚本验证已有工作记录的应用。

## 原生页面验收

```powershell
corepack pnpm tauri build --debug --no-bundle --config scripts/desktop/tauri-test.json
./scripts/desktop/launch-acceptance.ps1
node scripts/desktop/verify-session-pages.mjs
```

输出在 `output/desktop-acceptance/`。脚本在写入前核对连接文件属于该隔离目录，并要求任务为空；不接受正式连接。新一轮验收前，先关闭上一次验收进程，再归档或清理这个目录。完成后从测试窗口托盘退出；也可核对 PID 的可执行路径后停止对应 debug 进程。不要结束正式 Paper 或 Hermes。

页面脚本验证字体实际加载、拖动、选项动画与键盘、草稿、保存、长内容滚动、休息和 Markdown。它不代表对全部页面或真实模型的完整验收。迁移脚本后的本次整理未重新执行此原生流程；历史证据见 [验证归档](../docs/verification/README.md)。
