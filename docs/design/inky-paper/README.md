# Inky Paper · Figma 设计稿

> 历史设计记录：以下“当前”“正式”均指对应日期的设计交付。现行 0.5.8 界面以 [项目进度](../../PROJECT_STATUS.md) 与 [实际截图](../../verification/0.5.8/) 为准。此处不作为新的实现要求。

旧 `inky-paper-focus-preview.html` 和 `inky-paper-focus-overview.svg` 含重复内嵌图像，整理时已移出源码。保留对应 PNG、分状态 SVG 和 `build-focus-design.py`；需要研究旧原型时可重新生成，不属于日常运行资源。

## 当前正式交付（163 账号）

### 2026-09-08 · 补齐完整功能页面

[从完整功能导航开始](https://www.figma.com/proto/Uhb9FJXS6MC2bxeFjIdpjs?node-id=30-355&starting-point-node-id=30%3A355)。统一导航包括首次任务、本轮结束、随手记、AI整理和设置，也提供多任务选择、两类AI失败和历史为空的入口。

- [空白、添加、待开始总览](https://www.figma.com/design/Uhb9FJXS6MC2bxeFjIdpjs?node-id=30-2)
- [编辑、休息、历史归档总览](https://www.figma.com/design/Uhb9FJXS6MC2bxeFjIdpjs?node-id=30-92)
- [AI输入、草稿确认、失败恢复总览](https://www.figma.com/design/Uhb9FJXS6MC2bxeFjIdpjs?node-id=30-177)
- [随手记、设置、AI连接总览](https://www.figma.com/design/Uhb9FJXS6MC2bxeFjIdpjs?node-id=30-259)

补充状态包括：任务编辑保存、删除与撤销，多任务选择，休息中，完成归档与重新打开、记录为空，随手记转任务和归档撤销，AI处理中、结果草稿、修改确认、失败重试，基础设置保存、AI连接成功和失败。首次任务保持一件待办的上下文，避免接到原三任务示例；随手记转成的新任务也有对应的专注、暂停与迷你状态。

原型采用固定样例文案。输入字段、设置值和密钥掩码是视觉设计，不支持真实填写或持久化；专注和休息计时为静态，从导航的“本轮结束”入口查看结束后的分支。AI处理中使用一秒后切换结果的演示，不进行网络请求。实际折纸动画和应用实现不在本次修改内。

本轮已检查开始页、任务管理、AI结果、设置等渲染截图；新增状态首轮检查未发现文字越界，最终全文件297条原型连线目标均存在。该数字包含原有页面和总览副本，不等于297项功能。

本地更新截图：`complete-first-task.png`、`complete-ai-flow.png`、`complete-settings-notes.png`、`complete-flow-index.png`。此前各轮验证数量属于历史记录，以本节最终结果为准。

### 2026-09-08 · 纸质感与纸页交互升级

已直接更新当前文件的主界面、专注状态及迷你宠物原型：主窗增加错开的衬纸、细纤维、浅阴影与折角；当前任务增加半透明胶带和便签翘边；输入与进度改用细铅笔线。装饰使用独立矢量图层，保持文字可编辑。

新增[纸页交互总览](https://www.figma.com/design/Uhb9FJXS6MC2bxeFjIdpjs?node-id=11-560)、[页边随手记原型](https://www.figma.com/proto/Uhb9FJXS6MC2bxeFjIdpjs?node-id=11-2&starting-point-node-id=11%3A2)和[完成后收好原型](https://www.figma.com/proto/Uhb9FJXS6MC2bxeFjIdpjs?node-id=11-540&starting-point-node-id=11%3A540)。随手记展开横线纸，点击记下后收成条数标记；完成任务后显示收纳纸条，再回到下一任务。保留运行/暂停与不同任务的对应状态。

这些原型使用示例文案和静态时间，不执行真实输入存储，不包含折纸动画。小鱼沿用原素材并增加页边停靠细节，未生成新的动作素材。本次没有修改应用代码。

验证：37个320px界面及状态副本无文字越界，87条原型连线目标均存在。已查看主界面、专注总览和纸页交互总览的渲染截图。允许胶带在纸张上边缘少量露出，不将装饰的预期外延视为内容溢出。

最新截图：`inky-paper-paper-main.png`、`inky-paper-paper-focus.png`、`inky-paper-paper-interactions.png`。下文30条连线的记录属于本轮修改前的验证结果。

已完成账号切换，并在该账号下建立[新的完整设计文件](https://www.figma.com/design/Uhb9FJXS6MC2bxeFjIdpjs?node-id=2-2)。旧文件保留为历史稿，后续以新文件为工作入口。

- [主界面 320×520](https://www.figma.com/design/Uhb9FJXS6MC2bxeFjIdpjs?node-id=2-8)
- [专注便签总览](https://www.figma.com/design/Uhb9FJXS6MC2bxeFjIdpjs?node-id=3-2)：专注中、暂停、本轮结束和迷你宠物。
- [主界面与专注原型](https://www.figma.com/proto/Uhb9FJXS6MC2bxeFjIdpjs?node-id=4-2&starting-point-node-id=4%3A2)
- [本轮结束与下一步原型](https://www.figma.com/proto/Uhb9FJXS6MC2bxeFjIdpjs?node-id=4-111&starting-point-node-id=4%3A111)

新文件使用可编辑的原生文字、图标、Auto Layout和局部样式，包含34个配色、间距和圆角变量；未建立完整组件库。中文使用 Noto Sans SC，英文品牌使用 Caveat，数字使用 DM Sans。小鱼为独立可替换的栅格图片。

原型已连接暂停/继续、运行/暂停各自的迷你模式、再专注一段、先休息、完成任务和下一任务专注。再专注一段显示25:00；先休息保留当前任务；完成任务后任务数减一、完成数加一，并显示下一任务。原型不自动倒计时；输入、随手记保存、AI、设置和记录仍为视觉控件，没有修改真实应用代码或数据。

验证：已查看新主界面与专注总览的 Figma 渲染截图；容器边界检查无溢出，30条原型连线的目标均存在，字体及34个变量已读回核验。新专注总览截图见 `inky-paper-focus-figma-final.png`。

## 早期版本与本地备份说明

以下记录描述账号切换前的旧文件和本地稿，当前工作入口以上方新文件为准。

日期：2026-09-07。

[打开 Figma 总览](https://www.figma.com/design/ifFUsHKY3epAmxmrKKhTyU?node-id=2-44)

[打开主界面](https://www.figma.com/design/ifFUsHKY3epAmxmrKKhTyU?node-id=2-47)

[查看模式切换原型](https://www.figma.com/proto/ifFUsHKY3epAmxmrKKhTyU?node-id=5-44&starting-point-node-id=5%3A44)

本次保留独立迷你宠物，去除等级、XP、经验条与升级奖励。没有修改应用代码。

交付：320×520 主界面、160×160 迷你宠物模式、设计说明画板、主窗与迷你模式的双向原型连线。原型点击页眉“迷你”进入迷你模式，点击迷你卡返回主窗。其他任务、输入和 AI 控件为静态视觉设计，本次没有模拟真实保存或 AI 执行。

Figma 中的文字、图标、布局、任务行与按钮可编辑；任务行、主按钮和角色为组件实例。小鱼是单独的栅格图片填充，可替换。中文使用 Noto Sans SC（与方案中的现代中文无衬线回退方向一致），英文品牌使用 Caveat。通用 Figma 库已检查，本稿采用方案指定的 Inky Paper 配色与尺寸建立本地样式，未套用 Material 或 iOS 的外观。

验证：已检查主窗、迷你模式与原型副本，所有内容均位于所属容器内；未发现等级/XP 文案；确认组件实例引用和图片填充存在；确认字体家族与34个局部变量的作用范围；主窗与迷你模式连线目标已读回验证。已逐区查看 Figma 渲染截图。未声称已验证桌面窗口拖动、计时、数据库、真实模型调用或所有控件的交互。

## 设计文件

- `inky-paper-figma-overview.png`：Figma 画板截图。
- `inky-paper-main.png`：主界面截图。
- `inky-paper-mascot.png`：手绘角色，暖白背景的设计素材，尚不是透明动画宠物包。
- 同目录 SVG：来自 [Lucide](https://github.com/lucide-icons/lucide/tree/main/icons) 的线性图标。

## 专注便签补充稿

专注页以轻薄纸质便签替代原游戏机外观，保留独立迷你宠物：

- `inky-paper-focus-preview.html`：独立交互演示，可暂停、继续、收起为迷你宠物、返回专注、临时随手记，以及预览本轮结束。
- `inky-paper-focus-overview.png`：已经浏览器渲染并人工检查的整版预览。
- `inky-paper-focus-overview.svg`：整版矢量设计稿，嵌入角色图片，无外部图片依赖。
- `inky-paper-focus-running.svg` / `inky-paper-focus-paused.svg`：320×128 专注中与暂停。
- `inky-paper-focus-done.svg`：320×206 本轮结束，包含再专注一段、完成任务、先休息。
- `inky-paper-focus-mini.svg`：160×160 专注中的迷你宠物。

SVG 可导入 Figma 后继续编辑图形；字体、文本转换及图片导入需在目标文件复核，不自动包含 Auto Layout、组件变量或 Figma 原型连线。中文采用 Noto Sans SC / Microsoft YaHei 回退，数字采用 Arial。长任务标题的落地规则：最多两行并自动增高便签，完整标题提供提示；本稿展示单行标题样例。

专注结束只结束本轮计时，不自动完成任务。暂停后收起到迷你模式仍保持暂停；运行时收起继续计时。演示中的数据只存在当前网页内存中，刷新清空，没有写入真实 Inky 数据。返回主界面使用此前截图作为视觉参考，不模拟真实任务列表更新。

验证：浏览器截图检查通过；暂停时间保持、迷你模式保留暂停状态、返回与继续、随手记、开始新一轮、休息返回、窄屏页面布局以及脚本错误检查均通过。未修改应用代码。

**历史阻塞已解除：补充稿已在新的 Figma 文件中完成。** 旧账号曾触发 Starter 调用上限；切换到163账号后，新账号没有旧文件编辑权限，因此重新建立了本页顶部的完整设计文件。新文件的原生布局和原型已经验证。

## 角色素材说明

使用内置 Image Generation 工具，以项目原角色 `docs/archive/legacy-reference/original-pet.png` 为参考生成，保留小鱼、背鳍、尾鳍和微笑轮廓，移除皇冠并降低彩色面积。最终定稿使用以下编辑提示：

> Edit this asset precisely: retain the exact same graphite fish illustration, pose, contours and subtle grey-blue fin coloring. Replace EVERY grey-white checkerboard background square with a perfectly uniform opaque warm white RGB(250,248,242), hex #FAF8F2. No checkerboard, no transparency simulation, no texture in the background, no shadow. The body remains lightly ivory and graphite. Make the fish smaller with an even 12% margin on all edges. One centered fish, no text. This will sit on a warm paper UI surface.
