const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { URL } = require("url");
const QRCode = require("qrcode");
const { ethers } = require("ethers");

const ROOT = __dirname;
const STATIC_DIR = path.join(ROOT, "static");
const DATA_DIR = path.join(ROOT, "data");
const WALLET_FILE = path.join(DATA_DIR, "wallet.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const STATE_FILE = path.join(DATA_DIR, "radio_state.json");
const BRIDGE_PATH = path.join(ROOT, "bridge.py");
const PORT = Number(process.env.PORT || 7861);
const SEPOLIA_CHAIN_ID = 11155111;
const MESH_PACKET_MAX_BYTES = 180;
const MESH_PACKET_DELAY_MS = 450;
const HANDSHAKE_READY_MS = 15 * 60 * 1000;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

const VAULT_ABI = [
  "function deposit() payable",
  "function withdrawAvailable(uint256 amount)",
  "function commitNote(bytes32 noteId, address recipient, uint256 amount, uint64 expiry)",
  "function cancelExpiredNote(bytes32 noteId)",
  "function redeem((address issuer,address recipient,uint256 amount,bytes32 noteId,uint64 expiry,address contractAddress,uint256 chainId) note, bytes signature)",
  "function availableBalance(address issuer) view returns (uint256)",
  "function reservedBalance(address issuer) view returns (uint256)",
  "function commitments(bytes32 noteId) view returns (address issuer, address recipient, uint256 amount, uint64 expiry, bool spent, bool canceled)"
];

const NOTE_TYPES = {
  Note: [
    { name: "issuer", type: "address" },
    { name: "recipient", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "noteId", type: "bytes32" },
    { name: "expiry", type: "uint64" },
    { name: "contractAddress", type: "address" },
    { name: "chainId", type: "uint256" }
  ]
};

const ANNOUNCEMENT_TYPES = {
  WalletAnnouncement: [
    { name: "walletAddress", type: "address" },
    { name: "nodeId", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "contractAddress", type: "address" },
    { name: "timestamp", type: "uint64" }
  ]
};

const DEFAULT_SETTINGS = {
  rpcUrl: "",
  contractAddress: "",
  chainId: SEPOLIA_CHAIN_ID,
  meshtasticPort: ""
};

const DEFAULT_RADIO_STATE = {
  announcements: {},
  handshakes: {},
  createdNotes: [],
  receivedNotes: [],
  activity: [],
  messages: []
};

let settings = null;
let walletData = null;
let radioState = null;
let lastSeenPorts = [];
let meshNodes = [];
let meshtasticStatus = {
  connected: false,
  mode: "starting",
  error: null,
  selectedPort: null,
  localNodeId: null
};
let bridgeProcess = null;
let stdoutBuffer = "";
let bridgeRefreshTimer = null;
let providerCache = null;
let providerCacheUrl = "";
const inboundTransfers = new Map();

function isPlaceholderRpcUrl(value) {
  const text = String(value || "").trim();
  if (!text) return true;
  return /YOUR_KEY|YOUR-PROJECT-ID|<.*>|undefined|null/i.test(text);
}

function pickRpcUrl(storedValue = "") {
  const candidates = [
    process.env.SEPOLIA_RPC_URL,
    process.env.RPC_URL,
    storedValue
  ];
  for (const candidate of candidates) {
    const text = String(candidate || "").trim();
    if (!text || isPlaceholderRpcUrl(text)) continue;
    return text;
  }
  return "";
}

bootstrap();

function bootstrap() {
  ensureDir(DATA_DIR);
  loadDotEnv();
  const storedSettings = loadJsonSafe(SETTINGS_FILE, {});
  settings = {
    ...DEFAULT_SETTINGS,
    ...storedSettings,
    rpcUrl: pickRpcUrl(storedSettings.rpcUrl),
    contractAddress: process.env.CONTRACT_ADDRESS || storedSettings.contractAddress || ""
  };
  walletData = loadJsonSafe(WALLET_FILE, null);
  radioState = {
    ...DEFAULT_RADIO_STATE,
    ...loadJsonSafe(STATE_FILE, {})
  };
  radioState.announcements = radioState.announcements || {};
  radioState.handshakes = radioState.handshakes || {};
  radioState.createdNotes = Array.isArray(radioState.createdNotes) ? radioState.createdNotes : [];
  radioState.receivedNotes = Array.isArray(radioState.receivedNotes) ? radioState.receivedNotes : [];
  radioState.activity = Array.isArray(radioState.activity) ? radioState.activity : [];
  radioState.messages = Array.isArray(radioState.messages) ? radioState.messages : [];
  persistSettings();
  persistRadioState();
  startBridge();
}

function loadDotEnv() {
  const envFile = path.join(ROOT, ".env");
  if (!fs.existsSync(envFile)) return;
  const lines = fs.readFileSync(envFile, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || /^\s*#/.test(line)) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    const rawValue = line.slice(index + 1).trim();
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue;
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function loadJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function persistSettings() {
  writeJson(SETTINGS_FILE, settings);
}

function persistWallet() {
  if (walletData) writeJson(WALLET_FILE, walletData);
  else if (fs.existsSync(WALLET_FILE)) fs.unlinkSync(WALLET_FILE);
}

function persistRadioState() {
  writeJson(STATE_FILE, radioState);
}

function addActivity(type, payload = {}) {
  radioState.activity.unshift({
    id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    timestamp: new Date().toISOString(),
    ...payload
  });
  radioState.activity = radioState.activity.slice(0, 200);
  persistRadioState();
}

function addMessage(message) {
  radioState.messages.unshift({
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    ...message
  });
  radioState.messages = radioState.messages.slice(0, 300);
  persistRadioState();
}

function getProvider() {
  if (!settings.rpcUrl) {
    throw new Error("RPC URL is not configured");
  }
  if (providerCache && providerCacheUrl === settings.rpcUrl) {
    return providerCache;
  }
  const network = ethers.Network.from({
    chainId: SEPOLIA_CHAIN_ID,
    name: "sepolia"
  });
  providerCache = new ethers.JsonRpcProvider(settings.rpcUrl, network, {
    staticNetwork: network
  });
  providerCacheUrl = settings.rpcUrl;
  return providerCache;
}

function getLocalWallet() {
  if (!walletData?.privateKey) {
    throw new Error("Wallet is not configured");
  }
  return new ethers.Wallet(walletData.privateKey);
}

function getSigner() {
  return getLocalWallet().connect(getProvider());
}

function getVault(contractRunner = null) {
  if (!settings.contractAddress || !ethers.isAddress(settings.contractAddress)) {
    throw new Error("Contract address is not configured");
  }
  return new ethers.Contract(
    settings.contractAddress,
    VAULT_ABI,
    contractRunner || getProvider()
  );
}

function getNoteDomain(contractAddress = settings.contractAddress) {
  return {
    name: "RadioNoteVault",
    version: "1",
    chainId: SEPOLIA_CHAIN_ID,
    verifyingContract: contractAddress
  };
}

function getAnnouncementDomain() {
  return {
    name: "RadioNoteAnnouncement",
    version: "1",
    chainId: SEPOLIA_CHAIN_ID,
    verifyingContract:
      settings.contractAddress && ethers.isAddress(settings.contractAddress)
        ? settings.contractAddress
        : ethers.ZeroAddress
  };
}

function normalizeAddress(value) {
  try {
    return ethers.getAddress(String(value || ""));
  } catch {
    return null;
  }
}

function parseEthAmount(value) {
  const text = String(value || "").trim();
  if (!text) throw new Error("Amount is required");
  return ethers.parseEther(text);
}

function formatEtherValue(value) {
  try {
    return ethers.formatEther(BigInt(value));
  } catch {
    return "0.0";
  }
}

function randomNoteId() {
  return `0x${crypto.randomBytes(32).toString("hex")}`;
}

function makeTransferId() {
  return crypto.randomBytes(4).toString("hex");
}

function base64UrlEncodeObject(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function base64UrlDecodeObject(value) {
  return JSON.parse(Buffer.from(String(value || ""), "base64url").toString("utf8"));
}

function encodeProtocolPacket(kind, payload) {
  return `RNP|${kind}|${base64UrlEncodeObject(payload)}`;
}

function decodeProtocolPacket(text) {
  const match = /^RNP\|([A-Z]+)\|([A-Za-z0-9\-_]+)$/.exec(String(text || "").trim());
  if (!match) return null;
  return { kind: match[1], payload: base64UrlDecodeObject(match[2]) };
}

function takeUtf8Prefix(text, maxBytes) {
  let end = text.length;
  while (end > 0) {
    const slice = text.slice(0, end);
    if (Buffer.byteLength(slice, "utf8") <= maxBytes) {
      return slice;
    }
    end -= 1;
  }
  return "";
}

function splitProtocolText(text, transferId) {
  const normalized = String(text || "").trim();
  if (!normalized) return [];
  const headerTemplate = `[${transferId}:1/1] `;
  const reserve = Buffer.byteLength(headerTemplate, "utf8");
  const maxChunkBytes = MESH_PACKET_MAX_BYTES - reserve;
  const parts = [];
  let remaining = normalized;
  while (remaining.length > 0) {
    const chunk = takeUtf8Prefix(remaining, maxChunkBytes);
    if (!chunk) break;
    parts.push(chunk);
    remaining = remaining.slice(chunk.length);
  }
  return parts.map((part, index) => `[${transferId}:${index + 1}/${parts.length}] ${part}`);
}

function parseMeshPart(text) {
  const match = /^\[([a-f0-9]{8}):(\d+)\/(\d+)\]\s*/i.exec(String(text || ""));
  if (!match) return null;
  return {
    transferId: match[1].toLowerCase(),
    partNum: Number(match[2]),
    total: Number(match[3]),
    content: String(text).slice(match[0].length)
  };
}

function mergeNodeViews() {
  const meshById = new Map(meshNodes.map((node) => [node.id, node]));
  const announcementEntries = Object.values(radioState.announcements || {});
  const handshakeEntries = Object.entries(radioState.handshakes || {});
  const ids = new Set([
    ...meshById.keys(),
    ...announcementEntries.map((entry) => entry.nodeId),
    ...handshakeEntries.map(([nodeId]) => nodeId)
  ]);
  return [...ids]
    .map((id) => {
      const meshNode = meshById.get(id) || {};
      const announcement = radioState.announcements[id] || null;
      const handshake = radioState.handshakes[id] || null;
      const ready = Boolean(
        handshake?.ready &&
        handshake?.checkedAt &&
        Date.now() - Number(handshake.checkedAt) <= HANDSHAKE_READY_MS
      );
      return {
        id,
        name: meshNode.name || meshNode.shortName || id,
        shortName: meshNode.shortName || "",
        online: Boolean(meshNode.online),
        lastHeard: meshNode.lastHeard || null,
        snr: meshNode.snr ?? null,
        address: announcement?.walletAddress || null,
        addressValid: Boolean(announcement?.verified),
        contractAddress: announcement?.contractAddress || null,
        announcedAt: announcement?.timestamp || null,
        ready,
        readyAt: handshake?.readyAt || null,
        checkedAt: handshake?.checkedAt || null,
        checkStatus: handshake?.status || "unknown",
        checkError: handshake?.error || null
      };
    })
    .sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
}

async function getWalletSummary() {
  const summary = {
    configured: Boolean(walletData?.address),
    address: walletData?.address || null,
    chainId: SEPOLIA_CHAIN_ID,
    onchainBalanceEth: null,
    availableLockedEth: null,
    reservedLockedEth: null
  };
  if (!summary.configured || !settings.rpcUrl) {
    return summary;
  }
  const provider = getProvider();
  const onchain = await provider.getBalance(walletData.address);
  summary.onchainBalanceEth = ethers.formatEther(onchain);

  if (settings.contractAddress && ethers.isAddress(settings.contractAddress)) {
    const vault = getVault(provider);
    const [available, reserved] = await Promise.all([
      vault.availableBalance(walletData.address),
      vault.reservedBalance(walletData.address)
    ]);
    summary.availableLockedEth = ethers.formatEther(available);
    summary.reservedLockedEth = ethers.formatEther(reserved);
  }
  return summary;
}

function getSafeSettings() {
  return {
    rpcUrl: settings.rpcUrl,
    contractAddress: settings.contractAddress,
    chainId: settings.chainId,
    meshtasticPort: settings.meshtasticPort
  };
}

async function getPublicState() {
  return {
    wallet: await getWalletSummary().catch((error) => ({
      configured: Boolean(walletData?.address),
      address: walletData?.address || null,
      error: error.message
    })),
    settings: getSafeSettings(),
    meshtastic: {
      ...meshtasticStatus,
      ports: lastSeenPorts
    },
    nodes: mergeNodeViews(),
    createdNotes: radioState.createdNotes,
    receivedNotes: radioState.receivedNotes,
    activity: radioState.activity.slice(0, 80),
    messages: radioState.messages.slice(0, 80)
  };
}

function inferPythonCommand() {
  return process.platform === "win32" ? "python" : "python3";
}

function startBridge() {
  stopBridge();
  stdoutBuffer = "";
  meshtasticStatus = {
    connected: false,
    mode: "starting",
    error: null,
    selectedPort: settings.meshtasticPort || null,
    localNodeId: null
  };
  try {
    bridgeProcess = spawn(inferPythonCommand(), [BRIDGE_PATH], {
      cwd: ROOT,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        MESHTASTIC_PORT: settings.meshtasticPort || ""
      }
    });
  } catch (error) {
    meshtasticStatus = {
      connected: false,
      mode: "error",
      error: error.message,
      selectedPort: settings.meshtasticPort || null,
      localNodeId: null
    };
    return;
  }

  bridgeProcess.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk.toString("utf8");
    let newlineIndex = stdoutBuffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = stdoutBuffer.slice(0, newlineIndex).trim();
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
      if (line) handleBridgeEvent(line);
      newlineIndex = stdoutBuffer.indexOf("\n");
    }
  });

  if (bridgeProcess.stdin) {
    bridgeProcess.stdin.on("error", (error) => {
      meshtasticStatus = {
        ...meshtasticStatus,
        connected: false,
        mode: "error",
        error: `Bridge stdin error: ${error.message}`
      };
    });
  }

  bridgeProcess.stderr.on("data", (chunk) => {
    const text = chunk.toString("utf8").trim();
    if (!text) return;
    meshtasticStatus = {
      ...meshtasticStatus,
      mode: "error",
      error: text
    };
  });

  bridgeProcess.on("error", (error) => {
    meshtasticStatus = {
      ...meshtasticStatus,
      connected: false,
      mode: "error",
      error: `Bridge process error: ${error.message}`
    };
  });

  bridgeProcess.on("exit", (code) => {
    meshtasticStatus = {
      ...meshtasticStatus,
      connected: false,
      mode: "offline",
      error: code === 0 ? null : `Bridge exited with code ${code}`
    };
    bridgeProcess = null;
  });

  bridgeRefreshTimer = setInterval(() => {
    sendBridge({ type: "refresh_nodes", payload: {} }).catch(() => {
      /* noop */
    });
  }, 20_000);
}

