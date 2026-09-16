# 工具栏国旗与角标排障 / Toolbar troubleshooting

## 先检查设置 / Check settings first

右键扩展图标打开选项，选择 `Auto` 或可用的地址族，保存显示设置。国旗是主图标，国家代码是文字角标，二者独立。

Right-click the extension icon to open options, select `Auto` or an available address family, and save the display preferences. Flags and text badges are independent.

| Show country flags | Show country badge | 成功识别美国时 / Successful US reading |
|---|---|---|
| On | On | 美国国旗 + `US` / US flag + `US` |
| On | Off | 美国国旗 / US flag |
| Off | On | 地球 + `US` / Globe + `US` |
| Off | Off | 只有地球 / Globe only |

没有保存过的两项显示设置默认开启。升级保留原设置，不会强行开启用户已关闭的功能。若 IPv6 不可用却选择了 IPv6，IPv4 表格可以正常显示，但工具栏无法获取所选地址族结果。

Both display settings default to enabled when absent. Upgrades preserve saved choices. Selecting IPv6 on a network without working IPv6 can fail the toolbar lookup even while the IPv4 table is populated.

## 查看弹窗提示 / Read popup feedback

- 两个开关关闭：通过 **Open settings** 开启并保存。
- 后台刷新失败：点击 **Retry**，检查网络和扩展管理页中的错误。
- 表格正常、工具栏暂未更新：两处独立查询；后台等待 IPv4、IPv6 本轮都结束后统一更新，每个完整查询的超时预算为 12 秒。
- 图标更新错误：后台会记录错误并尝试显示 `ERR`；如果浏览器连错误图标也无法绘制，原图标可能仍保留，但定时重试继续进行。

The popup explains disabled indicators, toolbar failures and table lookup failures separately. **Retry** reloads the popup and requests another background refresh. A short delay is possible because the toolbar waits for both address families; each complete lookup has a 12-second timeout budget. Rendering errors are logged and attempt to display `ERR`. If even the error icon cannot be painted, the old icon may remain, but future retries continue.

## 后台诊断 / Background diagnostics

打开 `chrome://extensions`，启用开发者模式，找到本扩展并点击 **Service Worker**，在其 Console 中执行以下代码。不要在普通网页 Console 执行。

Open `chrome://extensions`, enable Developer mode and inspect this extension's **Service Worker**. Run the following in that console, not in a normal webpage console.

```javascript
console.log('Version:', chrome.runtime.getManifest().version);
console.log('Settings:', await chrome.storage.local.get([
  'country_badge_indicator', 'badge_show_flags', 'badge_show_text'
]));
console.log('Badge:', await chrome.action.getBadgeText({}));
console.log('Title:', await chrome.action.getTitle({}));
try {
  console.log('Refresh:', await fetchGeoLocation());
} catch (error) {
  console.error('Refresh failed:', error);
}
```

设置使用 JSON 字符串存储，`"false"` 代表关闭。错误日志包含 `[IP Geolocation]` 前缀。通知发送失败会记为 warning，不会中断国旗更新。图标 API 的异常属于渲染故障，不应据此判断国家识别失败。

Preferences are JSON-encoded strings; `"false"` means disabled. Logs use the `[IP Geolocation]` prefix. Notification failures are warnings and do not interrupt flag updates. An icon API failure is a rendering failure, not evidence of an incorrect country lookup.

## 更新已解压安装 / Update an unpacked installation

将新版 ZIP 解压并覆盖原来加载的目录，保持目录路径不变，再到 `chrome://extensions` 点击本扩展的重新加载按钮。确认版本号后检查上述显示设置。也可以更新源码后运行 `bash build.sh install chrome`，再重新加载固定的 `local-extension/` 目录。

Extract the new ZIP over the same directory Chrome already loads, then click Reload on its extension card. Keep the directory path unchanged, verify the version, and check display preferences. Source installations can run `bash build.sh install chrome` and reload their stable `local-extension/` directory.
