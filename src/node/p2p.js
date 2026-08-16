import { WebSocketServer, WebSocket } from 'ws';
import crypto from 'crypto';
import https from 'https';
import http from 'http';
import tls from 'tls';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const RECONNECT_MS = 5000;
const HANDSHAKE_TIMEOUT_MS = 10000;
const MAX_MSG_BYTES = 1024 * 1024;
const RATE_WINDOW_MS = 1000;
const RATE_MAX_MSGS = 20;

const NETWORK_SECRET = process.env.P2P_SECRET || 'lvair-mainnet-l1-gossip-secret-2026';

function hmacChallenge(secret, nonce) {
  return crypto.createHmac('sha256', secret).update(nonce).digest('hex');
}

function ensureSelfSignedCert(dataDir) {
  const envCert = process.env.P2P_TLS_CERT;
  const envKey = process.env.P2P_TLS_KEY;
  if (envCert && envKey) {
    try {
      return { cert: fs.readFileSync(envCert), key: fs.readFileSync(envKey) };
    } catch (e) { /* fall through to self-signed */ }
  }

  const certDir = path.join(dataDir, 'tls');
  const certFile = path.join(certDir, 'p2p-cert.pem');
  const keyFile = path.join(certDir, 'p2p-key.pem');

  if (fs.existsSync(certFile) && fs.existsSync(keyFile)) {
    return { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) };
  }

  try {
    fs.mkdirSync(certDir, { recursive: true });
    execSync(
      `openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 ` +
      `-nodes -keyout "${keyFile}" -out "${certFile}" ` +
      `-days 365 -subj "/CN=lvair-p2p-node/O=LVAIR Protocol"`,
      { stdio: 'pipe' }
    );
    return { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) };
  } catch (e) {
    return null;
  }
}

export class P2PNetwork {
  constructor({ p2pPort, advertisedUrl = '', seedNodes = [], onTx, onBlock, onChainReceived, getChain, dataDir = './data', log = () => {} }) {
    this.p2pPort = p2pPort;
    this.advertisedUrl = advertisedUrl;
    this.seedNodes = seedNodes;
    this.onTx = onTx;
    this.onBlock = onBlock;
    this.onChainReceived = onChainReceived;
    this.getChain = getChain;
    this.log = log;
    this.dataDir = dataDir;

    this.sockets = new Set();
    this.known = new Set();
    this.outbound = new Map();
    this.nodeConnections = new Map();
    this.wsNodeUrl = new Map();
  }

  async start() {
    const tlsCerts = ensureSelfSignedCert(this.dataDir);
    const protocol = tlsCerts ? 'wss' : 'ws';

    if (tlsCerts) {
      const httpsServer = https.createServer({ cert: tlsCerts.cert, key: tlsCerts.key });
      this.server = new WebSocketServer({ server: httpsServer });
      httpsServer.listen(this.p2pPort);
    } else {
      this.server = new WebSocketServer({ port: this.p2pPort });
    }

    this.server.on('connection', ws => this._attach(ws, true));

    for (const seed of this.seedNodes) {
      this._learn(seed);
    }

    this.discoveryTimer = setInterval(() => this._requestPeers(), 30000);
    this.log('P2P', `Gossip server listening on ${protocol}://0.0.0.0:${this.p2pPort}` + (tlsCerts ? ' [TLS enabled]' : ' [plaintext]'));
  }

  stop() {
    if (this.discoveryTimer) clearInterval(this.discoveryTimer);
    if (this.server) this.server.close();
    for (const ws of this.sockets) ws.close();
    for (const ws of this.outbound.values()) ws.close();
  }

  tipHash() {
    const chain = this.getChain();
    const tip = chain[chain.length - 1];
    return tip ? tip.hash : '';
  }

