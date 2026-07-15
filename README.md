# IP Geolocation Extension for Chrome

[![CI](https://github.com/decli/IP_Geolocation_Extension_Chrome/actions/workflows/ci.yml/badge.svg)](https://github.com/decli/IP_Geolocation_Extension_Chrome/actions/workflows/ci.yml)
[![CodeQL](https://github.com/decli/IP_Geolocation_Extension_Chrome/actions/workflows/codeql-analysis.yml/badge.svg)](https://github.com/decli/IP_Geolocation_Extension_Chrome/actions/workflows/codeql-analysis.yml)
[![Release](https://img.shields.io/github/v/release/decli/IP_Geolocation_Extension_Chrome)](https://github.com/decli/IP_Geolocation_Extension_Chrome/releases)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)

一个用于 Chrome/Chromium 的公网 IPv4、IPv6 与 IP 地理位置监控扩展。工具栏图标会显示当前出口国家代码；代理、VPN 或公网 IP 发生变化时，可立即看到状态变化并收到通知。

## 功能

- 工具栏直接显示出口国家代码和国旗。
- 同时检测 IPv4 与 IPv6，Auto 模式优先显示 IPv4，失败时使用 IPv6。
- 保留原有约 3.55 秒检测频率与 IP 变化通知。
- 真正查询失败时立即显示 `ERR`，不会用旧缓存掩盖断网或代理故障。
- 防止请求重叠与异步竞态，旧请求不能覆盖新一轮结果。
- 海外接口不可达时使用大陆可访问的备用接口，支持 Clash DIRECT 场景。
- Manifest V3，仅申请通知、存储、定时器和必要 API 域名权限。

## 安装

### 从 Release 安装（推荐）

1. 打开 [Releases](https://github.com/decli/IP_Geolocation_Extension_Chrome/releases) 下载最新 ZIP。
2. 解压 ZIP。
3. 打开 `chrome://extensions`。
4. 启用右上角“开发者模式”。
5. 点击“加载已解压的扩展程序”，选择解压后的目录。

Release 同时提供签名的 CRX。部分 Chrome 正式版会限制从 Chrome Web Store 之外直接安装 CRX；遇到限制时请使用上述“加载已解压”方式。CRX 更适合 Chromium、企业策略部署或需要固定扩展 ID 的场景。

### 从源码安装

```bash
bash build.sh dev chrome
```

然后在 `chrome://extensions` 中加载项目里的 `dev/` 目录。

## 状态语义

| 模式 | IPv4 | IPv6 | 工具栏状态 |
|---|---|---|---|
| Auto | 成功 | 任意 | IPv4 国家代码 |
| Auto | 失败 | 成功 | IPv6 国家代码 |
| Auto | 失败 | 失败 | `ERR` |
| IPv4 | 失败 | 任意 | `ERR` |
| IPv6 | 任意 | 失败 | `ERR` |

扩展不使用“上次成功国家”替代失败结果，因此 `ERR` 始终表示本轮无法获得所选地址族的有效结果。

## 网络服务与隐私

扩展必须通过外部服务观察公网出口 IP。查询链如下：

| 用途 | 首选服务 | 大陆备用服务 |
|---|---|---|
| IPv4 出口地址 | [ipify](https://www.ipify.org/) | [IPIP](https://www.ipip.net/) |
| IPv6 出口地址 | [ipify IPv6](https://www.ipify.org/) | — |
| IP 地理位置 | [Country.is](https://country.is/) | 淘宝 IP 库 |

这些服务会看到查询对应的公网 IP；扩展自身不建立账户、不上传浏览历史，也不维护远程服务器。不同域名在 Clash Rule 模式下可能走不同规则，备用链用于避免 DIRECT 状态被海外 API 可用性误判为断网。

## 开发与构建

```bash
npm test
npm run check
bash build.sh package chrome
```

ZIP 会生成到 `build/chrome.zip`。详细说明见 [docs/BUILDING.md](docs/BUILDING.md)，运行机制见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 项目结构

```text
background.js                 Service worker 入口
js/main.js                    调度、状态提交、通知
js/models/GeoLocation.js      IP/Geo 服务与回退链
js/utils/RefreshPolicy.js     IPv4/IPv6 选择策略
tests/                        Node.js 自动测试
.github/workflows/            CI、CodeQL 与 Release 构建
```

## 致谢原项目

本项目基于 **Aykut Çevik** 创建的开源项目 [AykutCevik/Geolocate-IP-Browser-Extension](https://github.com/AykutCevik/Geolocate-IP-Browser-Extension) 修改和维护。感谢原作者长期提供 Chrome、Firefox、Opera 与 Edge 版本，以及完整的界面、图标和基础实现。

本仓库是独立维护的衍生项目，并非原作者发布的官方版本。原项目及本衍生版本均遵循 GNU General Public License v3.0。

## 贡献

提交代码前请运行测试和语法检查。贡献约定见 [CONTRIBUTING.md](CONTRIBUTING.md)。版本变化统一记录在 GitHub Release 页面。

## 许可证

[GNU General Public License v3.0](LICENSE)
