const express = require("express");
const app = express();
const axios = require("axios");
const os = require('os');
const fs = require("fs");
const path = require("path");
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(require('child_process').exec);

// --- 环境变量配置 ---
const PORT = process.env.PORT || 3000;
const XRAY_PORT = process.env.XRAY_PORT || 8000;
const UUID = process.env.UUID || '9afd1229-b893-40c1-84dd-51e7ce204913';
const ARGO_DOMAIN = process.env.ARGO_DOMAIN || '';
const ARGO_AUTH = process.env.ARGO_AUTH || '';
const CFIP = process.env.CFIP || 'www.visa.com.sg';
const NAME = process.env.NAME || 'VPS';

// --- 🔥 新增：自定义订阅路径 ---
// 如果 docker-compose 里不填，默认还是 'sub'
const SUB_PATH = process.env.SUB_PATH || 'sub';

// --- REALITY 配置 ---
const REALITY_PRIVATE_KEY = process.env.REALITY_PRIVATE_KEY || ''; 
const REALITY_SHORT_ID = process.env.REALITY_SHORT_ID || '';
const REALITY_DEST = process.env.REALITY_DEST || 'www.apple.com:443';
const REALITY_SERVER_NAME = process.env.REALITY_SERVER_NAME || 'www.apple.com';

const FILE_PATH = '/app/bin';
const INTERNAL_ARGO_PORT = 8080;

if (!fs.existsSync(FILE_PATH)) {
  fs.mkdirSync(FILE_PATH, { recursive: true });
}

const xrayPath = path.join(FILE_PATH, 'xray');
const cloudflaredPath = path.join(FILE_PATH, 'cloudflared');
const subPath = path.join(FILE_PATH, 'sub.txt');
const configPath = path.join(FILE_PATH, 'config.json');

let generatedPublicKey = "";

// 根路径提示修改
app.get("/", (req, res) => {
  res.send(`VPS Node Server Running... Access /${SUB_PATH} to get links.`);
});

function getArch() {
  const arch = os.arch();
  if (arch === 'arm64' || arch === 'aarch64') return 'arm64-v8a';
  return '64';
}

function getCloudflaredArch() {
  const arch = os.arch();
  if (arch === 'arm64' || arch === 'aarch64') return 'arm64';
  return 'amd64';
}

async function downloadFile(url, dest) {
  console.log(`Downloading: ${url}`);
  await execAsync(`curl -L -o "${dest}" "${url}"`);
  console.log(`Downloaded to ${dest}`);
}

async function getRealityKeys() {
  if (REALITY_PRIVATE_KEY) {
    return { privateKey: REALITY_PRIVATE_KEY, publicKey: "" }; 
  }
  try {
    const { stdout } = await execAsync(`"${xrayPath}" x25519`);
    const privateMatch = stdout.match(/Private key: (.+)/);
    const publicMatch = stdout.match(/Public key: (.+)/);
    if (privateMatch && publicMatch) {
      return { privateKey: privateMatch[1].trim(), publicKey: publicMatch[1].trim() };
    }
  } catch (e) {}
  return { privateKey: "", publicKey: "" };
}

