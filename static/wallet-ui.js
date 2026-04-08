const els = {
  refreshButton: document.getElementById("refreshButton"),
  openWalletButton: document.getElementById("openWalletButton"),
  heroOpenWalletButton: document.getElementById("heroOpenWalletButton"),
  deviceStatus: document.getElementById("deviceStatus"),
  deviceStatusTitle: document.getElementById("deviceStatusTitle"),
  deviceStatusText: document.getElementById("deviceStatusText"),
  portSwitcher: document.getElementById("portSwitcher"),
  portSwitcherSelect: document.getElementById("portSwitcherSelect"),
  portSwitcherConnectButton: document.getElementById("portSwitcherConnectButton"),
  portSwitcherStatus: document.getElementById("portSwitcherStatus"),
  runtimeError: document.getElementById("runtimeError"),
  nodesOnlineCount: document.getElementById("nodesOnlineCount"),
  nodesList: document.getElementById("nodesList"),
  heroWalletAddress: document.getElementById("heroWalletAddress"),
  heroOnchain: document.getElementById("heroOnchain"),
  heroVaultAvailable: document.getElementById("heroVaultAvailable"),
  heroVaultReserved: document.getElementById("heroVaultReserved"),
  walletModal: document.getElementById("walletModal"),
  walletModalClose: document.getElementById("walletModalClose"),
  walletEngineStatus: document.getElementById("walletEngineStatus"),
  walletMeshtasticStatus: document.getElementById("walletMeshtasticStatus"),
  walletPanels: Array.from(document.querySelectorAll(".wallet-view-panel")),
  walletQuickButtons: Array.from(document.querySelectorAll(".wallet-quick-button")),
  walletHomeNoWallet: document.getElementById("walletHomeNoWallet"),
  walletHomeSummary: document.getElementById("walletHomeSummary"),
  walletHomeCreateButton: document.getElementById("walletHomeCreateButton"),
  walletReceivePreview: document.getElementById("walletReceivePreview"),
  walletCopyAddressButton: document.getElementById("walletCopyAddressButton"),
  vaultAvailableBalanceValue: document.getElementById("vaultAvailableBalanceValue"),
  vaultAvailableSub: document.getElementById("vaultAvailableSub"),
  onchainBalanceValue: document.getElementById("onchainBalanceValue"),
  walletBalanceSub: document.getElementById("walletBalanceSub"),
  receiveWalletTab: document.getElementById("receiveWalletTab"),
  receiveNotesTab: document.getElementById("receiveNotesTab"),
  receiveWalletPanel: document.getElementById("receiveWalletPanel"),
  receiveNotesPanel: document.getElementById("receiveNotesPanel"),
  walletReceiveNoWallet: document.getElementById("walletReceiveNoWallet"),
  walletReceiveContent: document.getElementById("walletReceiveContent"),
  walletQrLoading: document.getElementById("walletQrLoading"),
  walletQrImage: document.getElementById("walletQrImage"),
  walletReceiveId: document.getElementById("walletReceiveId"),
  walletCopyReceiveIdButton: document.getElementById("walletCopyReceiveIdButton"),
  receivedNotesList: document.getElementById("receivedNotesList"),
  sendNotesTab: document.getElementById("sendNotesTab"),
  sendWalletTab: document.getElementById("sendWalletTab"),
  sendNotesPanel: document.getElementById("sendNotesPanel"),
  sendWalletPanel: document.getElementById("sendWalletPanel"),
  walletSendForm: document.getElementById("walletSendForm"),
  walletRecipientInput: document.getElementById("walletRecipientInput"),
  walletCheckRecipientButton: document.getElementById("walletCheckRecipientButton"),
  walletRecipientStatus: document.getElementById("walletRecipientStatus"),
  walletAmountInput: document.getElementById("walletAmountInput"),
  walletExpiryInput: document.getElementById("walletExpiryInput"),
  walletMemoInput: document.getElementById("walletMemoInput"),
  walletSendSubmitButton: document.getElementById("walletSendSubmitButton"),
  walletSendStatus: document.getElementById("walletSendStatus"),
  createdNotesList: document.getElementById("createdNotesList"),
  sendOnchainForm: document.getElementById("sendOnchainForm"),
  sendAddressInput: document.getElementById("sendAddressInput"),
  sendAmountInput: document.getElementById("sendAmountInput"),
  sendStatus: document.getElementById("sendStatus"),
  sendVaultAvailable: document.getElementById("sendVaultAvailable"),
  sendOnchainBalance: document.getElementById("sendOnchainBalance"),
  vaultPanelAvailable: document.getElementById("vaultPanelAvailable"),
  vaultPanelReserved: document.getElementById("vaultPanelReserved"),
  depositForm: document.getElementById("depositForm"),
  depositAmountInput: document.getElementById("depositAmountInput"),
  depositStatus: document.getElementById("depositStatus"),
  withdrawForm: document.getElementById("withdrawForm"),
  withdrawAmountInput: document.getElementById("withdrawAmountInput"),
  withdrawStatus: document.getElementById("withdrawStatus"),
  walletHistoryBody: document.getElementById("walletHistoryBody"),
  walletHistoryEmpty: document.getElementById("walletHistoryEmpty"),
  settingsForm: document.getElementById("settingsForm"),
  rpcUrlInput: document.getElementById("rpcUrlInput"),
  contractAddressInput: document.getElementById("contractAddressInput"),
  meshtasticPortInput: document.getElementById("meshtasticPortInput"),
  settingsStatus: document.getElementById("settingsStatus"),
  walletInitButton: document.getElementById("walletInitButton"),
  walletSettingsStatus: document.getElementById("walletSettingsStatus"),
  walletResetButton: document.getElementById("walletResetButton"),
  walletCreateBlock: document.getElementById("walletCreateBlock"),
  walletInfoBlock: document.getElementById("walletInfoBlock"),
  walletInfoKv: document.getElementById("walletInfoKv"),
  walletShowSeedButton: document.getElementById("walletShowSeedButton"),
  walletSeedRevealGrid: document.getElementById("walletSeedRevealGrid"),
  walletSeedEyeIcon: document.getElementById("walletSeedEyeIcon"),
  walletSeedEyeOffIcon: document.getElementById("walletSeedEyeOffIcon"),
  walletMnemonicBlock: document.getElementById("walletMnemonicBlock"),
  walletMnemonicGrid: document.getElementById("walletMnemonicGrid"),
  walletMnemonicDoneButton: document.getElementById("walletMnemonicDoneButton")
};

