# Inky Paper 0.5.8 字体定稿验收

final result: passed

用户已选择：B 用于完成选项，C 用于“复习”这类大任务文字。实际桌面为 `output/playwright/font-delivery-20260914/end-default.png` 和 `end-shading-selected.png`；字体参照为 `output/handwriting-options-20260914/font-options.png` 的 B、C 两组。已打开最终桌面截图检查字体、层次、间距与完整显示。

- 手写任务：C / Xiaolai，42px；选项：B / Yozai Regular，18px。使用原始字体文件随包加载。
- 通过原生 WebView2 的 `CSS.getPlatformFontsForNode` 核对实际绘制字形：标题 postScriptName 为 `Xiaolai`、2 字；选项为 `Yozai-Regular`、4 字，均为 custom font。不是仅检查 CSS 字体名称。证据：`output/font-delivery-20260914/rendered-fonts.json`。
- 两份字体与选定示例使用的原始 TTF 字节一致，SHA-256、字库覆盖检查见 `font-verification.json`；完整许可随资源及 `app/licenses` 一起提供。无需系统安装或联网加载。
- 结束页仍为 320×482 CSS px，截图 480×723、缩放 1.5；两行英文页脚下无溢出。原间距、铅笔划线和选中涂抹保持正常，文字可读。
- 本轮复用桌面流程验证实际拖动、选项点击/键盘/减少动画、笔记和草稿、保存、长任务换行与滚动、休息、Markdown 写入。结果见 `output/font-delivery-20260914/desktop-verification.json`，无 pageerror。
- 类型检查随构建通过。本轮为字体和样式调整，不新增测试、不重跑旧版 128 项前端及 61 项后端单元测试；记录为历史基线，未计为本轮测试。

本轮没有剩余视觉阻断项。正式程序交付校验见 `output/font-delivery-20260914/release-verification.json`；原生验收仅使用本目录的隔离数据。

---

## 0.5.7 视觉与拖动验收（历史）

final result: passed

## 本轮修订

用户最新要求覆盖旧版字体与单选外观：改进手写字体及划线、修复结束页拖动、两个完成选项使用手写体并以浅铅笔涂抹动画表示选中。

实际证据为 `output/playwright/pencil-ending-20260914/end-default.png`、`end-shading-drawing.png`、`end-shading-selected.png`。已打开并逐项检查 480×723 物理像素的原生截图，对应 320×482 CSS px、1.5 倍显示缩放。旧版布局基准依然为 `output/final-pages-20260914/approved-design.png`；本轮选项样式以用户最新描述为准。

- 字体：任务使用当前机器已安装的 STXingkai，42px；完成选项同字体 22px。与之前规整楷体相比笔势更连贯。实际系统字形并非生成图的逐笔复刻，字体栈包含 KaiTi 回退，不分发系统字体文件。
- 划线：独立 `task-pencil-underline.svg`，轻微上斜、双层浅石墨笔触、纸纹及末端淡出；不修改其他页面原有划线资产。
- 选项：原生 radio 保留语义及键盘操作，外观改为手写文字；选中后两层铅笔笔画在 480ms 内画入。已查看动画中途和结束截图，浅涂抹没有遮挡文字。减少动画时直接显示结果，高对比模式补充选中轮廓。
- 布局：上 28px / 下 22px 留白、细虚线、记录入口与保存间距延续定稿。两行英文标语下 footer bottom 为 463.54px，scrollHeight = clientHeight = 482，无裁切；长标题及展开记录保留滚动。
- 色彩和图像：保留原暖纸、石墨、浅绿及鱼资产。涂抹为扩展现有铅笔绘制方式的矢量笔触，没有引入位图占位。
- 拖动：真实窗口标题、手写文字、纸面空白各移动 40 CSS px 后，原生窗口坐标均变化 60 物理像素；符合当前缩放。控件、文字输入/选择和滚动不会带动窗口。

128 项前端测试及类型检查通过；本轮桌面回归覆盖窗口实际位移、动画、方向键、减少动画、笔记、草稿、保存结果、长内容、休息和 Markdown。无 pageerror。证据见 `output/pencil-ending-20260914/desktop-verification.json`。原生验收仅使用该目录隔离数据，最终交付校验见同目录 `release-verification.json`。

无剩余 P0 / P1 / P2 问题。本轮未改 Rust 实现，未重复旧版后端测试；旧版完整验收副本存于 `output/final-pages-20260914/design-qa-0.5.6.md`。

---

## 0.5.6 基础版式验收记录（历史）

final result: passed

2026-09-14。本次范围为已确认的结束番茄钟、休息中和休息结束页面，以及共用英文页脚。用户最后要求增加手写任务上下留白并定稿。

## 比较证据

