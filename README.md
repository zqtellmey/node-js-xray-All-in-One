# 🚀 VPS Xray Argo All-in-One (Reality 终极版)

这是一个专为 **VPS 环境** 打造的高性能、全能代理部署方案。

本项目基于 Node.js 编排，完美融合了 **Xray (Reality)** 与 **Cloudflare Argo Tunnel**。它是原项目的纯净重构版，**移除了哪吒监控和文件伪装**，核心组件全部**实时从官方源下载**，确保绝对的安全与纯净。

---

## ✨ 项目亮点

*   **🔒 官方纯净**: 核心程序直接从 GitHub 官方 Releases (`XTLS/Xray-core` & `cloudflare/cloudflared`) 拉取，无任何第三方修改，无后门风险。
*   **⚡ Reality 协议**: 默认启用 **VLESS-Vision-REALITY**。这是目前最先进的直连协议，无需域名、无需证书，模拟大厂网站（如 Apple/Microsoft），速度极快且抗封锁。
*   **☁️ Argo 隧道分流**: 采用 **Cloudflare Ingress 路由** 技术，将 VMess 和 Trojan 流量物理隔离，彻底解决传统回落机制导致的连接不稳定问题。
*   **📦 自动订阅**: 内置 HTTP 服务，自动生成包含 3 个节点（1个直连 + 2个隧道）的 Base64 订阅链接。
*   **🐳 Docker 一键**: 提供标准 Docker Compose 配置，部署极其简单。

---

## 🛠️ 节点列表

部署成功后，订阅中将包含以下类型的节点：

1.  **🚀 Reality-Vision** (VLESS + TCP + XTLS-Vision + REALITY):
    *   **主力节点**。走 VPS 直连线路，速度最快，延迟最低。
2.  **☁️ Argo-VMess** (WS + TLS):
    *   **救急节点**。流量经过 Cloudflare 隧道中转，隐藏 VPS 真实 IP，适合晚高峰或 IP 被墙时使用。
3.  **☁️ Argo-Trojan** (WS + TLS):
    *   **救急节点**。同上，提供多一种协议选择。

---

## 📋 部署指南

### 第一步：生成 REALITY 密钥 (必须)

REALITY 协议需要一对 x25519 密钥。你不需要在本地安装 Xray，直接在 VPS 上运行以下 Docker 命令即可生成：

```bash
docker run --rm ghcr.io/xtls/xray-core:latest x25519
```

**请记下输出结果**（稍后填入配置文件）：
*   `Private key`: 私钥（填入 `REALITY_PRIVATE_KEY`）
*   `Public key`: 公钥（填入 `REALITY_PUBLIC_KEY`）

---

### 第二步：配置 Cloudflare Tunnel (关键)

为了保证 VMess 节点的稳定性，我们需要在 Cloudflare Zero Trust 后台配置**固定隧道**并设置**分流规则**。