const ui = {
  walletView: "home",
  receiveTab: "wallet",
  sendTab: "notes",
  walletOpen: false,
  state: null,
  lastQrAddress: null,
  mnemonic: localStorage.getItem("radio-note:last-mnemonic") || "",
  seedVisible: false,
  portsOpen: false
};

const esc = (v) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const short = (v) => (!v ? "-" : `${v.slice(0, 10)}...${v.slice(-8)}`);
const fmtTime = (v) => { try { return v ? new Date(v).toLocaleString() : "-"; } catch { return String(v || "-"); } };
const fmtEpoch = (v) => (v ? fmtTime(Number(v) * 1000) : "-");

function setStatus(el, text, tone = "") {
  if (!el) return;
  el.textContent = text || "";
  el.style.color = tone === "success" ? "var(--ui-success)" : tone === "danger" ? "var(--ui-danger)" : tone === "warning" ? "var(--ui-warning)" : "var(--ui-muted)";
}

async function api(url, options = {}) {
  const response = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

const post = (url, body) => api(url, { method: "POST", body: JSON.stringify(body || {}) });

async function copyText(value, statusEl, message) {
  if (!value) return;
  await navigator.clipboard.writeText(value);
  setStatus(statusEl, message || "Copied", "success");
}

function flashCopySuccess(button) {
  if (!button) return;
  const copyIcon = button.querySelector(".copy-icon");
  const checkIcon = button.querySelector(".check-icon");
  button.classList.add("is-copied");
  copyIcon?.classList.add("hidden");
  checkIcon?.classList.remove("hidden");
  window.setTimeout(() => {
    button.classList.remove("is-copied");
    copyIcon?.classList.remove("hidden");
    checkIcon?.classList.add("hidden");
  }, 1000);
}

function setVisible(element, visible) {
  if (!element) return;
  element.hidden = !visible;
  element.classList.toggle("hidden", !visible);
}

function describePort(port) {
  const device = String(port?.device || "").trim();
  const description = String(port?.description || "").trim();
  if (device && description && description !== device) {
    return `${device} | ${description}`;
  }
  return device || description || "Unknown port";
}

function updateWalletPanels() {
  const target = `walletPanel${ui.walletView[0].toUpperCase()}${ui.walletView.slice(1)}`;
  els.walletPanels.forEach((panel) => {
    const active = panel.id === target;
    setVisible(panel, active);
    panel.classList.toggle("is-active", active);
  });
  els.walletQuickButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.walletView === ui.walletView));
}

function updateTabs() {
  const receiveWallet = ui.receiveTab === "wallet";
  els.receiveWalletTab.classList.toggle("is-active", receiveWallet);
  els.receiveNotesTab.classList.toggle("is-active", !receiveWallet);
  setVisible(els.receiveWalletPanel, receiveWallet);
  setVisible(els.receiveNotesPanel, !receiveWallet);
  const sendNotes = ui.sendTab === "notes";
  els.sendNotesTab.classList.toggle("is-active", sendNotes);
  els.sendWalletTab.classList.toggle("is-active", !sendNotes);
  setVisible(els.sendNotesPanel, sendNotes);
  setVisible(els.sendWalletPanel, !sendNotes);
}

function openWallet(view = ui.walletView) {
  ui.walletOpen = true;
  ui.walletView = view;
  updateWalletPanels();
  updateTabs();
  els.walletModal.classList.remove("hidden");
  els.walletModal.setAttribute("aria-hidden", "false");
}

function closeWallet() {
  ui.walletOpen = false;
  els.walletModal.classList.add("hidden");
  els.walletModal.setAttribute("aria-hidden", "true");
}

