const http = require('http');
const WebSocket = require('ws');
const net = require('net');

const port = process.env.PORT || 3000;
const MY_UUID = process.env.UUID || 'd342d11e-d424-4583-b36e-524ab1f0afa4';

// تابع هوشمند برای پیدا کردن آدرس واقعی بدون گیر کردن روی localhost
function getCodespaceHost(req) {
    // 1. بررسی هدر اختصاصی گیت‌هاب پروکسی (دقیق‌ترین روش)
    if (req && req.headers && req.headers['x-forwarded-host']) {
        const fHost = req.headers['x-forwarded-host'];
        if (!fHost.includes('localhost') && !fHost.includes('127.0.0.1')) {
            return fHost;
        }
    }
    // 2. بررسی هدر معمولی
    if (req && req.headers && req.headers.host) {
        const h = req.headers.host;
        if (!h.includes('localhost') && !h.includes('127.0.0.1')) {
            return h;
        }
    }
    // 3. استفاده از متغیرهای محیطی سیستم
    const codespaceName = process.env.CODESPACE_NAME;
    const domain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || 'app.github.dev';
    if (codespaceName) {
        return `${codespaceName}-${port}.${domain}`;
    }
    return null;
}

const server = http.createServer((req, res) => {
    // گرفتن آدرس واقعی
    const host = getCodespaceHost(req) || 'localhost';
    
    // ساخت لینک کانفیگ
    const vlessLink = `vless://${MY_UUID}@${host}:443?encryption=none&security=tls&sni=${host}&fp=chrome&type=ws&host=${host}&path=%2F#GitHub-Codespace`;

    if (req.url === '/config') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(vlessLink);
        return;
    }

    // ظاهر زیبای مخصوص موبایل
    const html = `
    <!DOCTYPE html>
    <html lang="fa" dir="rtl">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>VLESS Config</title>
        <style>
            body { font-family: system-ui, -apple-system, sans-serif; background: #0d1117; color: #c9d1d9; text-align: center; padding: 20px; display: flex; align-items: center; justify-content: center; min-height: 90vh; margin: 0; }
            .card { background: #161b22; padding: 24px; border-radius: 12px; border: 1px solid #30363d; width: 100%; max-width: 400px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); }
            h2 { font-size: 18px; color: #58a6ff; margin-bottom: 5px; }
            .domain-info { font-size: 12px; color: #8b949e; margin-bottom: 15px; direction: ltr; }
            textarea { width: 100%; height: 90px; background: #0d1117; color: #7ee787; border: 1px solid #30363d; border-radius: 8px; padding: 10px; box-sizing: border-box; font-size: 12px; word-break: break-all; resize: none; margin-bottom: 10px; }
            button { background: #238636; color: white; border: none; padding: 14px; border-radius: 8px; cursor: pointer; font-size: 16px; font-weight: bold; width: 100%; transition: 0.2s; }
            button:active { background: #2ea043; transform: scale(0.98); }
        </style>
    </head>
    <body>
        <div class="card">
            <h2>✅ کانفیگ VLESS شما</h2>
            <div class="domain-info">🌐 ${host}</div>
            <textarea id="config" readonly>${vlessLink}</textarea>
            <button onclick="copyConfig()">📋 کپی کردن کانفیگ</button>
        </div>
        <script>
            function copyConfig() {
                const copyText = document.getElementById("config");
                copyText.select();
                copyText.setSelectionRange(0, 99999);
                navigator.clipboard.writeText(copyText.value);
                alert("کانفیگ با موفقیت کپی شد!");
            }
        </script>
    </body>
    </html>
    `;

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
    const protocols = req.headers['sec-websocket-protocol'];
    
    const handleVless = (buffer) => {
        try {
            if (buffer.length < 24) {
                ws.close();
                return;
            }

            const clientUUID = toUUID(buffer.slice(1, 17));
            if (clientUUID !== MY_UUID) {
                ws.close(1011, 'Invalid Request');
                return;
            }

            let i = 19 + buffer[17];
            let targetPort = (buffer[i++] << 8) | buffer[i++];
            let type = buffer[i++];
            let address = "";
            
            if (type === 1) {
                address = buffer.slice(i, i + 4).join(".");
                i += 4;
            } else if (type === 2) {
                let len = buffer[i++];
                address = buffer.slice(i, i + len).toString('utf8');
                i += len;
            } else if (type === 3) {
                ws.close();
                return;
            }

            const targetSocket = net.connect(targetPort, address, () => {
                ws.send(new Uint8Array([buffer[0], 0]));
                if (buffer.length > i) {
                    targetSocket.write(buffer.slice(i));
                }
            });

            targetSocket.on('data', (data) => {
                if (ws.readyState === WebSocket.OPEN) ws.send(data);
            });
            
            ws.on('message', (data) => {
                if (targetSocket && !targetSocket.destroyed) targetSocket.write(data);
            });

            targetSocket.on('error', () => ws.close());
            targetSocket.on('close', () => ws.close());
            ws.on('close', () => targetSocket.destroy());
            ws.on('error', () => targetSocket.destroy());

        } catch (error) {
            ws.close();
        }
    };

    if (protocols) {
        const decoded = Buffer.from(protocols.replace(/-/g, "+").replace(/_/g, "/"), 'base64');
        handleVless(decoded);
    } else {
        ws.once('message', (msg) => {
            handleVless(Buffer.from(msg));
        });
    }
});

function toUUID(bytes) {
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

server.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
