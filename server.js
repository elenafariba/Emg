const http = require('http');
const WebSocket = require('ws');
const net = require('net');

const port = process.env.PORT || 3000;

// UUID ثابت (می‌توانید تغییر دهید)
const MY_UUID = process.env.UUID || 'd342d11e-d424-4583-b36e-524ab1f0afa4';

// تشخیص خودکار دامنه در GitHub Codespaces
function getCodespaceHost() {
    const codespaceName = process.env.CODESPACE_NAME;
    const domain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || 'app.github.dev';
    if (codespaceName) {
        return `${codespaceName}-${port}.${domain}`;
    }
    return null;
}

// ساخت سرور HTTP با استتار
const server = http.createServer((req, res) => {
    const host = req.headers.host || getCodespaceHost() || 'localhost';
    
    // مسیر /config برای دریافت لینک از مرورگر (اختیاری)
    if (req.url === '/config') {
        const vlessLink = `vless://${MY_UUID}@${host}:443?encryption=none&security=tls&sni=${host}&fp=chrome&type=ws&host=${host}&path=%2F#GitHub-Codespace`;
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(vlessLink);
        return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ status: "ok", message: "Service running." }));
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
    const codespaceHost = getCodespaceHost();
    console.log('\n=============================================================');
    if (codespaceHost) {
        const vlessLink = `vless://${MY_UUID}@${codespaceHost}:443?encryption=none&security=tls&sni=${codespaceHost}&fp=chrome&type=ws&host=${codespaceHost}&path=%2F#GitHub-Codespace`;
        console.log('✅ سرور با موفقیت در GitHub Codespaces اجرا شد!');
        console.log('📋 لینک کانفیگ شما (همین را کپی کنید):\n');
        console.log(vlessLink);
    } else {
        console.log(`✅ سرور روی پورت ${port} اجرا شد (محیط محلی یا غیر کُداسپیس).`);
    }
    console.log('=============================================================\n');
});
