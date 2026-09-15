# Inky 0.1.1 本地发布验证

验证日期：2026-08-20

## 安装包

- NSIS：`src-tauri/target/release/bundle/nsis/Inky_0.1.1_x64-setup.exe`
  - SHA-256：`69D33508A9D66FE2F61192DE7613BC7C2C2E85C1A1D184D110AB4DF4640D1F46`
- MSI：`src-tauri/target/release/bundle/msi/Inky_0.1.1_x64_en-US.msi`
  - SHA-256：`C2C0BA8A25CE0ADEC8DE2B096D0011AD0092144ACAF0AA3B5C5CE15D44EA89B3`

两个安装包当前均未进行代码签名，只适合本机验证；对外分发前需要代码签名。

## 验证结果

- `package.json`、`Cargo.toml`、`Cargo.lock` 和 `tauri.conf.json` 的应用版本均为 `0.1.1`。
- 前端测试：26 项通过。
- Rust 测试：52 项通过。
- TypeScript 类型检查、前端构建、`cargo check` 和 Tauri 发布构建通过。
- NSIS 从 `0.1.0` 原位更新到 `0.1.1` 成功。
- Windows 卸载登记、程序 ProductVersion 与 FileVersion 均为 `0.1.1`。
- 安装路径为 `C:\Users\31009\AppData\Local\Inky`。
- 安装版成功读取 5 个任务、3 个子任务和 1 条专注历史。
- 当前没有运行中或暂停中的专注会话。
- 最终数据库版本为 7，完整性检查为 `ok`。

## 数据备份与回滚

- `0.1.1` 升级前备份：
  `C:\Users\31009\AppData\Roaming\com.inky.app\focusflow-before-v011-20260820-002055.sqlite3`
- 此前验证结束后的清理版：
  `C:\Users\31009\AppData\Roaming\com.inky.app\focusflow-release-clean-20260820-001121.sqlite3`

需要回滚数据时：先完全退出 Inky，备份当前 `focusflow.sqlite3`，再使用上述备份恢复。不要在 Inky 运行时替换数据库。

## 源码检查点

功能实现基线为 `11a86c6`。`0.1.1` 检查点包含本次版本号与发布记录更新；用户的计划和 PRD 文件不纳入发布提交。

## 当前限制

安装包尚未代码签名，不建议直接公开分发。
