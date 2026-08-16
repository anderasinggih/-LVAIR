import { WebSocketServer, WebSocket } from 'ws';

const RECONNECT_MS = 5000;

export class P2PNetwork {
  constructor({ p2pPort, advertisedUrl = '', seedNodes = [], onTx, onBlock, onChainReceived, getChain, log = () => {} }) {
    this.p2pPort = p2pPort;
    this.advertisedUrl = advertisedUrl;
    this.seedNodes = seedNodes;
    this.onTx = onTx;
    this.onBlock = onBlock;
    this.onChainReceived = onChainReceived;
    this.getChain = getChain;
    this.log = log;

    this.sockets = new Set();
    this.known = new Set();
    this.outbound = new Map();
    this.nodeConnections = new Map();
    this.wsNodeUrl = new Map();
  }

  async start() {
    this.server = new WebSocketServer({ port: this.p2pPort });
    this.server.on('connection', ws => this._attach(ws, true));

    for (const seed of this.seedNodes) {
      this._learn(seed);
    }

    this.discoveryTimer = setInterval(() => this._requestPeers(), 30000);
    this.log('P2P', 'Gossip server listening on ws://0.0.0.0:' + this.p2pPort);
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
    this.sockets.add(ws);
    ws.on('message', raw => this._onMessage(ws, raw));
    ws.on('close', () => {
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

    this._send(ws, {
      type: 'hello',
      network: 'LVAIR Mainnet L1',
      height: this.getChain().length,
      latestHash: this.tipHash(),
      node: this.advertisedUrl
    });
    this._send(ws, { type: 'peers', list: Array.from(this.known) });
  }

  _onMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }

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
      ws = new WebSocket(url);
    } catch (e) {
      return;
    }
    this.outbound.set(url, ws);
    ws.on('open', () => {
      this.log('P2P', 'Connected to peer ' + url);
      this._attach(ws, false);
    });
    ws.on('error', () => {
      ws.close();
    });
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
