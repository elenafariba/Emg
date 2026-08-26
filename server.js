const http = require('http');
const WebSocket = require('ws');
const net = require('net');

const port = process.env.PORT || 3000;
const MY_UUID = process.env.UUID || 'd342d11e-d424-4583-b36e-524ab1f0afa4';

function getCodespaceHost() {
    const codespaceName = process.env.CODESPACE_NAME;
    const domain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || 'app.github.dev';
    if (codespaceName) {
        return `${codespaceName}-${port}.${domain}`;
    }
    return null;
}

const server = http.createServer((req, res) => {
    const host = req.headers.host || getCodespaceHost() || 'localhost';
    const vlessLink = `vless://${MY_UUID}@${host}:443?encryption=none&security=tls&sni=${host}&fp=chrome&type=ws&host=${host}&path=%2F#GitHub-Codespace`;

    // نمایش صفحه وب با دکمه کپی
    if (req.url === '/' || req.url === '/config') {
        const html = `
        <!DOCTYPE html>
        <html lang="fa" dir="rtl">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>VLESS Config</title>
            <style>
                body { font-family: system-ui, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 90vh; margin: 0; background: #121212; color: #fff; padding: 20px; text-align: center; }
                textarea { width: 100%; max-width: 400px; height: 110px; margin: 15px 0; background: #1e1e1e; color: #4caf50; border: 1px solid #333; border-radius: 10px; padding: 10px; font-size: 12px; word-break: break-all; }
                button { background: #007bff; color: white; border: none; padding: 14px 28px; font-size: 16px; font-weight: bold; border-radius: 8px; cursor: pointer; width: 100%; max-width: 420px; }
                button:active { background: #0056b3; }
            </style>
        </head>
        <body>
            <h3>📋 کانفیگ VLESS آماده است</h3>
            <textarea id="cfg" readonly>${vlessLink}</textarea>
            <button onclick="copyCfg()">📋 کپی کردن کانفیگ</button>
            <script>
                function copyCfg() {
                    const text = document.getElementById("cfg");
                    text.select();
                    navigator.clipboard.writeText(text.value);
                    alert("کانفیگ با موفقیت کپی شد!");
                }
            </script>
        </body>
        </html>`;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
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
            if (buffer.length < 24) return ws.close();
            const clientUUID = toUUID(buffer.slice(1, 17));
            if (clientUUID !== MY_UUID) return ws.close(1011, 'Invalid Request');

            let i = 19 + buffer[17];
            let targetPort = (buffer[i++] << 8) | buffer[i++];
            let type = buffer[i++];
            let address = "";
            
            if (type === 1) { address = buffer.slice(i, i + 4).join("."); i += 4; }
            else if (type === 2) { let len = buffer[i++]; address = buffer.slice(i, i + len).toString('utf8'); i += len; }
            else if (type === 3) return ws.close();

            const targetSocket = net.connect(targetPort, address, () => {
                ws.send(new Uint8Array([buffer[0], 0]));
                if (buffer.length > i) targetSocket.write(buffer.slice(i));
            });

            targetSocket.on('data', (data) => { if (ws.readyState === WebSocket.OPEN) ws.send(data); });
            ws.on('message', (data) => { if (targetSocket && !targetSocket.destroyed) targetSocket.write(data); });
            targetSocket.on('error', () => ws.close());
            targetSocket.on('close', () => ws.close());
            ws.on('close', () => targetSocket.destroy());
            ws.on('error', () => targetSocket.destroy());
        } catch (error) { ws.close(); }
    };

    if (protocols) {
        const decoded = Buffer.from(protocols.replace(/-/g, "+").replace(/_/g, "/"), 'base64');
        handleVless(decoded);
    } else {
        ws.once('message', (msg) => handleVless(Buffer.from(msg)));
    }
});

function toUUID(bytes) {
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

server.listen(port);