// --- Xray 配置 ---
async function generateXrayConfig(privateKey) {
  const config = {
    log: { loglevel: "warning" },
    inbounds: [
      // 1. Reality 主入口 (公网 8000)
      {
        port: parseInt(XRAY_PORT),
        listen: "0.0.0.0",
        protocol: "vless",
        settings: {
          clients: [{ id: UUID, flow: "xtls-rprx-vision" }],
          decryption: "none"
        },
        streamSettings: {
          network: "tcp",
          security: "reality",
          realitySettings: {
            show: false,
            dest: REALITY_DEST,
            xver: 0,
            serverNames: [REALITY_SERVER_NAME],
            privateKey: privateKey,
            shortIds: [REALITY_SHORT_ID]
          }
        }
      },
      // 2. Argo 备用入口 (本地 8080)
      {
        port: INTERNAL_ARGO_PORT,
        listen: "127.0.0.1",
        protocol: "vless",
        settings: {
          clients: [{ id: UUID }],
          decryption: "none",
          fallbacks: [
            { path: "/vmess", dest: 8001 },
            { path: "/trojan", dest: 8002 }
          ]
        },
        streamSettings: { network: "tcp", security: "none" },
        sniffing: { enabled: true, destOverride: ["http", "tls"] }
      },
      // 3. VMess 独立入口 (本地 8001)
      {
        port: 8001,
        listen: "127.0.0.1",
        protocol: "vmess",
        settings: { clients: [{ id: UUID, alterId: 0 }] },
        streamSettings: { network: "ws", wsSettings: { path: "/vmess" } },
        sniffing: { enabled: true, destOverride: ["http", "tls"] }
      },
      // 4. Trojan 独立入口 (本地 8002)
      {
        port: 8002,
        listen: "127.0.0.1",
        protocol: "trojan",
        settings: { clients: [{ password: UUID }] },
        streamSettings: { network: "ws", wsSettings: { path: "/trojan" } },
        sniffing: { enabled: true, destOverride: ["http", "tls"] }
      }
    ],
    outbounds: [
      { protocol: "freedom", tag: "direct" },
      { protocol: "blackhole", tag: "block" }
    ]
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

async function getPublicIP() {
  try {
    const response = await axios.get('https://api.ipify.org?format=json', { timeout: 5000 });
    return response.data.ip;
  } catch (e) {
    return "127.0.0.1";
  }
}

async function installAndRun() {
  if (!fs.existsSync(xrayPath)) {
    const arch = getArch();
    const zipPath = path.join(FILE_PATH, 'xray.zip');
    await downloadFile(`https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-${arch}.zip`, zipPath);
    await execAsync(`unzip -o "${zipPath}" -d "${FILE_PATH}"`);
    await execAsync(`chmod +x "${xrayPath}"`);
    fs.unlinkSync(zipPath);
  }
  if (!fs.existsSync(cloudflaredPath)) {
    const cfArch = getCloudflaredArch();
    await downloadFile(`https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${cfArch}`, cloudflaredPath);
    await execAsync(`chmod +x "${cloudflaredPath}"`);
  }

  let privateKey = REALITY_PRIVATE_KEY;
  if (!privateKey) {
    const keys = await getRealityKeys();
    privateKey = keys.privateKey;
    generatedPublicKey = keys.publicKey;
  }

  await generateXrayConfig(privateKey);
  console.log(`Starting Xray...`);
  exec(`nohup "${xrayPath}" -c "${configPath}" > /dev/null 2>&1 &`);

  // --- Cloudflared 启动逻辑 ---
  let argoCmd;
  if (ARGO_AUTH && ARGO_DOMAIN) {
     if (ARGO_AUTH.includes('TunnelSecret')) {
        // 固定隧道：使用 Path 路由
        fs.writeFileSync(path.join(FILE_PATH, 'tunnel.json'), ARGO_AUTH);
        const tunnelYml = `
tunnel: ${JSON.parse(ARGO_AUTH).TunnelID}
credentials-file: ${path.join(FILE_PATH, 'tunnel.json')}
protocol: http2
ingress:
  - hostname: ${ARGO_DOMAIN}
    path: /vmess
    service: http://localhost:8001
  - hostname: ${ARGO_DOMAIN}
    path: /trojan
    service: http://localhost:8002
  - hostname: ${ARGO_DOMAIN}
    service: http://localhost:${INTERNAL_ARGO_PORT}
  - service: http_status:404
`;
        fs.writeFileSync(path.join(FILE_PATH, 'tunnel.yml'), tunnelYml);
        argoCmd = `nohup "${cloudflaredPath}" tunnel --config "${path.join(FILE_PATH, 'tunnel.yml')}" run > /dev/null 2>&1 &`;
     } else {
        argoCmd = `nohup "${cloudflaredPath}" tunnel --no-autoupdate --protocol http2 run --token ${ARGO_AUTH} > /dev/null 2>&1 &`;
     }
  } else {
    argoCmd = `nohup "${cloudflaredPath}" tunnel --no-autoupdate --protocol http2 --url http://localhost:${INTERNAL_ARGO_PORT} --logfile "${path.join(FILE_PATH, 'argo.log')}" > /dev/null 2>&1 &`;
  }
  exec(argoCmd);

  setTimeout(generateSubscription, 10000);
}

// 生成订阅
async function generateSubscription() {
  const publicIP = await getPublicIP();
  let domain = ARGO_DOMAIN;
  if (!domain) {
    try {
        const logContent = fs.readFileSync(path.join(FILE_PATH, 'argo.log'), 'utf8');
        const match = logContent.match(/https?:\/\/([^ ]*trycloudflare\.com)/);
        if (match) domain = match[1];
    } catch (e) {}
  }
  
  const publicKey = process.env.REALITY_PUBLIC_KEY || generatedPublicKey;
  const nodes = [];
  
  if (publicKey) {
    nodes.push(`vless://${UUID}@${publicIP}:${XRAY_PORT}?security=reality&encryption=none&pbk=${publicKey}&fp=chrome&type=tcp&flow=xtls-rprx-vision&sni=${REALITY_SERVER_NAME}&sid=${REALITY_SHORT_ID}#${encodeURIComponent(NAME + "-Reality-Vision")}`);
  }

  if (domain) {
      const vmessArgo = { v: "2", ps: `${NAME}-Argo-VMESS`, add: CFIP, port: "443", id: UUID, aid: "0", scy: "auto", net: "ws", type: "none", host: domain, path: "/vmess", tls: "tls", sni: domain };
      nodes.push(`vmess://${Buffer.from(JSON.stringify(vmessArgo)).toString('base64')}`);
      
      nodes.push(`trojan://${UUID}@${CFIP}:443?security=tls&sni=${domain}&type=ws&host=${domain}&path=%2Ftrojan#${encodeURIComponent(NAME + "-Argo-Trojan")}`);
  }

  fs.writeFileSync(subPath, Buffer.from(nodes.join('\n')).toString('base64'));
  console.log("Subscription generated.");
}

// 🔥 使用动态变量 SUB_PATH
app.get(`/${SUB_PATH}`, (req, res) => {
    if (fs.existsSync(subPath)) res.send(fs.readFileSync(subPath, 'utf8'));
    else res.status(503).send("Initializing...");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}. Subscription path: /${SUB_PATH}`);
  installAndRun();
});