- source visual truth: `output/final-pages-20260914/approved-design.png`，1568×1003。
- implementation: `output/playwright/final-pages-20260914/end-default.png`（480×723）、`rest-running.png`（480×663）。来自隔离数据的真实 Tauri / WebView2 窗口，设备密度 1.5。
- viewport: 结束页 320×482 CSS px；休息页 320×442 CSS px。
- combined comparison: `output/playwright/final-pages-20260914/design-comparison.png`。同一画面并列参考结束页、实际结束页、参考休息页和实际休息页；参考板按页面边界裁切显示，所有页面统一为 320 CSS px 宽，不拉伸高度。
- comparison reproduction: `output/final-pages-20260914/compare-design.mjs` 与生成的 `design-comparison.html`。仅在 HTML 中显示原图并归一化比例，未修改源图片。
- state: 同为浅色纸面，结束页任务“复习”、记录收起、默认未完成；休息页同为 04:54。结束页实际计时为 0 分 0 秒，参考为示例 12 分 30 秒；英文标语使用真实随机值。时间、真实进度和随机文案差异不作为视觉缺陷。
- 额外状态：`end-expanded.png`、`long-task-scroll.png`、`rest-waiting.png`。展开记录和长任务使用自然滚动，保存按钮可达。休息结束由隔离环境 `end_session` 转为 waiting，未把它记为等待五分钟的自然到时测试。

已打开上述原图、原始桌面截图及归一化并排比较图。控件、字体和间距在原始截图及比较图中均可辨认，本次不需要额外局部放大图。

## 比较结果

| 检查面 | 结果 |
| --- | --- |
| 字体与层次 | 正文沿用 Noto Sans SC，手写任务使用本机 KaiTi、37px / 1.2，标语沿用 Caveat。任务居中且完整换行，补充记录降为 12px。参考的生成式手写笔画无法对应真实字体；采用系统楷体是实现选择。原品牌保留用户已确认的字号和字重。 |
| 留白与布局 | 任务上 28px、下 22px，任务和记录之间细虚线；状态标题到选项 14px，选项到保存按钮 20px。结束页比参考更舒展，对应用户最后的留白要求。休息页按真实字体和两行英文页脚增加必要高度，移除原 520px 页面的过量空白。短内容两页均无溢出。 |
| 色彩 | 保留产品现有暖纸色、石墨字色及 sage accent #52634f；未沿用生成图偏青的绿色。选中项浅绿、单个主要按钮深绿，未选中项细边线。没有增加装饰性色块或阴影。 |
| 图像与图标 | 使用项目既有纸张、鱼、铅笔划线资产及 Lucide 图标。原鱼与生成图示意鱼的线条不同，属于保留已确认资产；无新占位图。修正了休息页继承专注淡出规则导致纸面透明的问题。 |
| 文案与内容 | 记录下方是“这一步完成了吗？”，选择“还没完成 / 已完成”，随后单个“保存并结束”。返回入口、休息文案与批准结构一致。首页、结束页、休息两状态共用原始八句英文标语。 |

## 修正记录

1. [P2，已修正] 首次桌面结束页滚动高度 531px，超过 482px 窗口，页脚被挤出。全局 label margin 和 span 样式污染了单选区；重置其 margin、文字样式，并校准组间间距。最终 `desktop-verification.json` 显示 scrollHeight = clientHeight = 482，页脚完整。
2. [P1，已修正] 休息预览继承 focus 背景透明规则，且 410px 高度不足。恢复该页面独立纸张背景，实际高度设为 442px。最终 running / waiting 截图均显示完整纸面和页脚，scrollHeight = clientHeight = 442。
3. 修正后重新构建原生 debug 包，在全新隔离数据目录重走核心流程并重新截图；最终并排比较没有剩余 P0 / P1 / P2 问题。

## 操作验收

- 选择状态不写数据库；返回列表及重新加载后，当前会话状态和三个记录字段恢复。
- 保存未完成后保留步骤待办，保存完成只完成当前步骤，父任务不自动完成；成功清除草稿。
- 下一会话默认未完成；失败重试保留草稿和同一请求 ID（前端测试）。
- 休息返回列表保持计时；结束后无自动新会话。跨页面保持同一启动选择的英文标语。
- 长标题、展开记录、滚动保存已在桌面执行；计时记录和个人输入已出现在隔离数据库及每日 Markdown。
- 原生流程未捕获到 pageerror。117 项前端测试、61 项 Rust 测试通过，另有 1 项性能基准按原配置忽略；typecheck 与 release 构建通过。

## 验收边界

真实桌面验证只使用 `output/final-pages-20260914/paper-test-final`，未操作正式数据。工作概览、工作结束和其他非本次改版页面保留原实现；之前的源码排查见 `output/page-design-review-20260914/页面检查与改版方向.md`，不将它们记作本次逐页视觉验收。

## 完成清单

- [x] 定稿结构和任务上下留白落入真实组件。
- [x] 修正首轮发现的间距冲突、休息透明背景及高度。
- [x] 全新隔离桌面完成返回、草稿、保存、休息和 Markdown 流程。
- [x] 按同宽比例并排核对参考与最终桌面截图。

无待处理的视觉阻断项。
