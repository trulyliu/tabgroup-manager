# Chrome Web Store 发布准备指南 (Store Listing Guide)

本文档整理了发布到 **Chrome 应用商店（Chrome Web Store, CWS）** 所需的所有物料、描述文案以及权限申明，可直接在 CWS 开发者控制台中复制使用。

---

## 1. 基础信息 (Basic Information)

| 项目 | 英文 (Default) | 简体中文 (zh_CN) |
| --- | --- | --- |
| **扩展名称** (≤ 75 字符) | Tab Group Manager | 标签组管理器 |
| **简短描述** (≤ 132 字符) | Keeps tab groups first, one group expanded, and new tabs in the group you are using. | 分组优先、只展开一个分组、新标签页进入当前分组，让标签栏井然有序。 |
| **主要分类** | Productivity (生产力) / Workflow & Planning | 生产力 / 工作流与规划 |
| **默认语言** | English (en) | 支持中文 (zh_CN, zh_TW) |
| **版本号** | `0.4.0` | `0.4.0` |

---

## 2. 详细描述 (Detailed Description)

### English Version (for CWS Description)

```text
Turn your Chrome tab strip into a clean, focused, and structured workspace.

Tab Group Manager automatically organizes your tabs by groups, keeps only one group expanded at a time to reduce visual clutter, routes new tabs into your current working group, and protects your pinned groups from disappearing.

KEY FEATURES

• Groups First: Tab groups always stay organized to the left of loose, ungrouped tabs.
• Single Expanded Group: Focus on what you are doing right now. The active tab's group stays expanded; all other groups collapse automatically.
• Smart New Tab Routing: Ctrl+T, "+", or address bar new tabs automatically join your currently expanded group instead of floating loosely.
• Default Group: Loose ungrouped tabs are gathered into a clean default group ("Other").
• Pinned Group Protection: Never lose an important group again. When its last tab closes, the extension keeps the group alive with a fresh blank page.
• Header Click Actions: Click an expanded group header to open a new tab, collapse to default, or maintain focus.
• Quick Keyboard Shortcut: Press Alt+W anytime to switch straight back to your default group.
• Session Restore Friendly: Works seamlessly with Chrome's "Continue where you left off" startup setting.

PRIVACY FIRST

• 100% Local: No remote servers, no tracking, no Google Analytics, no third-party libraries.
• Zero Network Requests: Contains no host permissions and never communicates over the network.
• Safe: Tab URLs are only inspected in local memory during the instant a new tab opens to determine routing. URLs are never saved, never logged, and never transmitted.

Open-source and lightweight with zero external runtime dependencies.
```

### 简体中文版 (for CWS Description)

```text
把 Chrome 标签栏变成整洁、专注、结构清晰的工作区。

标签组管理器（Tab Group Manager）自动按分组整理标签页，同一时间只展开一个分组以减少视觉干扰，新标签页直接进入当前处理中的分组，并保护重要分组不会被误删清空。

核心特性

• 分组在前：所有分组标签页始终排在未分组标签页之前，钉住分组按自定顺序排在最前。
• 只展开一个分组：让你专注于当前任务。活动标签页所在的分组展开，其他分组自动折叠收起。
• 新标签页智能归组：Ctrl+T、“+”或地址栏新建的标签页自动进入当前展开的工作分组，不再零散堆放。
• 默认分组：未分组的散乱标签页自动归入整洁的默认分组（“其他”）。
• 钉住分组保护：防止重要分组被误删清空。关闭组内最后一个标签页时，自动以空白页保留分组与颜色。
• 标题点击自定义：点击已展开分组标题支持“组内新建标签页”、“收起并回到默认分组”或“保持当前分组”。
• 快速快捷键：随时按下 Alt+W 一键回到默认分组。
• 会话恢复友好：完美兼容 Chrome 原生的“继续浏览上次打开的网页”，启动时不扰乱恢复过程。

隐私优先

• 纯本地运行：无远程服务器、无用户追踪、无第三方分析统计代码。
• 零网络权限：不申请任何 host 权限，绝不发起任何网络请求。
• 安全透明：仅在新标签页创建的瞬间在本地内存判断其类型以归入正确分组，绝不保存、记录或上传任何浏览网址与历史。

完全开源、纯原生轻量实现，无任何第三方运行时依赖。
```

---

## 3. 权限用途说明 (Permission Justifications)

在 Chrome 开发者后台填写「隐私权规范 (Privacy practices)」时使用：

### 单一用途说明 (Single Purpose Description)
> Automatically organize browser tabs into clean, structured tab groups (groups first, single group expanded, and new tab routing).

### 权限理由说明 (Host permissions & API permissions)

| 权限 | 官方问询：为什么需要此权限？ |
| --- | --- |
| `tabs` | Required to detect newly opened tabs (`url` / `pendingUrl`) strictly in local memory to place them into the active tab group, and to switch focus between tabs when groups expand or collapse. URLs are never stored, logged, or sent over the network. |
| `tabGroups` | Required to create, collapse, expand, color, title, and reorder tab groups according to user preferences. |
| `storage` | Required to store user configuration options in `chrome.storage.sync` and keep temporary window state across service worker restarts in `chrome.storage.session`. |

### 数据使用声明 (Data Usage Disclosures)
- **是否收集用户个人数据？** 否 (No)
- **是否出售用户数据？** 否 (No)
- **是否将数据用于与核心功能无关的目的？** 否 (No)
- **是否将数据用于信用或借贷评估？** 否 (No)

---

## 4. 图像素材准备清单 (Store Assets Checklist)

Chrome 应用商店提交时需要以下视觉素材：

1. **扩展图标 (Icon)**
   - 尺寸：`128x128` PNG
   - 现存路径：[`icons/icon128.png`](../icons/icon128.png)（已就绪）

2. **屏幕截图 (Screenshots)**
   - 规格：至少 1 张，至多 5 张。
   - 推荐尺寸：`1280x800` 像素（或 `640x400`），格式 PNG 或 JPEG。
   - 建议截取内容：
     1. 标签栏整齐分组的效果（单分组展开、其他折叠）。
     2. 选项页（展示多语言、布局设置与钉住分组列表）。
     3. 工具栏弹窗操作界面。

3. **宣传促销图 (Promo Tiles，可选)**
   - 小型促销图：`440x280` PNG（展示在商店搜索结果中）。
   - 大型横幅图：`1400x560` PNG（推荐位横幅）。

---

## 5. 打包与提交流程 (Submission Workflow)

1. **打包 ZIP**：
   运行 GitHub Actions Release 工作流，或在本地根目录运行：
   ```bash
   zip -r tabgroup-manager-0.4.0.zip manifest.json src _locales icons README.md README.en.md CHANGELOG.md
   ```
2. **进入 Chrome Web Store 开发者后台**：
   访问 [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/)。
3. **上传程序包**：
   点击“新项目”，上传生成的 `.zip` 包。
4. **填写商品详情与隐私权规范**：
   对照本文档第 1、2、3 部分将文字粘贴至对应输入框，并上传截图。
5. **提交审核**：
   点击“提交审核”即可（通常在 24–48 小时内完成审核）。