async function renderQr(address) {
  if (!address) {
    els.walletQrLoading.hidden = false;
    els.walletQrImage.hidden = true;
    els.walletQrLoading.textContent = "Loading QR...";
    ui.lastQrAddress = null;
    return;
  }
  if (ui.lastQrAddress === address && els.walletQrImage.src) {
    els.walletQrLoading.hidden = true;
    els.walletQrImage.hidden = false;
    return;
  }
  els.walletQrLoading.hidden = false;
  els.walletQrImage.hidden = true;
  els.walletQrLoading.textContent = "Loading QR...";
  try {
    const data = await api("/api/wallet/qr");
    ui.lastQrAddress = address;
    els.walletQrImage.src = data.qr;
    els.walletQrLoading.hidden = true;
    els.walletQrImage.hidden = false;
  } catch {
    els.walletQrLoading.textContent = "QR unavailable";
  }
}

function noteTone(note) {
  if (note.status === "redeemed" || note.status === "delivered") return "success";
  if (String(note.status || "").includes("failed") || note.validSignature === false) return "danger";
  if (["ready_to_redeem", "sent_over_mesh", "resent_over_mesh"].includes(note.status)) return "success";
  return "warning";
}

function formatStatusLabel(value) {
  return String(value || "-").replaceAll("_", " ");
}

function getProgressInfo(note) {
  const queued = Number(note.transferQueuedChunks || 0);
  const total = Number(note.transferTotalChunks || 0);
  const sent = total ? Math.min(queued, total) : 0;
  const ratio = total ? Math.round((sent / total) * 100) : 0;
  if (note.status === "delivered" || note.status === "redeemed") {
    return {
      label: total ? `Delivered ${total}/${total} chunks` : "Delivered over mesh",
      current: total || 1,
      total: total || 1,
      percent: 100,
      fillClass: "is-success"
    };
  }
  if (note.status === "sending_over_mesh") {
    return {
      label: total ? `Sending ${sent}/${total} chunks` : "Preparing chunks",
      current: sent,
      total,
      percent: ratio,
      fillClass: "is-warning"
    };
  }
  if (["sent_over_mesh", "resent_over_mesh"].includes(note.status)) {
    return {
      label: total ? `Sent ${sent}/${total} chunks` : "Sent over mesh",
      current: sent,
      total,
      percent: total ? Math.max(ratio, 100) : 100,
      fillClass: "is-success"
    };
  }
  if (note.status === "mesh_send_failed") {
    return {
      label: total ? `Stopped at ${sent}/${total} chunks` : "Mesh send failed",
      current: sent,
      total,
      percent: ratio,
      fillClass: "is-danger"
    };
  }
  return {
    label: total ? `Queued ${sent}/${total} chunks` : "Waiting for send",
    current: sent,
    total,
    percent: ratio,
    fillClass: "is-warning"
  };
}

function activityTone(type) {
  const name = String(type || "");
  if (name.includes("failed") || name.includes("error")) return "danger";
  if (name.includes("redeem") || name.includes("delivered") || name.includes("received") || name.includes("sent")) return "success";
  if (name.includes("cancel")) return "warning";
  return "warning";
}