1.  登录 [Cloudflare Zero Trust](https://one.dash.cloudflare.com/) -> **Networks** -> **Tunnels**。
2.  创建一个新 Tunnel，保存生成的 **Token** (以 `ey` 开头)。
3.  点击 **Configure** -> **Public Hostname**，添加以下 **3 条规则** (假设你的域名是 `vps.example.com`)：

| 子域 | 域名 | 路径 | 服务 类型 | 服务 URL | 说明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `vps-xray-argo` | `example.com` | **vmess** | HTTP | `localhost:8001` | **VMess 专用通道** |
| `vps-xray-argo` | `example.com` | **trojan** | HTTP | `localhost:8002` | **Trojan 专用通道** |
| `vps-xray-argo` | `example.com` | *(留空)* | HTTP | `localhost:8080` | **默认兜底** |

> **注意**：这一步非常重要！不配置 Path 分流会导致 VMess 节点无法连接。

---

### 第三步：创建与启动容器

在 VPS 上创建一个目录（例如 `proxy`），并创建 `docker-compose.yml` 文件。

```bash
mkdir -p proxy && cd proxy
vim docker-compose.yml
```

将以下内容粘贴进去（**请务必修改 UUID、密钥和 Token**）：

```yaml
version: '3.8'

services:
  vps-proxy:
    image: ghcr.io/yessanjin/vps-xray-argo:latest
    container_name: vps-xray-argo
    restart: unless-stopped
    # 端口映射：只暴露订阅端口(3000)和直连端口(8000)
    ports:
      - "3000:3000"
      - "8000:8000"
    
    environment:
      # --- 🔑 核心鉴权 (必改) ---
      - UUID=9afd1229-b893-40c1-84dd-51e7ce204913   # ⚠️ 修改这里！你的连接密码

      # --- 🔥 安全订阅路径 (必填) ---
      # 设置后，访问地址变为: http://ip:3000/my-secret-token-123
      - SUB_PATH=my-secret-token-123
      
      # --- 💎 REALITY 配置 (必填 - 见第一步) ---
      - REALITY_PRIVATE_KEY=xxxxxxxxxxxxxxxxxxxxxx  # ⚠️ 填入刚才生成的 Private Key
      - REALITY_PUBLIC_KEY=xxxxxxxxxxxxxxxxxxxxxxx  # ⚠️ 填入刚才生成的 Public Key
      - REALITY_DEST=www.apple.com:443              # 伪装的目标网站 (必须支持 TLS1.3)
      - REALITY_SERVER_NAME=www.apple.com           # 同上
      - REALITY_SHORT_ID=1a                         # 简短ID，可填 1a, 1b 等，或留空
      
      # --- ☁️ Argo 固定隧道配置 (必填 - 见第二步) ---
      - ARGO_AUTH=eyJhIjoi...                       # ⚠️ 填入 Cloudflare Tunnel Token
      - ARGO_DOMAIN=vps.example.com                 # ⚠️ 填入你在 CF 后台设置的域名
      
      # --- ⚙️ 基础配置 ---
      - PORT=3000             # 订阅服务端口
      - XRAY_PORT=8000        # Reality 直连监听端口
      - NAME=韩国-甲骨文       # 节点名称前缀
      - CFIP=www.visa.com.sg  # Argo 节点的优选域名 (用于客户端连接)
```

启动容器：

```bash
docker-compose up -d
```

---

### 第四步：🔒 安全增强：自定义订阅路径

1.  确保 VPS 的防火墙已放行 **3000** (订阅) 和 **8000** (Reality) 端口。
2.  访问浏览器：`http://<你的VPS_IP>:3000/sub`
为了防止他人扫描 `http://IP:3000/sub` 获取你的节点信息，本项目支持自定义订阅路径。

在 `docker-compose.yml` 中添加或修改 `SUB_PATH` 变量：

```yaml
environment:
  - SUB_PATH=my-super-secret-path-888
```

4.  将页面显示的 Base64 内容复制到代理软件（V2RayN, Shadowrocket, NekoBox 等）。

---

## ⚙️ 端口与架构说明

为了实现极致的稳定性和兼容性，本项目在容器内部使用了以下端口规划：

*   **`8000` (暴露到公网)**: **Reality 直连专用**。只处理 TLS 流量，直接响应客户端请求。
*   **`8001` (仅限内部)**: **VMess 接收端口**。Cloudflare 隧道收到 `/vmess` 请求后直达此处。
*   **`8002` (仅限内部)**: **Trojan 接收端口**。Cloudflare 隧道收到 `/trojan` 请求后直达此处。
*   **`8080` (仅限内部)**: **默认路由端口**。处理其他所有未匹配的隧道流量。

---

## 📝 常见问题 (FAQ)

### **Q: 为什么我必须在 Cloudflare 后台配置 Path？**
A: 为了稳定性。VMess 协议在没有 TLS 的情况下很难被精准识别。通过在 Cloudflare 后台将 `/vmess` 路径直接指向 `8001` 端口，我们实现了物理级别的流量隔离，保证 VMess 节点 100% 可用。

### **Q: 我能用临时隧道吗（不填 ARGO_AUTH）？**
A: **不推荐**。临时隧道无法配置 Path 分流，会导致 VMess 节点极不稳定（经常断连）。既然你有 VPS，强烈建议配置免费的固定隧道。

### **Q: Reality 节点连不上？**
A: 请检查：
1. VPS 防火墙是否放行了 8000 端口 (TCP)。
2. 客户端版本是否支持 Reality (推荐 V2rayN 6.0+, Shadowrocket 最新版)。
3. `REALITY_PRIVATE_KEY` 和 `REALITY_PUBLIC_KEY` 是否匹配。


### **Q: 为什么一定是生成 x25519 密钥？不能是 x25520 密钥？**
A：这是一个非常有趣且直击核心的问题！
简单直接的回答是：**因为“25519”不是一个软件版本号（比如 v19 vs v20），它是一个特定的数学常数（素数）。**

在密码学中，**X25519** 指的是基于 **Curve25519** 这条椭圆曲线进行的密钥交换算法。

以下是详细的通俗解释：

##### 1. 名字的由来：它是一个具体的数字
这个名字来源于这条曲线所依赖的 **素数（Prime Number）** 公式：

$$ 2^{255} - 19 $$

*   **2的255次方**：一个巨大的数字。
*   **减去 19**：这是为了让这个数字变成一个素数，并且为了在计算机上计算时非常快。

如果你把它改成 `25520`（即 $2^{255} - 20$），计算结果就**不是素数**了，整个加密数学基础就会崩塌，无法用于构建安全的椭圆曲线加密。

##### 2. 为什么不能是 X25520？
就像圆周率 $\pi$ 是 `3.14159...` 而不能是 `3.15` 一样，**25519** 是由该算法的发明者（著名密码学家 Daniel J. Bernstein）经过精密计算选定的。

*   **X25520 不存在**：密码学界没有定义这条曲线。
*   **其他曲线存在**：确实有其他曲线，比如 NIST P-256、P-384 或 secp256k1（比特币用的），但它们都有各自的名字，不叫 X25520。

##### 3. 为什么 Xray/REALITY 一定要用它？
这不仅仅是因为它名字好听，而是出于两个硬性原因：

1.  **模拟 TLS 1.3 (伪装的核心)**
    REALITY 协议的核心目的是**把流量伪装成正常的 HTTPS 访问**（即 TLS 1.3 流量）。
    目前互联网上绝大多数的 TLS 1.3 握手（比如你访问 Google、Apple 时），优先使用的密钥交换算法就是 **X25519**。
    *   为了伪装得像，Xray 必须使用和浏览器完全一样的算法。
    *   如果 Xray 自己发明一个“X25520”，GFW（防火墙）一眼就能看出：“嘿，正常的浏览器从来不用这个算法，你肯定是代理！”，然后直接封锁。

2.  **速度与安全**
    *   **速度快**：X25519 的设计初衷就是为了在任何 CPU 上都能极速运行（比传统的 RSA 快得多），这对于手机等移动设备非常重要。
    *   **更安全**：它避免了许多传统曲线（如 NIST P-256）可能存在的侧信道攻击风险。

##### 总结
*   **25519** 是根据数学公式 $2^{255}-19$ 算出来的，改动一个数字，数学就不成立了。
*   **REALITY** 必须使用它，是为了**完美模仿**主流浏览器的行为，防止被防火墙识别。

所以，请放心使用 `xray x25519` 生成的密钥，这是目前世界上最流行、最安全的标准之一。



---

感谢原代码作者：https://github.com/yessanjin/vps-xray-argo

## ⚠️ 免责声明

本项目仅供技术研究和学习使用。请遵守当地法律法规，严禁用于任何非法用途。开发者不对使用本项目产生的任何后果负责。
