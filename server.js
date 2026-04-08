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
const LOGS_FILE = path.join(DATA_DIR, "logs.json");
const WALLET_SUMMARY_FILE = path.join(DATA_DIR, "wallet_summary.json");
const BRIDGE_PATH = path.join(ROOT, "bridge.py");
const PORT = Number(process.env.PORT || 7861);
const SEPOLIA_CHAIN_ID = 11155111;
const MESH_PACKET_MAX_BYTES = 180;
const MESH_PACKET_DELAY_MS = 1800;
const MESH_VALUE_PACKET_DELAY_MS = 3200;
const HANDSHAKE_READY_MS = 15 * 60 * 1000;
const HANDSHAKE_REPLY_TIMEOUT_MS = 20_000;
const MESH_ACK_RETRY_COUNT = 1;
const MESH_ACK_RETRY_DELAY_MS = 1800;
const MAX_PROTOCOL_LOGS = 600;
const DEFAULT_PREPARE_EXPIRY_DAYS = 7;

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
  "function prepareNote(bytes32 noteId, uint256 amount, uint64 expiry)",
  "function cancelExpiredNote(bytes32 noteId)",
  "function redeem((address issuer,address recipient,uint256 amount,bytes32 noteId,uint64 expiry,address contractAddress,uint256 chainId) note, bytes signature)",
  "function availableBalance(address issuer) view returns (uint256)",
  "function reservedBalance(address issuer) view returns (uint256)",
  "function commitments(bytes32 noteId) view returns (address issuer, uint256 amount, uint64 expiry, bool spent, bool canceled)"
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
  preparedNotes: [],
  createdNotes: [],
  receivedNotes: [],
  activity: [],
  messages: []
};

let settings = null;
let walletData = null;
let radioState = null;
let protocolLogs = [];
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
const completedInboundTransfers = new Map();
let meshSendQueue = Promise.resolve();
const INBOUND_TRANSFER_TTL_MS = 3 * 60 * 1000;
const COMPLETED_TRANSFER_TTL_MS = 5 * 60 * 1000;

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
  protocolLogs = Array.isArray(loadJsonSafe(LOGS_FILE, [])) ? loadJsonSafe(LOGS_FILE, []) : [];
  radioState.announcements = radioState.announcements || {};
  radioState.handshakes = radioState.handshakes || {};
  radioState.preparedNotes = Array.isArray(radioState.preparedNotes) ? radioState.preparedNotes : [];
  radioState.createdNotes = Array.isArray(radioState.createdNotes) ? radioState.createdNotes : [];
  radioState.receivedNotes = Array.isArray(radioState.receivedNotes) ? radioState.receivedNotes : [];
  radioState.activity = Array.isArray(radioState.activity) ? radioState.activity : [];
  radioState.messages = Array.isArray(radioState.messages) ? radioState.messages : [];
  persistSettings();
  persistRadioState();
  persistProtocolLogs();
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

function persistProtocolLogs() {
  writeJson(LOGS_FILE, protocolLogs);
}

function loadCachedWalletSummary() {
  return loadJsonSafe(WALLET_SUMMARY_FILE, null);
}

function persistWalletSummary(summary) {
  writeJson(WALLET_SUMMARY_FILE, summary);
}

