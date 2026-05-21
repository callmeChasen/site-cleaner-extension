# Site Cleaner & Header Modifier

一个简洁的 Chrome 浏览器扩展,合二为一:
**一键清除当前网站的所有本地数据** + **修改/注入/删除请求 Header**。

## 功能

### 站点缓存清理
- 只针对**当前网站**(可在多 Tab 间切换),不影响其他站点
- 可选清理项: Cache / Cookie / LocalStorage / IndexedDB / Service Worker / Cache Storage
- 清理后可选自动刷新

### 请求 Header 修改
- 支持 `set` / `append` / `remove` 三种操作
- URL 过滤(子串匹配),空则匹配全部请求
- 多条规则同时启用,基于 `chrome.declarativeNetRequest` 动态规则
- 规则持久化在 `chrome.storage.local`,浏览器重启仍生效

## 安装

```bash
git clone <repo>
```

1. 打开 `chrome://extensions/`
2. 右上角打开"开发者模式"
3. 点击"加载已解压的扩展程序",选择 `clear_site_cache_extension/` 目录

## 文件结构

```
clear_site_cache_extension/
├── manifest.json     # MV3 配置,声明权限和入口
├── popup.html        # 弹窗 UI(两个 Tab)
├── popup.js          # 缓存清理 + Header 规则逻辑
├── background.js     # Service Worker(目前仅安装钩子)
└── icons/            # 16/48/128 图标
```

## 关键技术点

- **MV3 service worker**: 后台逻辑最小化,核心交互在 popup
- **declarativeNetRequest dynamicRules**: 用 `modifyHeaders` action 实现 set/append/remove
- **storage.local**: 规则持久化,popup 关闭不影响生效
- **自定义下拉**: 替换原生 `<select>`,用 portal 到 `body` + `position: fixed` 解决滚动容器裁剪问题
- **debounced save**: 输入框 `input` 事件 + 250ms 防抖,边输入边保存,避免失焦才保存导致丢失

## 权限说明

| 权限 | 用途 |
|------|------|
| `browsingData` | 清除站点数据 |
| `tabs` / `activeTab` | 读取当前标签页 URL |
| `storage` | 持久化 Header 规则 |
| `declarativeNetRequest` | 注册 Header 修改规则 |
| `host_permissions: <all_urls>` | DNR 规则需匹配任意域 |

不收集任何用户数据,所有逻辑本地执行。

## License

MIT