function formatActivityType(type) {
  const label = String(type || "-").replaceAll("_", " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function describeActivity(item) {
  const type = String(item.type || "");
  if (type === "note_sent") return `${item.amountEth || "-"} ETH to ${item.recipientNodeId || "-"}`;
  if (type === "note_delivered") return `${item.amountEth || "-"} ETH delivered to ${item.recipientNodeId || "-"}`;
  if (type === "note_received") return `${item.amountEth || "-"} ETH from ${item.fromNodeId || "-"}`;
  if (type === "note_redeemed") return `${item.amountEth || "-"} ETH redeemed on-chain`;
  if (type === "note_redeem_submitted") return `${item.amountEth || "-"} ETH redeem submitted`;
  if (type === "note_canceled") return `Expired note canceled`;
  if (type === "note_resent") return `Note resent to ${item.recipientNodeId || "-"}`;
  if (type === "note_ack_failed") return `ACK failed for ${short(String(item.noteId || ""))}`;
  if (type === "wallet_created") return `Local wallet initialized`;
  if (type === "wallet_reset") return `Local wallet reset`;
  const fields = Object.entries(item)
    .filter(([key]) => !["id", "type", "timestamp"].includes(key))
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${String(value)}`);
  return fields.join(" | ") || "-";
}

function getNodeById(nodeId) {
  return (ui.state?.nodes || []).find((node) => node.id === nodeId) || null;
}

function renderRecipientStatus() {
  const walletConfigured = Boolean(ui.state?.wallet?.configured && ui.state?.wallet?.address);
  if (!walletConfigured) {
    setStatus(els.walletRecipientStatus, "Create a local wallet first.", "warning");
    els.walletSendSubmitButton.disabled = true;
    return;
  }
  const nodeId = els.walletRecipientInput.value;
  const node = getNodeById(nodeId);
  if (!nodeId || !node) {
    setStatus(els.walletRecipientStatus, "Pick a node and run Check before sending.", "");
    els.walletSendSubmitButton.disabled = true;
    return;
  }
  if (node.ready && node.addressValid) {
    setStatus(els.walletRecipientStatus, `Ready: ${node.name || node.id} can receive radio notes`, "success");
    els.walletSendSubmitButton.disabled = false;
    return;
  }
  if (node.checkStatus === "pending") {
    setStatus(els.walletRecipientStatus, `Waiting for ${node.name || node.id} to reply...`, "warning");
  } else if (node.checkError) {
    setStatus(els.walletRecipientStatus, node.checkError, "danger");
  } else {
    setStatus(els.walletRecipientStatus, `${node.name || node.id} is not checked yet`, "warning");
  }
  els.walletSendSubmitButton.disabled = true;
}

function renderDevice(state) {
  const mesh = state.meshtastic || {};
  let css = "loading";
  let title = "Checking device";
  let text = mesh.mode || "Bridge startup";
  if (mesh.connected) {
    css = "online";
    title = "Meshtastic connected";
    text = mesh.localNodeId ? `Local node ${mesh.localNodeId}` : "USB serial bridge online";
  } else if (mesh.error) {
    css = "error";
    title = "Meshtastic error";
    text = mesh.error;
  } else if (mesh.mode === "offline") {
    css = "offline";
    title = "Meshtastic offline";
    text = mesh.selectedPort ? `Waiting for ${mesh.selectedPort}` : "No USB device detected";
  }
  els.deviceStatus.className = `device-status ${css}`;
  els.deviceStatusTitle.textContent = title;
  els.deviceStatusText.textContent = text;
  setStatus(els.runtimeError, mesh.error || state.wallet?.error || "", mesh.error || state.wallet?.error ? "danger" : "");
  els.walletMeshtasticStatus.textContent = mesh.connected ? "Connected" : mesh.mode || "Offline";
  els.walletMeshtasticStatus.className = mesh.connected ? "status-ok" : mesh.error ? "status-err" : "";

  const ports = Array.isArray(mesh.ports) ? mesh.ports : [];
  const selected = mesh.selectedPort || state.settings?.meshtasticPort || "";
  const current = els.portSwitcherSelect.value;
  const options = ['<option value="">Auto detect</option>']
    .concat(ports.map((port) => `<option value="${esc(port.device || "")}">${esc(describePort(port))}</option>`))
    .join("");
  els.portSwitcherSelect.innerHTML = options;
  const preferred = [current, selected, ""].find((value) => [...els.portSwitcherSelect.options].some((option) => option.value === value)) || "";
  els.portSwitcherSelect.value = preferred;
  setVisible(els.portSwitcher, ui.portsOpen);
  setStatus(els.portSwitcherStatus, selected ? `Current: ${selected}` : "Current: Auto detect", "");
}

function renderNodes(nodes) {
  const online = nodes.filter((n) => n.online);
  const offline = nodes.filter((n) => !n.online);
  els.nodesOnlineCount.textContent = `${online.length}/${nodes.length} online`;
  if (!nodes.length) {
    els.nodesList.innerHTML = '<div class="node-empty">No Meshtastic nodes yet</div>';
    return;
  }
  const block = (title, list) => !list.length ? "" : `
    <section class="node-group">
      <div class="node-group-title">${title}</div>
      ${list.map((node) => `
        <article class="node-card ${node.ready ? "node-card-ready" : ""}">
          <div class="node-card-header">
            <div class="node-card-main">
              <div class="node-name">${esc(node.name || node.id)}</div>
              <div class="node-id">${esc(node.shortName || node.id)}</div>
            </div>
            <span class="node-status-badge ${node.ready ? "is-success" : node.online ? "is-success" : "is-warning"}">${node.ready ? "ready" : node.online ? "online" : "offline"}</span>
          </div>
          <div class="node-wallet">${esc(node.address ? `${short(node.address)}${node.addressValid ? "" : " (unverified)"}` : "No wallet announcement")}</div>
          <div class="node-meta">Node ID: ${esc(node.id)}</div>
          <div class="node-meta">Announced: ${esc(node.announcedAt ? fmtEpoch(node.announcedAt) : "none")}</div>
          ${node.lastHeard ? `<div class="node-meta">Last heard: ${esc(fmtEpoch(node.lastHeard))}</div>` : ""}
        </article>`).join("")}
    </section>`;
  els.nodesList.innerHTML = `${block("Online", online)}${block("Offline", offline)}`;
}

function renderRecipients(nodes) {
  const current = els.walletRecipientInput.value;
  const online = nodes.filter((n) => n.online && n.address && n.addressValid);
  const offline = nodes.filter((n) => !n.online && n.address && n.addressValid);
  const out = ['<option value="">Select node</option>'];
  if (online.length) {
    out.push('<optgroup label="Online">');
    online.forEach((n) => out.push(`<option value="${esc(n.id)}">${esc(n.name || n.id)} | ${esc(short(n.address))}</option>`));
    out.push("</optgroup>");
  }
  if (offline.length) {
    out.push('<optgroup label="Offline">');
    offline.forEach((n) => out.push(`<option value="${esc(n.id)}">${esc(n.name || n.id)} | ${esc(short(n.address))}</option>`));
    out.push("</optgroup>");
  }
  els.walletRecipientInput.innerHTML = out.join("");
  if ([...els.walletRecipientInput.options].some((o) => o.value === current)) els.walletRecipientInput.value = current;
}

function renderSeedGrid() {
  const words = (ui.mnemonic || "").trim().split(/\s+/).filter(Boolean);
  const visible = ui.seedVisible && words.length >= 12;
  els.walletSeedRevealGrid.classList.toggle("hidden", !visible);
  els.walletSeedEyeIcon.classList.toggle("hidden", visible);
  els.walletSeedEyeOffIcon.classList.toggle("hidden", !visible);
  if (!visible) return;
  els.walletSeedRevealGrid.innerHTML = words.map((word, index) => `<div class="wallet-mnemonic-word"><span class="wallet-mnemonic-num">${index + 1}</span><span>${esc(word)}</span></div>`).join("");
}

async function ensureMnemonicLoaded() {
  if ((ui.mnemonic || "").trim().split(/\s+/).filter(Boolean).length >= 12) {
    return true;
  }
  try {
    const data = await api("/api/wallet/seed");
    ui.mnemonic = data.mnemonic || "";
    if (ui.mnemonic) {
      localStorage.setItem("radio-note:last-mnemonic", ui.mnemonic);
    }
  } catch {
    return false;
  }
  return (ui.mnemonic || "").trim().split(/\s+/).filter(Boolean).length >= 12;
}

async function renderWallet(state) {
  const wallet = state.wallet || {};
  const mesh = state.meshtastic || {};
  const ok = Boolean(wallet.configured && wallet.address);
  const address = wallet.address || "";
  const onchain = wallet.onchainBalanceEth == null ? "-" : `${wallet.onchainBalanceEth} ETH`;
  const available = wallet.availableLockedEth == null ? "-" : `${wallet.availableLockedEth} ETH`;
  const reserved = wallet.reservedLockedEth == null ? "-" : `${wallet.reservedLockedEth} ETH`;
  els.heroWalletAddress.textContent = ok ? short(address) : "Not configured";
  els.heroOnchain.textContent = onchain;
  els.heroVaultAvailable.textContent = available;
  els.heroVaultReserved.textContent = reserved;
  els.walletEngineStatus.textContent = ok ? "Configured" : "Not configured";
  els.walletEngineStatus.className = ok ? "status-ok" : "";
  els.walletReceivePreview.textContent = ok ? address : "Not configured";
  els.walletReceiveId.value = address;
  els.onchainBalanceValue.textContent = onchain;
  els.vaultAvailableBalanceValue.textContent = available;
  els.vaultAvailableSub.textContent = ok ? "Ready to commit into radio notes" : "Create a wallet and fund it with Sepolia ETH";
  els.walletBalanceSub.textContent = mesh.connected ? "Local wallet, contract signer, mesh announcement source" : "Local EVM wallet balance";
  els.sendVaultAvailable.textContent = available;
  els.sendOnchainBalance.textContent = onchain;
  els.vaultPanelAvailable.textContent = available;
  els.vaultPanelReserved.textContent = reserved;
  setVisible(els.walletHomeNoWallet, !ok);
  setVisible(els.walletHomeSummary, ok);
  setVisible(els.walletReceiveNoWallet, !ok);
  setVisible(els.walletReceiveContent, ok);
  setVisible(els.walletCreateBlock, !ok);
  setVisible(els.walletInfoBlock, ok);
  els.walletCopyAddressButton.disabled = !ok;
  els.walletCopyReceiveIdButton.disabled = !ok;
  els.walletSendSubmitButton.disabled = !ok;
  els.walletResetButton.disabled = !ok;
  els.walletInfoKv.innerHTML = [
    ["Address", address || "-"],
    ["Network", "Sepolia"],
    ["On-chain", onchain],
    ["Vault", ok ? `${available} / ${reserved}` : "-"],
    ["Local node", mesh.localNodeId || "-"],
    ["Contract", state.settings?.contractAddress || "-"]
  ].map(([k, v]) => `<div class="wallet-kv-row"><span class="wallet-k">${esc(k)}</span><span class="wallet-v">${esc(v)}</span></div>`).join("");
  const canReveal = await ensureMnemonicLoaded();
  els.walletShowSeedButton.disabled = !canReveal;
  if (!canReveal) ui.seedVisible = false;
  renderSeedGrid();
  await renderQr(address);
}

function renderReceivedNotes(notes) {
  if (!notes.length) {
    els.receivedNotesList.innerHTML = '<div class="node-empty">No radio notes received.</div>';
    return;
  }
  els.receivedNotesList.innerHTML = notes.map((note) => {
    const canRedeem = note.status === "ready_to_redeem" && note.validSignature && note.walletMatches;
    return `
      <article class="wallet-note-card">
        <div class="wallet-note-head">
          <div class="wallet-note-title">${esc(note.amountEth)} ETH</div>
          <span class="wallet-note-badge ${noteTone(note) === "danger" ? "is-danger" : noteTone(note) === "success" ? "is-success" : "is-warning"}">${esc(note.status)}</span>
        </div>
        <div class="wallet-note-meta">From node: ${esc(note.senderNodeId)}</div>
        <div class="wallet-note-meta">Issuer: ${esc(short(note.issuer))}</div>
        <div class="wallet-note-meta">Recipient: ${esc(short(note.recipient))}</div>
        <div class="wallet-note-meta">Expires: ${esc(fmtEpoch(note.expiry))}</div>
        <div class="wallet-note-meta">Signature: ${note.validSignature ? "valid" : "invalid"}</div>
        ${note.memo ? `<div class="wallet-note-memo">Memo: ${esc(note.memo)}</div>` : ""}
        <div class="wallet-note-actions"><button type="button" data-note-action="redeem" data-note-id="${esc(note.noteId)}" ${canRedeem ? "" : "disabled"}>Redeem</button></div>
      </article>`;
  }).join("");
}

function renderCreatedNotes(notes) {
  if (!notes.length) {
    els.createdNotesList.innerHTML = '<div class="node-empty">No notes created yet.</div>';
    return;
  }
  els.createdNotesList.innerHTML = notes.map((note) => {
    const tone = noteTone(note);
    const canCancel = ["committed", "mesh_send_failed", "sending_over_mesh", "sent_over_mesh", "resent_over_mesh", "cancel_submitted", "delivered"].includes(note.status);
    const canResend = Boolean(note.payload) && ["committed", "mesh_send_failed", "sent_over_mesh", "resent_over_mesh"].includes(note.status);
    const progress = getProgressInfo(note);
    const chunkInfo = progress.total ? `${progress.current}/${progress.total}` : "-";
    return `
      <article class="wallet-note-card">
        <div class="wallet-note-head">
          <div class="wallet-note-title">${esc(note.amountEth)} ETH</div>
          <span class="wallet-note-badge ${tone === "danger" ? "is-danger" : tone === "success" ? "is-success" : "is-warning"}">${esc(formatStatusLabel(note.status))}</span>
        </div>
        <div class="wallet-note-progress">
          <div class="wallet-note-progress-head">
            <span>${esc(progress.label)}</span>
            <strong>${esc(chunkInfo)}</strong>
          </div>
          <div class="wallet-progress-track">
            <div class="wallet-progress-fill ${esc(progress.fillClass)}" style="width:${Math.max(0, Math.min(progress.percent, 100))}%"></div>
          </div>
        </div>
        <div class="wallet-note-meta">To node: ${esc(note.recipientNodeId)}</div>
        <div class="wallet-note-meta">Recipient: ${esc(short(note.recipientAddress))}</div>
        <div class="wallet-note-meta">Expires: ${esc(fmtEpoch(note.expiry))}</div>
        <div class="wallet-note-meta">Note ID: ${esc(short(note.noteId))}</div>
        <div class="wallet-note-meta">Chunks: ${esc(chunkInfo)}</div>
        ${note.deliveredAt ? `<div class="wallet-note-meta">Delivered: ${esc(fmtTime(note.deliveredAt))}</div>` : ""}
        ${note.memo ? `<div class="wallet-note-memo">Memo: ${esc(note.memo)}</div>` : ""}
        <div class="wallet-note-actions">
          <button type="button" data-note-action="resend" data-note-id="${esc(note.noteId)}" ${canResend ? "" : "disabled"}>Resend</button>
          <button type="button" data-note-action="cancel" data-note-id="${esc(note.noteId)}" ${canCancel ? "" : "disabled"}>Cancel</button>
        </div>
      </article>`;
  }).join("");
}

function renderHistory(activity) {
  if (!activity.length) {
    els.walletHistoryBody.innerHTML = "";
    els.walletHistoryEmpty.classList.remove("hidden");
    return;
  }
  els.walletHistoryEmpty.classList.add("hidden");
  els.walletHistoryBody.innerHTML = activity.slice(0, 80).map((item) => {
    const tone = activityTone(item.type);
    const badgeClass = tone === "danger" ? "is-danger" : tone === "success" ? "is-success" : "is-warning";
    return `
      <tr>
        <td><span class="wallet-history-badge ${badgeClass}">${esc(formatActivityType(item.type))}</span></td>
        <td>
          <div class="wallet-history-detail">${esc(describeActivity(item))}</div>
          ${item.noteId ? `<div class="wallet-history-sub">${esc(short(String(item.noteId)))}</div>` : ""}
        </td>
        <td>${esc(fmtTime(item.timestamp))}</td>
      </tr>`;
  }).join("");
}

function renderSettings(state) {
  const settings = state.settings || {};
  if (document.activeElement !== els.rpcUrlInput) els.rpcUrlInput.value = settings.rpcUrl || "";
  if (document.activeElement !== els.contractAddressInput) els.contractAddressInput.value = settings.contractAddress || "";
  if (document.activeElement !== els.meshtasticPortInput) els.meshtasticPortInput.value = settings.meshtasticPort || "";
}

async function renderState(state) {
  ui.state = state;
  renderDevice(state);
  renderNodes(state.nodes || []);
  renderRecipients(state.nodes || []);
  renderRecipientStatus();
  renderReceivedNotes(state.receivedNotes || []);
  renderCreatedNotes(state.createdNotes || []);
  renderHistory(state.activity || []);
  renderSettings(state);
  await renderWallet(state);
}

async function loadState() {
  const state = await api("/api/state");
  await renderState(state);
}

function showMnemonic(words) {
  const list = String(words || "").trim().split(/\s+/).filter(Boolean);
  if (!list.length) return;
  els.walletMnemonicGrid.innerHTML = list.map((word, index) => `<div class="wallet-mnemonic-word"><span class="wallet-mnemonic-num">${index + 1}</span><span>${esc(word)}</span></div>`).join("");
  els.walletMnemonicBlock.classList.remove("hidden");
}

els.refreshButton?.addEventListener("click", async () => {
  try {
    setStatus(els.runtimeError, "Refreshing state...", "warning");
    await loadState();
  } catch (error) {
    setStatus(els.runtimeError, error.message, "danger");
  }
});

els.deviceStatus?.addEventListener("click", () => {
  ui.portsOpen = !ui.portsOpen;
  setVisible(els.portSwitcher, ui.portsOpen);
});

els.portSwitcherConnectButton?.addEventListener("click", async () => {
  try {
    setStatus(els.portSwitcherStatus, "Reconnecting Meshtastic bridge...", "warning");
    await post("/api/meshtastic/connect", {
      meshtasticPort: els.portSwitcherSelect.value
    });
    setStatus(els.portSwitcherStatus, "Reconnect requested", "success");
    await loadState();
  } catch (error) {
    setStatus(els.portSwitcherStatus, error.message, "danger");
  }
});

els.openWalletButton?.addEventListener("click", () => openWallet("home"));
els.heroOpenWalletButton?.addEventListener("click", () => openWallet("home"));
els.walletHomeCreateButton?.addEventListener("click", () => openWallet("settings"));
els.walletModalClose?.addEventListener("click", closeWallet);
els.walletModal?.addEventListener("click", (event) => {
  if (event.target instanceof HTMLElement && event.target.hasAttribute("data-close-wallet-modal")) closeWallet();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && ui.walletOpen) closeWallet();
});

els.walletQuickButtons.forEach((button) => button.addEventListener("click", () => {
  ui.walletView = button.dataset.walletView || "home";
  updateWalletPanels();
}));

document.querySelectorAll("[data-wallet-view]").forEach((button) => button.addEventListener("click", () => {
  ui.walletView = button.dataset.walletView || "home";
  openWallet(ui.walletView);
}));

els.receiveWalletTab?.addEventListener("click", () => { ui.receiveTab = "wallet"; updateTabs(); });
els.receiveNotesTab?.addEventListener("click", () => { ui.receiveTab = "notes"; updateTabs(); });
els.sendNotesTab?.addEventListener("click", () => { ui.sendTab = "notes"; updateTabs(); });
els.sendWalletTab?.addEventListener("click", () => { ui.sendTab = "wallet"; updateTabs(); });
els.walletRecipientInput?.addEventListener("change", () => {
  renderRecipientStatus();
});

els.walletCheckRecipientButton?.addEventListener("click", async () => {
  const recipientNodeId = els.walletRecipientInput.value;
  if (!recipientNodeId) {
    setStatus(els.walletRecipientStatus, "Select recipient node first", "warning");
    return;
  }
  try {
    setStatus(els.walletRecipientStatus, `Checking ${recipientNodeId}...`, "warning");
    await post("/api/notes/check-recipient", { recipientNodeId });
    setStatus(els.walletRecipientStatus, "Handshake request sent. Waiting for reply...", "warning");
    await loadState();
  } catch (error) {
    setStatus(els.walletRecipientStatus, error.message, "danger");
  }
});

els.walletCopyAddressButton?.addEventListener("click", async () => {
  await copyText(ui.state?.wallet?.address, els.runtimeError, "Address copied");
  flashCopySuccess(els.walletCopyAddressButton);
});

els.walletCopyReceiveIdButton?.addEventListener("click", async () => {
  await copyText(ui.state?.wallet?.address, els.runtimeError, "Address copied");
  flashCopySuccess(els.walletCopyReceiveIdButton);
});

els.settingsForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    setStatus(els.settingsStatus, "Saving settings...", "warning");
    await post("/api/settings", {
      rpcUrl: els.rpcUrlInput.value.trim(),
      contractAddress: els.contractAddressInput.value.trim(),
      meshtasticPort: els.meshtasticPortInput.value.trim()
    });
    setStatus(els.settingsStatus, "Settings saved", "success");
    await loadState();
  } catch (error) {
    setStatus(els.settingsStatus, error.message, "danger");
  }
});

els.walletInitButton?.addEventListener("click", async () => {
  try {
    setStatus(els.walletSettingsStatus, "Creating wallet...", "warning");
    const data = await post("/api/wallet/create", {});
    ui.mnemonic = data.mnemonic || "";
    if (ui.mnemonic) localStorage.setItem("radio-note:last-mnemonic", ui.mnemonic);
    setStatus(els.walletSettingsStatus, "Wallet created", "success");
    showMnemonic(ui.mnemonic);
    await loadState();
  } catch (error) {
    setStatus(els.walletSettingsStatus, error.message, "danger");
  }
});

els.walletResetButton?.addEventListener("click", async () => {
  if (!confirm("Delete the local wallet from this app?")) return;
  try {
    setStatus(els.walletSettingsStatus, "Deleting wallet...", "warning");
    await post("/api/wallet/reset", {});
    ui.mnemonic = "";
    ui.seedVisible = false;
    localStorage.removeItem("radio-note:last-mnemonic");
    setStatus(els.walletSettingsStatus, "Wallet deleted", "success");
    await loadState();
  } catch (error) {
    setStatus(els.walletSettingsStatus, error.message, "danger");
  }
});

els.walletShowSeedButton?.addEventListener("click", () => {
  ensureMnemonicLoaded().then((ok) => {
    if (!ok) {
      setStatus(els.walletSettingsStatus, "Seed phrase is not available", "warning");
      return;
    }
    ui.seedVisible = !ui.seedVisible;
    renderSeedGrid();
  }).catch((error) => {
    setStatus(els.walletSettingsStatus, error.message, "danger");
  });
});

els.walletMnemonicDoneButton?.addEventListener("click", () => {
  els.walletMnemonicBlock.classList.add("hidden");
});

els.sendOnchainForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    setStatus(els.sendStatus, "Submitting transaction...", "warning");
    const data = await post("/api/wallet/send", { to: els.sendAddressInput.value.trim(), amountEth: els.sendAmountInput.value.trim() });
    setStatus(els.sendStatus, `Submitted ${short(data.txHash)}`, "success");
    els.sendOnchainForm.reset();
    await loadState();
  } catch (error) {
    setStatus(els.sendStatus, error.message, "danger");
  }
});

els.depositForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    setStatus(els.depositStatus, "Depositing into vault...", "warning");
    const data = await post("/api/vault/deposit", { amountEth: els.depositAmountInput.value.trim() });
    setStatus(els.depositStatus, `Submitted ${short(data.txHash)}`, "success");
    els.depositForm.reset();
    await loadState();
  } catch (error) {
    setStatus(els.depositStatus, error.message, "danger");
  }
});

els.withdrawForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    setStatus(els.withdrawStatus, "Withdrawing from vault...", "warning");
    const data = await post("/api/vault/withdraw", { amountEth: els.withdrawAmountInput.value.trim() });
    setStatus(els.withdrawStatus, `Submitted ${short(data.txHash)}`, "success");
    els.withdrawForm.reset();
    await loadState();
  } catch (error) {
    setStatus(els.withdrawStatus, error.message, "danger");
  }
});

els.walletSendForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    setStatus(els.walletSendStatus, "Committing note and sending over mesh...", "warning");
    await post("/api/notes/create", {
      recipientNodeId: els.walletRecipientInput.value,
      amountEth: els.walletAmountInput.value.trim(),
      expiryMinutes: Number(els.walletExpiryInput.value || 60),
      memo: els.walletMemoInput.value.trim()
    });
    setStatus(els.walletSendStatus, "Radio note created", "success");
    els.walletSendForm.reset();
    els.walletExpiryInput.value = "60";
    await loadState();
  } catch (error) {
    setStatus(els.walletSendStatus, error.message, "danger");
  }
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-note-action]");
  if (!button) return;
  const action = button.getAttribute("data-note-action");
  const noteId = button.getAttribute("data-note-id");
  if (!action || !noteId) return;
  try {
    if (action === "redeem") {
      setStatus(els.runtimeError, "Redeeming note...", "warning");
      const data = await post("/api/notes/redeem", { noteId });
      setStatus(els.runtimeError, `Redeem submitted ${short(data.txHash)}`, "success");
    } else if (action === "resend") {
      setStatus(els.runtimeError, "Resending note...", "warning");
      await post("/api/notes/resend", { noteId });
      setStatus(els.runtimeError, "Note resent", "success");
    } else if (action === "cancel") {
      setStatus(els.runtimeError, "Canceling note...", "warning");
      const data = await post("/api/notes/cancel", { noteId });
      setStatus(els.runtimeError, `Cancel submitted ${short(data.txHash)}`, "success");
    }
    await loadState();
  } catch (error) {
    setStatus(els.runtimeError, error.message, "danger");
  }
});

updateWalletPanels();
updateTabs();
loadState().catch((error) => setStatus(els.runtimeError, error.message, "danger"));
setInterval(() => {
  loadState().catch((error) => setStatus(els.runtimeError, error.message, "danger"));
}, 10000);