function addProtocolLog(type, payload = {}) {
  protocolLogs.unshift({
    id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    timestamp: new Date().toISOString(),
    ...payload
  });
  protocolLogs = protocolLogs.slice(0, MAX_PROTOCOL_LOGS);
  persistProtocolLogs();
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

function getOfflineSigner() {
  return getLocalWallet();
}

function getConnectedSigner() {
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

function sumWeiValues(values = []) {
  return values.reduce((total, value) => {
    try {
      return total + BigInt(value || 0);
    } catch {
      return total;
    }
  }, 0n);
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

function hexToBase64Url(value) {
  const hex = String(value || "").trim().replace(/^0x/i, "");
  if (!hex) return "";
  return Buffer.from(hex, "hex").toString("base64url");
}

function base64UrlToHex(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return `0x${Buffer.from(text, "base64url").toString("hex")}`;
}

function base36ToBigInt(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return 0n;
  let result = 0n;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    let digit = -1;
    if (code >= 48 && code <= 57) digit = code - 48;
    else if (code >= 97 && code <= 122) digit = code - 87;
    if (digit < 0 || digit >= 36) throw new Error("Invalid base36 value");
    result = result * 36n + BigInt(digit);
  }
  return result;
}

function encodeProtocolPacket(kind, payload) {
  const packetKind = String(kind || "").trim().toUpperCase();
  if (packetKind === "H") {
    return `RNP|H|${String(payload?.r || payload?.requestId || "").trim()}`;
  }
  if (packetKind === "R") {
    const address = String(payload?.a || payload?.walletAddress || "").trim().replace(/^0x/i, "").toLowerCase();
    const timestamp = Number(payload?.t || payload?.timestamp || 0);
    const signature = hexToBase64Url(payload?.s || payload?.signature || "");
    const requestId = String(payload?.r || payload?.requestId || "").trim();
    return `RNP|R|${address}.${timestamp.toString(36)}.${signature}.${requestId}`;
  }
  if (packetKind === "N" || packetKind === "NOTE") {
    const note = payload?.note || {};
    const issuer = String(note.issuer || "").trim().replace(/^0x/i, "").toLowerCase();
    const recipient = String(note.recipient || "").trim().replace(/^0x/i, "").toLowerCase();
    const amount = BigInt(String(note.amount || "0")).toString(36);
    const noteId = hexToBase64Url(note.noteId || "");
    const expiry = Number(note.expiry || 0).toString(36);
    const signature = hexToBase64Url(payload?.signature || "");
    const memo = Buffer.from(String(payload?.memo || ""), "utf8").toString("base64url");
    return `RNP|N|${issuer}.${recipient}.${amount}.${noteId}.${expiry}.${signature}.${memo}`;
  }
  if (packetKind === "B" || packetKind === "NOTE_BUNDLE") {
    return `RNP|B|${base64UrlEncodeObject(payload)}`;
  }
  if (packetKind === "A" || packetKind === "NOTE_ACK") {
    const noteId = hexToBase64Url(payload?.noteId || "");
    const timestamp = Number(payload?.timestamp || 0).toString(36);
    return `RNP|A|${noteId}.${timestamp}`;
  }
  return `RNP|${packetKind}|${base64UrlEncodeObject(payload)}`;
}

function decodeProtocolPacket(text) {
  const match = /^RNP\|([A-Z]+)\|(.+)$/.exec(String(text || "").trim());
  if (!match) return null;
  const kind = String(match[1] || "").trim().toUpperCase();
  const body = String(match[2] || "").trim();
  if (kind === "H") {
    return { kind, payload: { r: body } };
  }
  if (kind === "R") {
    const [addressRaw, timestampRaw, signatureRaw, requestIdRaw = ""] = body.split(".");
    if (!addressRaw || !timestampRaw || !signatureRaw) return null;
    return {
      kind,
      payload: {
        a: `0x${addressRaw}`,
        t: Number.parseInt(timestampRaw, 36),
        s: base64UrlToHex(signatureRaw),
        r: requestIdRaw
      }
    };
  }
  if (kind === "N") {
    const [issuerRaw, recipientRaw, amountRaw, noteIdRaw, expiryRaw, signatureRaw, memoRaw = ""] = body.split(".");
    if (!issuerRaw || !recipientRaw || !amountRaw || !noteIdRaw || !expiryRaw || !signatureRaw) return null;
    return {
      kind,
      payload: {
        note: {
          issuer: `0x${issuerRaw}`,
          recipient: `0x${recipientRaw}`,
          amount: base36ToBigInt(amountRaw).toString(),
          noteId: base64UrlToHex(noteIdRaw),
          expiry: Number.parseInt(expiryRaw, 36),
          contractAddress: settings.contractAddress || ethers.ZeroAddress,
          chainId: SEPOLIA_CHAIN_ID
        },
        signature: base64UrlToHex(signatureRaw),
        memo: memoRaw ? Buffer.from(memoRaw, "base64url").toString("utf8") : ""
      }
    };
  }
  if (kind === "A") {
    const [noteIdRaw, timestampRaw] = body.split(".");
    if (!noteIdRaw || !timestampRaw) return null;
    return {
      kind,
      payload: {
        noteId: base64UrlToHex(noteIdRaw),
        timestamp: Number.parseInt(timestampRaw, 36)
      }
    };
  }
  if (kind === "B") {
    return { kind, payload: base64UrlDecodeObject(body) };
  }
  return { kind, payload: base64UrlDecodeObject(body) };
}

function normalizePacketKind(kind) {
  switch (String(kind || "").trim().toUpperCase()) {
    case "AN":
      return "ANN";
    case "H":
      return "HELLO";
    case "R":
      return "READY";
    case "N":
      return "NOTE";
    case "B":
      return "NOTE";
    case "A":
      return "NOTE_ACK";
    default:
      return String(kind || "").trim().toUpperCase();
  }
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
    reservedLockedEth: null,
    rpcReachable: false,
    balancesStale: false,
    cachedAt: null,
    error: null
  };
  if (!summary.configured || !settings.rpcUrl) {
    return summary;
  }
  try {
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
    summary.rpcReachable = true;
    summary.cachedAt = new Date().toISOString();
      persistWalletSummary({
        address: summary.address,
        chainId: summary.chainId,
        contractAddress: settings.contractAddress || "",
        onchainBalanceEth: summary.onchainBalanceEth,
        availableLockedEth: summary.availableLockedEth,
        reservedLockedEth: summary.reservedLockedEth,
        cachedAt: summary.cachedAt
      });
  } catch (error) {
    const cached = loadCachedWalletSummary();
    if (
      cached &&
      cached.address &&
      String(cached.address).toLowerCase() === String(summary.address || "").toLowerCase() &&
      String(cached.contractAddress || "") === String(settings.contractAddress || "")
    ) {
      summary.onchainBalanceEth = cached.onchainBalanceEth ?? null;
      summary.availableLockedEth = cached.availableLockedEth ?? null;
      summary.reservedLockedEth = cached.reservedLockedEth ?? null;
      summary.cachedAt = cached.cachedAt || null;
      summary.balancesStale = true;
      summary.error = null;
      addProtocolLog("wallet_summary_offline_cache_used", {
        address: summary.address,
        message: error.message || "rpc unavailable",
        cachedAt: summary.cachedAt
      });
      return summary;
    }
    summary.error = error.message;
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

function refreshPreparedNotesState() {
  const now = Math.floor(Date.now() / 1000);
  let changed = false;
  for (const note of radioState.preparedNotes) {
    if (note.status === "ready" && Number(note.expiry || 0) <= now) {
      note.status = "expired";
      note.expiredAt = new Date().toISOString();
      changed = true;
    }
  }
  if (changed) persistRadioState();
}

function getPreparedReadyNotes() {
  refreshPreparedNotesState();
  return radioState.preparedNotes
    .filter((note) => note.status === "ready")
    .sort((a, b) => Number(a.expiry || 0) - Number(b.expiry || 0));
}

function getPreparedInventorySummary() {
  const readyNotes = getPreparedReadyNotes();
  const spendableWei = readyNotes.reduce((sum, note) => {
    try {
      return sum + BigInt(note.amountWei || "0");
    } catch {
      return sum;
    }
  }, 0n);
  return {
    spendableWei: spendableWei.toString(),
    spendableEth: formatEtherValue(spendableWei),
    readyCount: readyNotes.length
  };
}

async function getPublicState() {
  pruneInboundTransferState();
  const preparedSummary = getPreparedInventorySummary();
  const incomingTransfers = Array.from(inboundTransfers.values())
    .map((transfer) => ({
      senderNodeId: transfer.sender || null,
      transferId: transfer.transferId,
      totalChunks: Number(transfer.total || 0),
      receivedChunks: transfer.parts instanceof Map ? transfer.parts.size : 0,
      startedAt: transfer.startedAt ? new Date(transfer.startedAt).toISOString() : null,
      updatedAt: transfer.updatedAt ? new Date(transfer.updatedAt).toISOString() : (transfer.startedAt ? new Date(transfer.startedAt).toISOString() : null)
    }))
    .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());
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
    preparedSummary,
    preparedNotes: radioState.preparedNotes,
    incomingTransfers,
    createdNotes: radioState.createdNotes,
    receivedNotes: radioState.receivedNotes,
    activity: radioState.activity.slice(0, 80),
    messages: radioState.messages.slice(0, 80)
  };
}

function pruneInboundTransferState() {
  const now = Date.now();
  for (const [key, transfer] of inboundTransfers.entries()) {
    const updatedAt = Number(transfer.updatedAt || transfer.startedAt || 0);
    if (updatedAt && now - updatedAt > INBOUND_TRANSFER_TTL_MS) {
      inboundTransfers.delete(key);
    }
  }
  for (const [key, completedAt] of completedInboundTransfers.entries()) {
    if (!completedAt || now - Number(completedAt) > COMPLETED_TRANSFER_TTL_MS) {
      completedInboundTransfers.delete(key);
    }
  }
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
        if (String(event.text || "").includes("RNP") || /^\[[a-f0-9]{8}:\d+\/\d+\]/i.test(String(event.text || ""))) {
          addProtocolLog("bridge_message", {
            sender: event.sender || null,
            recipient: event.recipient || null,
            isDirectMessage: Boolean(event.isDirectMessage),
            textPreview: String(event.text || "").slice(0, 180),
            textLength: String(event.text || "").length
          });
        }
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
        if (String(event.text || "").includes("RNP") || /^\[[a-f0-9]{8}:\d+\/\d+\]/i.test(String(event.text || ""))) {
          addProtocolLog("bridge_sent", {
            destinationId: event.destinationId || null,
            clientMsgId: event.clientMsgId || null,
            acked: event.acked ?? null,
            attempts: event.attempts ?? null,
            textPreview: String(event.text || "").slice(0, 180),
            textLength: String(event.text || "").length
          });
        }
        updateMessageAck(
          event.clientMsgId,
          event.acked === false ? "timeout" : event.acked ? "acked" : "sent"
        );
        break;
      case "error":
        addProtocolLog("bridge_error", {
          clientMsgId: event.clientMsgId || null,
          destinationId: event.destinationId || null,
          message: event.message || "Unknown bridge error",
          attempts: event.attempts ?? null,
          textPreview: String(event.text || "").slice(0, 180)
        });
        if (event.clientMsgId) {
          updateMessageAck(event.clientMsgId, "failed");
        }
        if (!String(event.message || "").toLowerCase().includes("ack timeout")) {
          meshtasticStatus = {
            ...meshtasticStatus,
            error: event.message || "Unknown bridge error"
          };
        }
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
  pruneInboundTransferState();
  const text = String(event.text || "").trim();
  if (!text) return;

  const directPacket = decodeProtocolPacket(text);
  if (directPacket) {
    addProtocolLog("packet_direct", {
      sender: event.sender || null,
      recipient: event.recipient || null,
      kind: normalizePacketKind(directPacket.kind),
      rawKind: directPacket.kind,
      textLength: text.length
    });
    handleProtocolPacket(directPacket, event.sender);
    return;
  }

  const part = parseMeshPart(text);
  if (!part) return;
  addProtocolLog("packet_chunk", {
    sender: event.sender || null,
    transferId: part.transferId,
    partNum: part.partNum,
    total: part.total,
    chunkLength: String(part.content || "").length
  });

  const key = `${event.sender}:${part.transferId}`;
  if (completedInboundTransfers.has(key)) {
    addProtocolLog("packet_chunk_ignored_completed", {
      sender: event.sender || null,
      transferId: part.transferId,
      partNum: part.partNum,
      total: part.total
    });
    return;
  }
  const current = inboundTransfers.get(key) || {
    sender: event.sender,
    transferId: part.transferId,
    total: part.total,
    parts: new Map(),
    startedAt: Date.now()
  };
  current.total = part.total;
  current.updatedAt = Date.now();
  if (!current.parts.has(part.partNum)) {
    current.parts.set(part.partNum, part.content);
  }
  inboundTransfers.set(key, current);

  if (current.parts.size === current.total) {
    const assembled = Array.from({ length: current.total }, (_, index) => current.parts.get(index + 1) || "").join("");
    inboundTransfers.delete(key);
    const packet = decodeProtocolPacket(assembled);
    if (packet) {
      completedInboundTransfers.set(key, Date.now());
      addProtocolLog("packet_assembled", {
        sender: event.sender || null,
        transferId: part.transferId,
        kind: normalizePacketKind(packet.kind),
        rawKind: packet.kind,
        textLength: assembled.length
      });
      handleProtocolPacket(packet, event.sender);
    } else {
      addProtocolLog("packet_decode_failed", {
        sender: event.sender || null,
        transferId: part.transferId,
        textPreview: assembled.slice(0, 180),
        textLength: assembled.length
      });
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

function findCreatedNoteEntry(noteRef) {
  const normalized = String(noteRef || "").trim();
  if (!normalized) return null;
  return radioState.createdNotes.find((note) => note.noteId === normalized || note.bundleId === normalized) || null;
}

function handleProtocolPacket(packet, senderNodeId) {
  const kind = normalizePacketKind(packet.kind);
  addProtocolLog("packet_dispatch", {
    senderNodeId: senderNodeId || null,
    kind,
    rawKind: packet.kind
  });

  if (kind === "ANN") {
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

  if (kind === "HELLO") {
    addProtocolLog("handshake_hello_received", {
      senderNodeId: senderNodeId || null,
      requestId: String(packet.payload?.requestId || packet.payload?.r || "")
    });
    respondToHandshake(senderNodeId, packet.payload).catch((error) => {
      addProtocolLog("handshake_reply_failed", {
        nodeId: senderNodeId || null,
        message: error.message
      });
      addActivity("handshake_reply_failed", {
        nodeId: senderNodeId,
        error: error.message
      });
    });
    return;
  }

  if (kind === "READY") {
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
      addProtocolLog("handshake_ready", {
        nodeId: normalized.nodeId,
        walletAddress: normalized.walletAddress,
        verified: Boolean(normalized.verified)
      });
      addActivity("handshake_ready", {
        nodeId: normalized.nodeId,
        walletAddress: normalized.walletAddress
      });
    }
    return;
  }

  if (kind === "NOTE") {
    const normalized = normalizeReceivedNotes(packet.payload, senderNodeId);
    if (!normalized.notes.length) return;
    normalized.notes.forEach((receivedNote) => {
      const existing = radioState.receivedNotes.find((note) => note.noteId === receivedNote.noteId);
      if (existing) {
        existing.updatedAt = new Date().toISOString();
        existing.lastPayload = receivedNote.lastPayload;
        existing.bundleId = receivedNote.bundleId;
      } else {
        radioState.receivedNotes.unshift(receivedNote);
      }
      addActivity("note_received", {
        noteId: receivedNote.noteId,
        fromNodeId: receivedNote.senderNodeId,
        amountEth: receivedNote.amountEth
      });
    });
    radioState.receivedNotes = radioState.receivedNotes.slice(0, 150);
    persistRadioState();
    sendNoteAck(senderNodeId, normalized.bundleId).catch((error) => {
      addActivity("note_ack_failed", {
        noteId: normalized.bundleId,
        nodeId: senderNodeId,
        error: error.message
      });
    });
    return;
  }

  if (kind === "NOTE_ACK") {
    const noteId = String(packet.payload?.noteId || "").trim();
    const entry = findCreatedNoteEntry(noteId);
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
  await sendProtocolPayload(destinationNodeId, packet, {
    waitForAck: true,
    retryOnAckTimeout: MESH_ACK_RETRY_COUNT,
    ackTimeoutRetryDelayMs: MESH_ACK_RETRY_DELAY_MS,
    batchDelayMs: MESH_VALUE_PACKET_DELAY_MS
  });
}

function normalizeAnnouncement(payload, senderNodeId) {
  const walletAddress = normalizeAddress(payload?.walletAddress || payload?.a);
  const contractFallback = normalizeAddress(settings.contractAddress || "") || ethers.ZeroAddress;
  const contractAddress = normalizeAddress(payload?.contractAddress || payload?.c || contractFallback) || ethers.ZeroAddress;
  const nodeId = String(payload?.nodeId || payload?.n || senderNodeId || "").trim();
  const signature = String(payload?.signature || payload?.s || "").trim();
  const timestamp = Number(payload?.timestamp || payload?.t || 0);
  const chainId = Number(payload?.chainId || payload?.i || SEPOLIA_CHAIN_ID);
  if (!walletAddress || !nodeId || !signature || chainId !== SEPOLIA_CHAIN_ID || !timestamp) {
    addProtocolLog("announcement_invalid", {
      senderNodeId: senderNodeId || null,
      hasWalletAddress: Boolean(walletAddress),
      hasNodeId: Boolean(nodeId),
      hasSignature: Boolean(signature),
      chainId,
      timestamp
    });
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
    addProtocolLog("announcement_verify_failed", {
      senderNodeId: senderNodeId || null,
      nodeId,
      walletAddress
    });
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

function normalizeReceivedNotes(payload, senderNodeId) {
  const bundleId = String(payload?.b || payload?.bundleId || payload?.noteId || "").trim() || randomNoteId();
  const compactNotes = Array.isArray(payload?.n)
    ? payload.n.map((item) => ({
      issuer: payload?.i,
      recipient: payload?.r,
      contractAddress: payload?.c || settings.contractAddress || ethers.ZeroAddress,
      chainId: SEPOLIA_CHAIN_ID,
      amount: Array.isArray(item) ? item[0] : item?.amount,
      noteId: Array.isArray(item) ? item[1] : item?.noteId,
      expiry: Array.isArray(item) ? item[2] : item?.expiry,
      signature: Array.isArray(item) ? item[3] : item?.signature
    }))
    : [];
  const incomingNotes = compactNotes.length
    ? compactNotes
    : payload?.note && payload?.signature
      ? [{
        issuer: payload.note.issuer,
        recipient: payload.note.recipient,
        contractAddress: payload.note.contractAddress,
        chainId: payload.note.chainId,
        amount: payload.note.amount,
        noteId: payload.note.noteId,
        expiry: payload.note.expiry,
        signature: payload.signature
      }]
      : [];
  const memo = String(payload?.m || payload?.memo || "");
  const normalized = [];
  incomingNotes.forEach((raw) => {
    const issuer = normalizeAddress(raw.issuer);
    const recipient = normalizeAddress(raw.recipient);
    const contractAddress = normalizeAddress(raw.contractAddress);
    if (!issuer || !recipient || !contractAddress) return;
    const noteId = String(raw.noteId || "").trim();
    const amount = String(raw.amount || "0");
    const expiry = Number(raw.expiry || 0);
    const chainId = Number(raw.chainId || SEPOLIA_CHAIN_ID);
    const signature = String(raw.signature || "");
    if (!noteId || !amount || !expiry || !signature || chainId !== SEPOLIA_CHAIN_ID) return;
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
    normalized.push({
      noteId,
      bundleId,
      senderNodeId,
      issuer,
      recipient,
      amountWei: amount,
      amountEth: formatEtherValue(amount),
      expiry,
      contractAddress,
      chainId,
      signature,
      memo,
      payload: "",
      lastPayload: "",
      receivedAt: new Date().toISOString(),
      status: walletMatches ? "ready_to_redeem" : "wrong_wallet",
      validSignature,
      walletMatches
    });
  });
  return {
    bundleId,
    notes: normalized
  };
}

async function sendProtocolPayload(destinationId, packetText, options = {}) {
  const packets = splitProtocolText(packetText, makeTransferId());
  const task = async () => {
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
          waitForAck: Boolean(options.waitForAck),
          retryOnAckTimeout: options.retryOnAckTimeout ?? MESH_ACK_RETRY_COUNT,
          ackTimeoutRetryDelayMs: options.ackTimeoutRetryDelayMs ?? MESH_ACK_RETRY_DELAY_MS,
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
        await sleep(options.batchDelayMs ?? MESH_PACKET_DELAY_MS);
      }
    }
    return {
      totalChunks: packets.length,
      sentChunks
    };
  };
  const queued = meshSendQueue.catch(() => {}).then(task);
  meshSendQueue = queued;
  return queued;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function announceWalletOnMesh(force = false) {
  if (!walletData?.address) return;
  if (!meshtasticStatus.connected || !meshtasticStatus.localNodeId) return;
  if (!settings.contractAddress || !ethers.isAddress(settings.contractAddress)) return;

  const signer = getOfflineSigner();
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
  const signer = getOfflineSigner();
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
  if (!meshtasticStatus.connected) {
    addProtocolLog("handshake_reply_skipped", { reason: "mesh_not_connected" });
    return;
  }
  if (!walletData?.address) {
    addProtocolLog("handshake_reply_skipped", { reason: "wallet_not_configured" });
    return;
  }
  if (!destinationNodeId) {
    addProtocolLog("handshake_reply_skipped", { reason: "missing_destination" });
    return;
  }
  const responsePayload = await buildWalletAnnouncementPayload();
  const packet = encodeProtocolPacket("R", {
    a: responsePayload.walletAddress,
    t: responsePayload.timestamp,
    s: responsePayload.signature,
    r: String(payload?.requestId || payload?.r || "")
  });
  addProtocolLog("handshake_reply_send", {
    destinationNodeId,
    requestId: String(payload?.requestId || payload?.r || ""),
    packetLength: packet.length
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
  const signer = getConnectedSigner();
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
  const signer = getConnectedSigner();
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
  const signer = getConnectedSigner();
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
  const packet = encodeProtocolPacket("H", {
    r: requestId
  });
  addProtocolLog("handshake_request_send", {
    recipientNodeId: nodeId,
    requestId,
    packetLength: packet.length
  });
  await sendProtocolPayload(nodeId, packet, {
    waitForAck: true,
    retryOnAckTimeout: MESH_ACK_RETRY_COUNT,
    ackTimeoutRetryDelayMs: MESH_ACK_RETRY_DELAY_MS
  });
  setTimeout(() => {
    const handshake = radioState.handshakes[nodeId];
    if (!handshake) return;
    if (handshake.status !== "pending") return;
    if (Date.now() - Number(handshake.checkedAt || 0) < HANDSHAKE_REPLY_TIMEOUT_MS) return;
    addProtocolLog("handshake_timeout", {
      recipientNodeId: nodeId,
      requestId
    });
    markHandshake(nodeId, {
      ready: false,
      status: "timeout",
      error: "No wallet reply over mesh"
    });
  }, HANDSHAKE_REPLY_TIMEOUT_MS + 250);
  addActivity("handshake_requested", {
    nodeId
  });
  return {
    ok: true,
    requestId
  };
}

async function prepareOffgridAmount({ amountEth, expiryDays }) {
  const signer = getConnectedSigner();
  const vault = getVault(signer);
  const amountWei = parseEthAmount(amountEth);
  const noteId = randomNoteId();
  const expiry = Math.floor(Date.now() / 1000) + Math.max(1, Number(expiryDays || DEFAULT_PREPARE_EXPIRY_DAYS)) * 24 * 60 * 60;
  const tx = await vault.prepareNote(noteId, amountWei, expiry);
  addActivity("note_prepare_submitted", {
    noteId,
    amountEth: String(amountEth),
    txHash: tx.hash
  });
  await tx.wait();

  const entry = {
    noteId,
    amountWei: amountWei.toString(),
    amountEth: formatEtherValue(amountWei),
    expiry,
    prepareTxHash: tx.hash,
    preparedAt: new Date().toISOString(),
    status: "ready"
  };
  radioState.preparedNotes.unshift(entry);
  radioState.preparedNotes = radioState.preparedNotes.slice(0, 200);
  persistRadioState();
  addActivity("note_prepared", {
    noteId,
    amountEth: entry.amountEth,
    txHash: tx.hash
  });
  return entry;
}

function takePreparedNotes(noteIds = []) {
  refreshPreparedNotesState();
  const wantedIds = Array.from(new Set((Array.isArray(noteIds) ? noteIds : [noteIds]).map((noteId) => String(noteId || "").trim()).filter(Boolean)));
  if (!wantedIds.length) {
    throw new Error("Select a prepared amount first");
  }
  const readyById = new Map(
    radioState.preparedNotes
      .filter((note) => note.status === "ready")
      .map((note) => [String(note.noteId || "").trim(), note])
  );
  const selected = wantedIds.map((noteId) => readyById.get(noteId)).filter(Boolean);
  if (selected.length !== wantedIds.length) {
    throw new Error("Some prepared chunks are no longer available. Refresh and try again.");
  }
  const selectedSet = new Set(wantedIds);
  radioState.preparedNotes = radioState.preparedNotes.filter((note) => !selectedSet.has(String(note.noteId || "").trim()));
  persistRadioState();
  return selected;
}

async function createRadioNote({ recipientNodeId, preparedNoteIds, memo }) {
  if (!meshtasticStatus.connected) {
    throw new Error("Meshtastic is not connected");
  }
  const selectedNoteIds = Array.from(new Set((Array.isArray(preparedNoteIds) ? preparedNoteIds : [preparedNoteIds]).map((noteId) => String(noteId || "").trim()).filter(Boolean)));
  if (!selectedNoteIds.length) {
    throw new Error("Select a prepared amount first");
  }
  const announcement = getRecipientAnnouncement(recipientNodeId);
  const preparedEntries = takePreparedNotes(selectedNoteIds);
  const signer = getOfflineSigner();
  const issuer = walletData.address;
  const bundleId = randomNoteId();
  const bundleParts = [];
  for (const prepared of preparedEntries) {
    const note = {
      issuer,
      recipient: announcement.walletAddress,
      amount: prepared.amountWei,
      noteId: prepared.noteId,
      expiry: prepared.expiry,
      contractAddress: settings.contractAddress,
      chainId: SEPOLIA_CHAIN_ID
    };
    const signature = await signer.signTypedData(getNoteDomain(), NOTE_TYPES, note);
    bundleParts.push([prepared.amountWei, prepared.noteId, prepared.expiry, signature]);
  }
  const payloadObject = {
    b: bundleId,
    i: issuer,
    r: announcement.walletAddress,
    c: settings.contractAddress,
    n: bundleParts,
    m: String(memo || "")
  };
  const payload = encodeProtocolPacket("NOTE_BUNDLE", payloadObject);
  const totalAmountWei = sumWeiValues(preparedEntries.map((entry) => entry.amountWei));
  const earliestExpiry = preparedEntries.reduce((min, entry) => Math.min(min, Number(entry.expiry || 0) || Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);

  const entry = {
    noteId: bundleId,
    bundleId,
    noteIds: preparedEntries.map((prepared) => prepared.noteId),
    noteCount: preparedEntries.length,
    amountWei: totalAmountWei.toString(),
    amountEth: formatEtherValue(totalAmountWei),
    recipientNodeId,
    recipientAddress: announcement.walletAddress,
    expiry: earliestExpiry === Number.MAX_SAFE_INTEGER ? 0 : earliestExpiry,
    memo: String(memo || ""),
    payload,
    prepareTxHashes: preparedEntries.map((prepared) => prepared.prepareTxHash).filter(Boolean),
    preparedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    status: "prepared",
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
      waitForAck: true,
      retryOnAckTimeout: MESH_ACK_RETRY_COUNT,
      ackTimeoutRetryDelayMs: MESH_ACK_RETRY_DELAY_MS,
      batchDelayMs: MESH_VALUE_PACKET_DELAY_MS,
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
      noteId: entry.bundleId,
      recipientNodeId,
      amountEth: entry.amountEth
    });
  } catch (error) {
    entry.status = "mesh_send_failed";
    entry.meshError = error.message;
    addActivity("note_send_failed", {
      noteId: entry.bundleId,
      recipientNodeId,
      error: error.message
    });
  }
  persistRadioState();
  return entry;
}

async function resendRadioNote(noteId) {
  const entry = findCreatedNoteEntry(noteId);
  if (!entry) throw new Error("Unknown note");
  if (!entry.payload) throw new Error("Proof already acknowledged by recipient");
  entry.status = "sending_over_mesh";
  persistRadioState();
  const result = await sendProtocolPayload(entry.recipientNodeId, entry.payload, {
    waitForAck: true,
    retryOnAckTimeout: MESH_ACK_RETRY_COUNT,
    ackTimeoutRetryDelayMs: MESH_ACK_RETRY_DELAY_MS,
    batchDelayMs: MESH_VALUE_PACKET_DELAY_MS,
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
  addActivity("note_resent", { noteId: entry.bundleId || entry.noteId, recipientNodeId: entry.recipientNodeId });
}

async function redeemRadioNote(noteId) {
  const entry = radioState.receivedNotes.find((note) => note.noteId === noteId);
  if (!entry) throw new Error("Unknown received note");
  if (!entry.validSignature) throw new Error("Note signature is invalid");
  if (!entry.walletMatches) throw new Error("This note is not addressed to the current wallet");
  const signer = getConnectedSigner();
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
  const entry = findCreatedNoteEntry(noteId);
  if (!entry) throw new Error("Unknown note");
  const signer = getConnectedSigner();
  const vault = getVault(signer);
  const noteIds = Array.isArray(entry.noteIds) && entry.noteIds.length ? entry.noteIds : [entry.noteId];
  entry.status = "cancel_submitted";
  persistRadioState();
  const txHashes = [];
  for (const currentNoteId of noteIds) {
    const tx = await vault.cancelExpiredNote(currentNoteId);
    txHashes.push(tx.hash);
    await tx.wait();
  }
  entry.cancelTxHash = txHashes[txHashes.length - 1] || "";
  entry.cancelTxHashes = txHashes;
  entry.status = "canceled";
  entry.canceledAt = new Date().toISOString();
  persistRadioState();
  addActivity("note_canceled", { noteId: entry.bundleId || entry.noteId, txHash: entry.cancelTxHash });
  return entry.cancelTxHash;
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

    if (req.method === "POST" && parsed.pathname === "/api/offgrid/prepare") {
      const body = await readJson(req);
      const note = await prepareOffgridAmount({
        amountEth: String(body.amountEth || "").trim(),
        expiryDays: Number(body.expiryDays || DEFAULT_PREPARE_EXPIRY_DAYS)
      });
      sendJson(res, 200, { ok: true, note });
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
        preparedNoteIds: Array.isArray(body.preparedNoteIds)
          ? body.preparedNoteIds.map((value) => String(value || "").trim()).filter(Boolean)
          : String(body.preparedNoteId || "").trim(),
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