function stopBridge() {
  if (bridgeRefreshTimer) {
    clearInterval(bridgeRefreshTimer);
    bridgeRefreshTimer = null;
  }
  if (bridgeProcess && !bridgeProcess.killed) {
    bridgeProcess.kill();
  }
  bridgeProcess = null;
}

function sendBridge(command) {
  return new Promise((resolve, reject) => {
    if (!bridgeProcess || bridgeProcess.killed || !bridgeProcess.stdin) {
      reject(new Error("Meshtastic bridge is not running"));
      return;
    }
    if (bridgeProcess.stdin.destroyed || bridgeProcess.stdin.writableEnded) {
      reject(new Error("Meshtastic bridge pipe is closed"));
      return;
    }
    bridgeProcess.stdin.write(`${JSON.stringify(command)}\n`, "utf8", (error) => {
      if (error) {
        meshtasticStatus = {
          ...meshtasticStatus,
          connected: false,
          mode: "error",
          error: `Bridge write failed: ${error.message}`
        };
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function updateMessageAck(clientMsgId, ack) {
  const message = radioState.messages.find((entry) => entry.clientMsgId === clientMsgId);
  if (!message) return;
  message.ack = ack;
  persistRadioState();
}

function handleBridgeEvent(line) {
  try {
    const event = JSON.parse(line);
    switch (event.type) {
      case "status":
        lastSeenPorts = Array.isArray(event.ports) ? event.ports : lastSeenPorts;
        meshtasticStatus = {
          connected: Boolean(event.connected),
          mode: event.mode || (event.connected ? "serial" : "offline"),
          error: event.error || null,
          selectedPort: event.selectedPort || settings.meshtasticPort || null,
          localNodeId: event.localNodeId || meshtasticStatus.localNodeId || null
        };
        if (meshtasticStatus.connected) {
        }
        break;
      case "nodes":
        meshNodes = Array.isArray(event.nodes) ? event.nodes : [];
        break;
      case "message":
        addMessage({
          direction: "in",
          sender: event.sender,
          recipient: event.recipient,
          text: event.text,
          channelIndex: event.channelIndex ?? 0,
          isDirectMessage: Boolean(event.isDirectMessage),
          transport: "serial",
          ack: "received"
        });
        handleInboundMeshMessage(event);
        break;
      case "sent":
        updateMessageAck(event.clientMsgId, "sent");
        break;
      case "error":
        meshtasticStatus = {
          ...meshtasticStatus,
          error: event.message || "Unknown bridge error"
        };
        break;
      default:
        break;
    }
  } catch (error) {
    meshtasticStatus = {
      ...meshtasticStatus,
      error: `Bridge parse error: ${error.message}`
    };
  }
}

function handleInboundMeshMessage(event) {
  const text = String(event.text || "").trim();
  if (!text) return;

  const directPacket = decodeProtocolPacket(text);
  if (directPacket) {
    handleProtocolPacket(directPacket, event.sender);
    return;
  }

  const part = parseMeshPart(text);
  if (!part) return;

  const key = `${event.sender}:${part.transferId}`;
  const current = inboundTransfers.get(key) || {
    sender: event.sender,
    transferId: part.transferId,
    total: part.total,
    parts: new Map(),
    startedAt: Date.now()
  };
  current.total = part.total;
  if (!current.parts.has(part.partNum)) {
    current.parts.set(part.partNum, part.content);
  }
  inboundTransfers.set(key, current);

  if (current.parts.size === current.total) {
    const assembled = Array.from({ length: current.total }, (_, index) => current.parts.get(index + 1) || "").join("");
    inboundTransfers.delete(key);
    const packet = decodeProtocolPacket(assembled);
    if (packet) {
      handleProtocolPacket(packet, event.sender);
    }
  }
}

function upsertAnnouncement(entry) {
  radioState.announcements[entry.nodeId] = {
    ...radioState.announcements[entry.nodeId],
    ...entry,
    updatedAt: new Date().toISOString()
  };
  persistRadioState();
}

function markHandshake(nodeId, patch) {
  radioState.handshakes[nodeId] = {
    ...radioState.handshakes[nodeId],
    ...patch,
    updatedAt: new Date().toISOString()
  };
  persistRadioState();
}

function handleProtocolPacket(packet, senderNodeId) {
  if (packet.kind === "ANN") {
    const normalized = normalizeAnnouncement(packet.payload, senderNodeId);
    if (normalized) {
      upsertAnnouncement(normalized);
      addActivity("mesh_announcement", {
        nodeId: normalized.nodeId,
        walletAddress: normalized.walletAddress
      });
    }
    return;
  }

  if (packet.kind === "HELLO") {
    respondToHandshake(senderNodeId, packet.payload).catch((error) => {
      addActivity("handshake_reply_failed", {
        nodeId: senderNodeId,
        error: error.message
      });
    });
    return;
  }

  if (packet.kind === "READY") {
    const normalized = normalizeAnnouncement(packet.payload, senderNodeId);
    if (normalized) {
      upsertAnnouncement(normalized);
      markHandshake(normalized.nodeId, {
        ready: Boolean(normalized.verified),
        readyAt: Date.now(),
        checkedAt: Date.now(),
        status: normalized.verified ? "ready" : "invalid_signature",
        error: normalized.verified ? null : "Invalid wallet signature"
      });
      addActivity("handshake_ready", {
        nodeId: normalized.nodeId,
        walletAddress: normalized.walletAddress
      });
    }
    return;
  }

  if (packet.kind === "NOTE") {
    const normalized = normalizeReceivedNote(packet.payload, senderNodeId);
    if (!normalized) return;
    const existing = radioState.receivedNotes.find((note) => note.noteId === normalized.noteId);
    if (existing) {
      existing.updatedAt = new Date().toISOString();
      existing.lastPayload = normalized.payload;
    } else {
      radioState.receivedNotes.unshift(normalized);
      radioState.receivedNotes = radioState.receivedNotes.slice(0, 150);
    }
    persistRadioState();
    addActivity("note_received", {
      noteId: normalized.noteId,
      fromNodeId: normalized.senderNodeId,
      amountEth: normalized.amountEth
    });
    sendNoteAck(senderNodeId, normalized.noteId).catch((error) => {
      addActivity("note_ack_failed", {
        noteId: normalized.noteId,
        nodeId: senderNodeId,
        error: error.message
      });
    });
    return;
  }

  if (packet.kind === "NOTE_ACK") {
    const noteId = String(packet.payload?.noteId || "").trim();
    const entry = radioState.createdNotes.find((note) => note.noteId === noteId);
    if (!entry) return;
    entry.status = "delivered";
    entry.deliveredAt = new Date().toISOString();
    entry.deliveryAckNodeId = senderNodeId;
    entry.deliveryAckTimestamp = Number(packet.payload?.timestamp || 0) || Math.floor(Date.now() / 1000);
    entry.payload = "";
    entry.signature = "";
    persistRadioState();
    addActivity("note_delivered", {
      noteId,
      recipientNodeId: entry.recipientNodeId,
      amountEth: entry.amountEth
    });
  }
}

async function sendNoteAck(destinationNodeId, noteId) {
  if (!destinationNodeId || !noteId || !meshtasticStatus.connected) return;
  const packet = encodeProtocolPacket("NOTE_ACK", {
    noteId,
    recipientNodeId: meshtasticStatus.localNodeId || null,
    timestamp: Math.floor(Date.now() / 1000)
  });
  await sendProtocolPayload(destinationNodeId, packet);
}

function normalizeAnnouncement(payload, senderNodeId) {
  const walletAddress = normalizeAddress(payload?.walletAddress);
  const contractAddress = normalizeAddress(payload?.contractAddress || ethers.ZeroAddress) || ethers.ZeroAddress;
  const nodeId = String(payload?.nodeId || senderNodeId || "").trim();
  const signature = String(payload?.signature || "").trim();
  const timestamp = Number(payload?.timestamp || 0);
  const chainId = Number(payload?.chainId || 0);
  if (!walletAddress || !nodeId || !signature || chainId !== SEPOLIA_CHAIN_ID || !timestamp) {
    return null;
  }
  try {
    const recovered = ethers.verifyTypedData(
      {
        ...getAnnouncementDomain(),
        verifyingContract: contractAddress
      },
      ANNOUNCEMENT_TYPES,
      {
        walletAddress,
        nodeId,
        chainId,
        contractAddress,
        timestamp
      },
      signature
    );
    return {
      nodeId,
      walletAddress,
      contractAddress,
      chainId,
      timestamp,
      signature,
      verified: recovered.toLowerCase() === walletAddress.toLowerCase()
    };
  } catch {
    return {
      nodeId,
      walletAddress,
      contractAddress,
      chainId,
      timestamp,
      signature,
      verified: false
    };
  }
}

function normalizeReceivedNote(payload, senderNodeId) {
  const note = payload?.note;
  const signature = String(payload?.signature || "");
  if (!note || !signature) return null;
  const issuer = normalizeAddress(note.issuer);
  const recipient = normalizeAddress(note.recipient);
  const contractAddress = normalizeAddress(note.contractAddress);
  if (!issuer || !recipient || !contractAddress) return null;

  const noteId = String(note.noteId || "").trim();
  const amount = String(note.amount || "0");
  const expiry = Number(note.expiry || 0);
  const chainId = Number(note.chainId || 0);
  if (!noteId || !amount || !expiry || chainId !== SEPOLIA_CHAIN_ID) return null;

  let validSignature = false;
  try {
    const recovered = ethers.verifyTypedData(
      getNoteDomain(contractAddress),
      NOTE_TYPES,
      {
        issuer,
        recipient,
        amount,
        noteId,
        expiry,
        contractAddress,
        chainId
      },
      signature
    );
    validSignature = recovered.toLowerCase() === issuer.toLowerCase();
  } catch {
    validSignature = false;
  }

  const walletMatches = Boolean(walletData?.address) && walletData.address.toLowerCase() === recipient.toLowerCase();
  return {
    noteId,
    senderNodeId,
    issuer,
    recipient,
    amountWei: amount,
    amountEth: formatEtherValue(amount),
    expiry,
    contractAddress,
    chainId,
    signature,
    memo: String(payload?.memo || ""),
    payload: encodeProtocolPacket("NOTE", payload),
    receivedAt: new Date().toISOString(),
    status: walletMatches ? "ready_to_redeem" : "wrong_wallet",
    validSignature,
    walletMatches
  };
}

async function sendProtocolPayload(destinationId, packetText, options = {}) {
  const packets = splitProtocolText(packetText, makeTransferId());
  let sentChunks = 0;
  for (let index = 0; index < packets.length; index += 1) {
    const clientMsgId = `cmid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await sendBridge({
      type: "send_text",
      payload: {
        destinationId,
        text: packets[index],
        channelIndex: options.channelIndex ?? 0,
        wantAck: true,
        clientMsgId
      }
    });
    addMessage({
      direction: "out",
      sender: meshtasticStatus.localNodeId || "local",
      recipient: destinationId,
      text: packets[index],
      channelIndex: options.channelIndex ?? 0,
      isDirectMessage: destinationId !== "^all",
      transport: "serial",
      ack: "pending",
      clientMsgId
    });
    sentChunks = index + 1;
    if (typeof options.onProgress === "function") {
      options.onProgress(sentChunks, packets.length);
    }
    if (index < packets.length - 1) {
      await sleep(MESH_PACKET_DELAY_MS);
    }
  }
  return {
    totalChunks: packets.length,
    sentChunks
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function announceWalletOnMesh(force = false) {
  if (!walletData?.address) return;
  if (!meshtasticStatus.connected || !meshtasticStatus.localNodeId) return;
  if (!settings.contractAddress || !ethers.isAddress(settings.contractAddress)) return;

  const signer = getSigner();
  const announcement = {
    walletAddress: walletData.address,
    nodeId: meshtasticStatus.localNodeId,
    chainId: SEPOLIA_CHAIN_ID,
    contractAddress: settings.contractAddress,
    timestamp: Math.floor(Date.now() / 1000)
  };
  const signature = await signer.signTypedData(
    getAnnouncementDomain(),
    ANNOUNCEMENT_TYPES,
    announcement
  );
  const payload = encodeProtocolPacket("ANN", { ...announcement, signature });
  await sendProtocolPayload("^all", payload, { channelIndex: 0 });
  upsertAnnouncement({
    ...announcement,
    signature,
    verified: true
  });
  addActivity("announcement_sent", {
    nodeId: announcement.nodeId,
    walletAddress: announcement.walletAddress
  });
}

async function buildWalletAnnouncementPayload(nodeIdOverride = null) {
  if (!walletData?.address) {
    throw new Error("Wallet is not configured");
  }
  if (!settings.contractAddress || !ethers.isAddress(settings.contractAddress)) {
    throw new Error("Contract address is not configured");
  }
  const nodeId = String(nodeIdOverride || meshtasticStatus.localNodeId || "").trim();
  if (!nodeId) {
    throw new Error("Meshtastic local node id is not available");
  }
  const signer = getSigner();
  const announcement = {
    walletAddress: walletData.address,
    nodeId,
    chainId: SEPOLIA_CHAIN_ID,
    contractAddress: settings.contractAddress,
    timestamp: Math.floor(Date.now() / 1000)
  };
  const signature = await signer.signTypedData(
    getAnnouncementDomain(),
    ANNOUNCEMENT_TYPES,
    announcement
  );
  return {
    ...announcement,
    signature
  };
}

async function respondToHandshake(destinationNodeId, payload = {}) {
  if (!meshtasticStatus.connected) return;
  if (!walletData?.address) return;
  if (!destinationNodeId) return;
  const responsePayload = await buildWalletAnnouncementPayload();
  const packet = encodeProtocolPacket("READY", {
    ...responsePayload,
    protocol: "radio-note-v1",
    responseTo: String(payload?.requestId || "")
  });
  await sendProtocolPayload(destinationNodeId, packet);
}

async function createWallet() {
  const wallet = ethers.Wallet.createRandom();
  walletData = {
    address: wallet.address,
    privateKey: wallet.privateKey,
    mnemonic: wallet.mnemonic?.phrase || null,
    createdAt: new Date().toISOString()
  };
  persistWallet();
  addActivity("wallet_created", { address: wallet.address });
  return walletData;
}

function resetWallet() {
  walletData = null;
  persistWallet();
  addActivity("wallet_deleted", {});
}

async function sendOnchainEth(to, amountEth) {
  const signer = getSigner();
  const normalizedTo = normalizeAddress(to);
  if (!normalizedTo) throw new Error("Invalid recipient address");
  const value = parseEthAmount(amountEth);
  const tx = await signer.sendTransaction({ to: normalizedTo, value });
  addActivity("onchain_send_submitted", {
    to: normalizedTo,
    amountEth: String(amountEth),
    txHash: tx.hash
  });
  const receipt = await tx.wait();
  addActivity("onchain_send_confirmed", {
    to: normalizedTo,
    amountEth: String(amountEth),
    txHash: tx.hash,
    blockNumber: receipt?.blockNumber ?? null
  });
  return tx.hash;
}

async function depositIntoVault(amountEth) {
  const signer = getSigner();
  const vault = getVault(signer);
  const value = parseEthAmount(amountEth);
  const tx = await vault.deposit({ value });
  addActivity("vault_deposit_submitted", { amountEth: String(amountEth), txHash: tx.hash });
  const receipt = await tx.wait();
  addActivity("vault_deposit_confirmed", {
    amountEth: String(amountEth),
    txHash: tx.hash,
    blockNumber: receipt?.blockNumber ?? null
  });
  return tx.hash;
}

async function withdrawFromVault(amountEth) {
  const signer = getSigner();
  const vault = getVault(signer);
  const value = parseEthAmount(amountEth);
  const tx = await vault.withdrawAvailable(value);
  addActivity("vault_withdraw_submitted", { amountEth: String(amountEth), txHash: tx.hash });
  const receipt = await tx.wait();
  addActivity("vault_withdraw_confirmed", {
    amountEth: String(amountEth),
    txHash: tx.hash,
    blockNumber: receipt?.blockNumber ?? null
  });
  return tx.hash;
}

function getRecipientAnnouncement(nodeId) {
  const announcement = radioState.announcements[nodeId];
  const handshake = radioState.handshakes[nodeId];
  const ready = Boolean(
    handshake?.ready &&
    handshake?.checkedAt &&
    Date.now() - Number(handshake.checkedAt) <= HANDSHAKE_READY_MS
  );
  if (!ready) {
    throw new Error("Recipient node is not checked or handshake expired");
  }
  if (!announcement?.walletAddress || !announcement?.verified) {
    throw new Error("Recipient node has no verified wallet response");
  }
  return announcement;
}

async function checkRecipientNode(recipientNodeId) {
  if (!meshtasticStatus.connected) {
    throw new Error("Meshtastic is not connected");
  }
  const nodeId = String(recipientNodeId || "").trim();
  if (!nodeId) {
    throw new Error("Recipient node is required");
  }
  markHandshake(nodeId, {
    ready: false,
    checkedAt: Date.now(),
    status: "pending",
    error: null
  });
  const requestId = makeTransferId();
  const packet = encodeProtocolPacket("HELLO", {
    requestId,
    protocol: "radio-note-v1",
    senderNodeId: meshtasticStatus.localNodeId || null,
    timestamp: Math.floor(Date.now() / 1000)
  });
  await sendProtocolPayload(nodeId, packet);
  addActivity("handshake_requested", {
    nodeId
  });
  return {
    ok: true,
    requestId
  };
}

async function createRadioNote({ recipientNodeId, amountEth, expiryMinutes, memo }) {
  if (!meshtasticStatus.connected) {
    throw new Error("Meshtastic is not connected");
  }
  const announcement = getRecipientAnnouncement(recipientNodeId);
  const signer = getSigner();
  const vault = getVault(signer);
  const amountWei = parseEthAmount(amountEth);
  const expiry = Math.floor(Date.now() / 1000) + Math.max(5, Number(expiryMinutes || 60)) * 60;
  const noteId = randomNoteId();
  const issuer = walletData.address;
  const note = {
    issuer,
    recipient: announcement.walletAddress,
    amount: amountWei.toString(),
    noteId,
    expiry,
    contractAddress: settings.contractAddress,
    chainId: SEPOLIA_CHAIN_ID
  };

  const commitTx = await vault.commitNote(noteId, announcement.walletAddress, amountWei, expiry);
  addActivity("note_commit_submitted", {
    noteId,
    amountEth: String(amountEth),
    recipientNodeId,
    txHash: commitTx.hash
  });
  await commitTx.wait();

  const signature = await signer.signTypedData(getNoteDomain(), NOTE_TYPES, note);
  const payloadObject = {
    note,
    signature,
    memo: String(memo || ""),
    recipientNodeId
  };
  const payload = encodeProtocolPacket("NOTE", payloadObject);

  const entry = {
    noteId,
    amountWei: amountWei.toString(),
    amountEth: formatEtherValue(amountWei),
    recipientNodeId,
    recipientAddress: announcement.walletAddress,
    expiry,
    memo: String(memo || ""),
    signature,
    payload,
    commitTxHash: commitTx.hash,
    createdAt: new Date().toISOString(),
    status: "committed",
    transferQueuedChunks: 0,
    transferTotalChunks: 0
  };
  radioState.createdNotes.unshift(entry);
  radioState.createdNotes = radioState.createdNotes.slice(0, 150);
  persistRadioState();

  try {
    entry.status = "sending_over_mesh";
    persistRadioState();
    const result = await sendProtocolPayload(recipientNodeId, payload, {
      onProgress: (sentChunks, totalChunks) => {
        entry.transferQueuedChunks = sentChunks;
        entry.transferTotalChunks = totalChunks;
        persistRadioState();
      }
    });
    entry.transferQueuedChunks = result.sentChunks;
    entry.transferTotalChunks = result.totalChunks;
    entry.status = "sent_over_mesh";
    entry.sentAt = new Date().toISOString();
    addActivity("note_sent", {
      noteId,
      recipientNodeId,
      amountEth: entry.amountEth
    });
  } catch (error) {
    entry.status = "mesh_send_failed";
    entry.meshError = error.message;
    addActivity("note_send_failed", {
      noteId,
      recipientNodeId,
      error: error.message
    });
  }
  persistRadioState();
  return entry;
}

async function resendRadioNote(noteId) {
  const entry = radioState.createdNotes.find((note) => note.noteId === noteId);
  if (!entry) throw new Error("Unknown note");
  if (!entry.payload) throw new Error("Proof already acknowledged by recipient");
  entry.status = "sending_over_mesh";
  persistRadioState();
  const result = await sendProtocolPayload(entry.recipientNodeId, entry.payload, {
    onProgress: (sentChunks, totalChunks) => {
      entry.transferQueuedChunks = sentChunks;
      entry.transferTotalChunks = totalChunks;
      persistRadioState();
    }
  });
  entry.transferQueuedChunks = result.sentChunks;
  entry.transferTotalChunks = result.totalChunks;
  entry.status = "resent_over_mesh";
  entry.resentAt = new Date().toISOString();
  persistRadioState();
  addActivity("note_resent", { noteId: entry.noteId, recipientNodeId: entry.recipientNodeId });
}

async function redeemRadioNote(noteId) {
  const entry = radioState.receivedNotes.find((note) => note.noteId === noteId);
  if (!entry) throw new Error("Unknown received note");
  if (!entry.validSignature) throw new Error("Note signature is invalid");
  if (!entry.walletMatches) throw new Error("This note is not addressed to the current wallet");
  const signer = getSigner();
  const vault = getVault(signer);
  const note = {
    issuer: entry.issuer,
    recipient: entry.recipient,
    amount: entry.amountWei,
    noteId: entry.noteId,
    expiry: entry.expiry,
    contractAddress: entry.contractAddress,
    chainId: entry.chainId
  };
  const tx = await vault.redeem(note, entry.signature);
  entry.status = "redeem_submitted";
  entry.redeemTxHash = tx.hash;
  persistRadioState();
  addActivity("note_redeem_submitted", {
    noteId,
    amountEth: entry.amountEth,
    txHash: tx.hash
  });
  await tx.wait();
  entry.status = "redeemed";
  entry.redeemedAt = new Date().toISOString();
  persistRadioState();
  addActivity("note_redeemed", {
    noteId,
    amountEth: entry.amountEth,
    txHash: tx.hash
  });
  return tx.hash;
}

async function cancelRadioNote(noteId) {
  const entry = radioState.createdNotes.find((note) => note.noteId === noteId);
  if (!entry) throw new Error("Unknown note");
  const signer = getSigner();
  const vault = getVault(signer);
  const tx = await vault.cancelExpiredNote(noteId);
  entry.status = "cancel_submitted";
  entry.cancelTxHash = tx.hash;
  persistRadioState();
  await tx.wait();
  entry.status = "canceled";
  entry.canceledAt = new Date().toISOString();
  persistRadioState();
  addActivity("note_canceled", { noteId, txHash: tx.hash });
  return tx.hash;
}

async function generateAddressQr(text) {
  return QRCode.toDataURL(text, {
    width: 220,
    margin: 1,
    color: {
      dark: "#f4f8fc",
      light: "#171c22"
    }
  });
}

async function readJson(req) {
  const body = await readBody(req);
  return body ? JSON.parse(body) : {};
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk.toString("utf8");
      if (data.length > 1_000_000) {
        reject(new Error("Body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  const json = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(json, "utf8")
  });
  res.end(json);
}

function sendError(res, status, error) {
  sendJson(res, status, { error: error instanceof Error ? error.message : String(error) });
}

async function serveStatic(req, res) {
  const parsed = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsed.pathname === "/" ? "/index.html" : parsed.pathname;
  const safePath = path.normalize(path.join(STATIC_DIR, pathname));
  if (!safePath.startsWith(STATIC_DIR)) {
    sendError(res, 403, "Forbidden");
    return;
  }
  if (!fs.existsSync(safePath) || fs.statSync(safePath).isDirectory()) {
    sendError(res, 404, "Not found");
    return;
  }
  const ext = path.extname(safePath).toLowerCase();
  res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
  fs.createReadStream(safePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url) {
      sendError(res, 400, "Invalid request");
      return;
    }
    const parsed = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && parsed.pathname === "/api/state") {
      sendJson(res, 200, await getPublicState());
      return;
    }

    if (req.method === "POST" && parsed.pathname === "/api/settings") {
      const body = await readJson(req);
      settings.rpcUrl = String(body.rpcUrl || "").trim();
      settings.contractAddress = String(body.contractAddress || "").trim();
      settings.meshtasticPort = String(body.meshtasticPort || "").trim();
      providerCache = null;
      providerCacheUrl = "";
      persistSettings();
      startBridge();
      sendJson(res, 200, { ok: true, settings: getSafeSettings() });
      return;
    }

    if (req.method === "POST" && parsed.pathname === "/api/meshtastic/connect") {
      const body = await readJson(req);
      settings.meshtasticPort = String(body.meshtasticPort || settings.meshtasticPort || "").trim();
      persistSettings();
      startBridge();
      sendJson(res, 200, { ok: true, meshtastic: meshtasticStatus });
      return;
    }

    if (req.method === "POST" && parsed.pathname === "/api/meshtastic/announce") {
      await announceWalletOnMesh(true);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && parsed.pathname === "/api/wallet/create") {
      const wallet = await createWallet();
      sendJson(res, 200, {
        address: wallet.address,
        mnemonic: wallet.mnemonic
      });
      return;
    }

    if (req.method === "POST" && parsed.pathname === "/api/wallet/reset") {
      resetWallet();
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && parsed.pathname === "/api/wallet/qr") {
      if (!walletData?.address) {
        sendError(res, 404, "Wallet is not configured");
        return;
      }
      sendJson(res, 200, { qr: await generateAddressQr(walletData.address) });
      return;
    }

    if (req.method === "GET" && parsed.pathname === "/api/wallet/seed") {
      if (!walletData?.mnemonic) {
        sendError(res, 404, "Seed phrase is not available");
        return;
      }
      sendJson(res, 200, { mnemonic: walletData.mnemonic });
      return;
    }

    if (req.method === "POST" && parsed.pathname === "/api/wallet/send") {
      const body = await readJson(req);
      const txHash = await sendOnchainEth(body.to, body.amountEth);
      sendJson(res, 200, { ok: true, txHash });
      return;
    }

    if (req.method === "POST" && parsed.pathname === "/api/vault/deposit") {
      const body = await readJson(req);
      const txHash = await depositIntoVault(body.amountEth);
      sendJson(res, 200, { ok: true, txHash });
      return;
    }

    if (req.method === "POST" && parsed.pathname === "/api/vault/withdraw") {
      const body = await readJson(req);
      const txHash = await withdrawFromVault(body.amountEth);
      sendJson(res, 200, { ok: true, txHash });
      return;
    }

    if (req.method === "POST" && parsed.pathname === "/api/notes/check-recipient") {
      const body = await readJson(req);
      const result = await checkRecipientNode(String(body.recipientNodeId || "").trim());
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "POST" && parsed.pathname === "/api/notes/create") {
      const body = await readJson(req);
      const note = await createRadioNote({
        recipientNodeId: String(body.recipientNodeId || "").trim(),
        amountEth: String(body.amountEth || "").trim(),
        expiryMinutes: Number(body.expiryMinutes || 60),
        memo: String(body.memo || "")
      });
      sendJson(res, 200, { ok: true, note });
      return;
    }

    if (req.method === "POST" && parsed.pathname === "/api/notes/resend") {
      const body = await readJson(req);
      await resendRadioNote(String(body.noteId || "").trim());
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && parsed.pathname === "/api/notes/redeem") {
      const body = await readJson(req);
      const txHash = await redeemRadioNote(String(body.noteId || "").trim());
      sendJson(res, 200, { ok: true, txHash });
      return;
    }

    if (req.method === "POST" && parsed.pathname === "/api/notes/cancel") {
      const body = await readJson(req);
      const txHash = await cancelRadioNote(String(body.noteId || "").trim());
      sendJson(res, 200, { ok: true, txHash });
      return;
    }

    await serveStatic(req, res);
  } catch (error) {
    sendError(res, 500, error);
  }
});

server.listen(PORT, () => {
  console.log(`Radio Note wallet listening on http://127.0.0.1:${PORT}`);
});