  _send(ws, obj) {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify(obj)); } catch (e) { /* ws may have closed */ }
    }
  }

  _attach(ws, isInbound) {
    const nonce = crypto.randomBytes(16).toString('hex');
    ws._p2pAuth = { authenticated: false, nonce, ts: Date.now() };
    ws._p2pRate = { window: Date.now(), count: 0 };

    this._send(ws, { type: 'challenge', nonce });

    const timer = setTimeout(() => {
      if (!ws._p2pAuth.authenticated) {
        this.log('P2P', 'Handshake timeout — closing unauthenticated peer');
        ws.close();
      }
    }, HANDSHAKE_TIMEOUT_MS);

    ws._p2pAuthTimer = timer;

    ws.on('message', raw => {
      if (raw.length > MAX_MSG_BYTES) {
        this.log('P2P', 'Message too large (' + raw.length + ' bytes) — closing');
        ws.close();
        return;
      }

      const now = Date.now();
      const rate = ws._p2pRate;
      if (now - rate.window > RATE_WINDOW_MS) {
        rate.window = now;
        rate.count = 0;
      }
      rate.count++;
      if (rate.count > RATE_MAX_MSGS) {
        this.log('P2P', 'Rate limit exceeded — closing peer');
        ws.close();
        return;
      }

      this._onMessage(ws, raw);
    });

    ws.on('close', () => {
      if (ws._p2pAuthTimer) clearTimeout(ws._p2pAuthTimer);
      const url = this.wsNodeUrl.get(ws);
      if (url && this.nodeConnections.get(url) === ws) this.nodeConnections.delete(url);
      this.wsNodeUrl.delete(ws);
      this.sockets.delete(ws);
      const outboundEntry = Array.from(this.outbound.entries()).find(([, w]) => w === ws);
      if (outboundEntry) this.outbound.delete(outboundEntry[0]);
      if (url && this.known.has(url) && !this.nodeConnections.has(url)) {
        setTimeout(() => this._connectTo(url), RECONNECT_MS);
      }
    });
  }

  _onMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }

    if (!ws._p2pAuth.authenticated) {
      if (msg.type === 'challenge_response') {
        const expected = hmacChallenge(NETWORK_SECRET, ws._p2pAuth.nonce);
        if (msg.answer === expected) {
          ws._p2pAuth.authenticated = true;
          if (ws._p2pAuthTimer) clearTimeout(ws._p2pAuthTimer);
          this.log('P2P', 'Peer authenticated');
          this.sockets.add(ws);
          this._send(ws, {
            type: 'hello',
            network: 'LVAIR Mainnet L1',
            height: this.getChain().length,
            latestHash: this.tipHash(),
            node: this.advertisedUrl
          });
          this._send(ws, { type: 'peers', list: Array.from(this.known) });
        } else {
          this.log('P2P', 'Authentication failed — closing');
          ws.close();
        }
      } else {
        this.log('P2P', 'Expected challenge_response, got ' + msg.type + ' — closing');
        ws.close();
      }
      return;
    }

    this.log('P2P', 'Received message type: ' + msg.type);

    switch (msg.type) {
      case 'hello': {
        const myHeight = this.getChain().length;
        const myTip = this.tipHash();
        if (msg.node && msg.node !== this.advertisedUrl) {
          const existing = this.nodeConnections.get(msg.node);
          if (existing && existing !== ws && existing.readyState === WebSocket.OPEN) {
            if (this.outbound.get(msg.node) === ws) this.outbound.delete(msg.node);
            ws.close();
            return;
          }
          this.nodeConnections.set(msg.node, ws);
          this.wsNodeUrl.set(ws, msg.node);
        }
        if (msg.height > myHeight || (msg.height === myHeight && msg.latestHash && msg.latestHash !== myTip)) {
          this._send(ws, { type: 'getchain' });
        } else if (msg.height < myHeight && msg.height > 0) {
          this._send(ws, { type: 'chain', blocks: this.getChain() });
        }
        if (msg.node) this._learn(msg.node);
        this._send(ws, { type: 'peers', list: Array.from(this.known) });
        break;
      }
      case 'peers': {
        (msg.list || []).forEach(url => this._learn(url));
        break;
      }
      case 'tx': {
        if (msg.tx && this.onTx) this.onTx(msg.tx);
        break;
      }
      case 'block': {
        if (msg.block && this.onBlock) this.onBlock(msg.block);
        break;
      }
      case 'getchain': {
        this._send(ws, { type: 'chain', blocks: this.getChain() });
        break;
      }
      case 'chain': {
        if (Array.isArray(msg.blocks) && this.onChainReceived) this.onChainReceived(msg.blocks);
        break;
      }
      default:
        break;
    }
  }

  _requestPeers() {
    for (const ws of this.sockets) {
      this._send(ws, { type: 'peers', list: Array.from(this.known) });
    }
  }

  _learn(url) {
    if (!url || typeof url !== 'string') return;
    if (this.advertisedUrl && url === this.advertisedUrl) return;
    this.known.add(url);
    if (!this.outbound.has(url)) this._connectTo(url);
  }

  _connectTo(url) {
    if (this.outbound.has(url)) return;
    let ws;
    try {
      const isTls = url.startsWith('wss://');
      const wsOpts = isTls ? { rejectUnauthorized: false } : {};
      ws = new WebSocket(url, wsOpts);
    } catch (e) {
      return;
    }
    this.outbound.set(url, ws);
    ws.on('open', () => {
      this.log('P2P', 'Connected to peer ' + url + ' — awaiting challenge');
      ws._p2pAuth = { authenticated: false };
      ws._p2pRate = { window: Date.now(), count: 0 };

      ws.on('message', raw => {
        if (raw.length > MAX_MSG_BYTES) { ws.close(); return; }

        const now = Date.now();
        const rate = ws._p2pRate;
        if (now - rate.window > RATE_WINDOW_MS) { rate.window = now; rate.count = 0; }
        rate.count++;
        if (rate.count > RATE_MAX_MSGS) { ws.close(); return; }

        let msg;
        try { msg = JSON.parse(raw); } catch (e) { return; }

        if (!ws._p2pAuth.authenticated) {
          if (msg.type === 'challenge') {
            const answer = hmacChallenge(NETWORK_SECRET, msg.nonce);
            ws._p2pAuth.authenticated = true;
            ws.send(JSON.stringify({ type: 'challenge_response', answer }));
          }
          return;
        }

        this._onMessage(ws, raw);
      });

      ws.on('close', () => {
        this.outbound.delete(url);
        if (this.known.has(url) && !this.nodeConnections.has(url)) {
          setTimeout(() => this._connectTo(url), RECONNECT_MS);
        }
      });

      ws.on('error', () => ws.close());
    });
    ws.on('error', () => ws.close());
    ws.on('close', () => {
      this.outbound.delete(url);
      if (this.known.has(url) && !this.nodeConnections.has(url)) {
        setTimeout(() => this._connectTo(url), RECONNECT_MS);
      }
    });
  }

  broadcast(obj) {
    for (const ws of this.sockets) this._send(ws, obj);
  }

  broadcastTx(tx) {
    this.broadcast({ type: 'tx', tx });
  }

  broadcastBlock(block) {
    this.broadcast({ type: 'block', block });
  }

  requestChainFrom(url) {
    if (this.outbound.has(url)) {
      this._send(this.outbound.get(url), { type: 'getchain' });
    }
  }

  getPeerUrls() {
    return Array.from(this.known);
  }

  getStatus() {
    return {
      connected: this.sockets.size,
      known: Array.from(this.known),
      seeds: this.seedNodes,
      advertised: this.advertisedUrl
    };
  }
}
