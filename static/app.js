const els = {
  meshBadge: document.getElementById("meshBadge"),
  walletBadge: document.getElementById("walletBadge"),
  meshStatusText: document.getElementById("meshStatusText"),
  localNodeId: document.getElementById("localNodeId"),
  runtimeError: document.getElementById("runtimeError"),
  refreshButton: document.getElementById("refreshButton"),
  settingsForm: document.getElementById("settingsForm"),
  rpcUrlInput: document.getElementById("rpcUrlInput"),
  contractAddressInput: document.getElementById("contractAddressInput"),
  meshtasticPortInput: document.getElementById("meshtasticPortInput"),
  autoAnnounceInput: document.getElementById("autoAnnounceInput"),
  settingsStatus: document.getElementById("settingsStatus"),
  announceButton: document.getElementById("announceButton"),
  nodesList: document.getElementById("nodesList"),
  walletAddressPreview: document.getElementById("walletAddressPreview"),
  onchainBalanceValue: document.getElementById("onchainBalanceValue"),
  vaultAvailableValue: document.getElementById("vaultAvailableValue"),
  vaultReservedValue: document.getElementById("vaultReservedValue"),
  walletMissing: document.getElementById("walletMissing"),
  createWalletButton: document.getElementById("createWalletButton"),
  copyAddressButton: document.getElementById("copyAddressButton"),
  mnemonicCard: document.getElementById("mnemonicCard"),
  walletAddressText: document.getElementById("walletAddressText"),
  walletQr: document.getElementById("walletQr"),
  onchainSendForm: document.getElementById("onchainSendForm"),
  sendAddressInput: document.getElementById("sendAddressInput"),
  sendAmountInput: document.getElementById("sendAmountInput"),
  sendStatus: document.getElementById("sendStatus"),
  depositForm: document.getElementById("depositForm"),
  depositAmountInput: document.getElementById("depositAmountInput"),
  withdrawForm: document.getElementById("withdrawForm"),
  withdrawAmountInput: document.getElementById("withdrawAmountInput"),
  vaultStatus: document.getElementById("vaultStatus"),
  noteForm: document.getElementById("noteForm"),
  recipientSelect: document.getElementById("recipientSelect"),
  noteAmountInput: document.getElementById("noteAmountInput"),
  noteExpiryInput: document.getElementById("noteExpiryInput"),
  noteMemoInput: document.getElementById("noteMemoInput"),
  noteStatus: document.getElementById("noteStatus"),
  receivedNotesList: document.getElementById("receivedNotesList"),
  createdNotesList: document.getElementById("createdNotesList"),
  activityList: document.getElementById("activityList")
};

let latestState = null;

function formatAddress(value) {
  if (!value) return "-";
  return `${value.slice(0, 10)}...${value.slice(-8)}`;
}

function formatTime(value) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function epochToLocale(seconds) {
  if (!seconds) return "-";
  return new Date(seconds * 1000).toLocaleString();
}

function setNotice(el, text, cls = "") {
  if (!el) return;
  el.textContent = text;
  el.className = `notice ${cls}`.trim();
  el.classList.remove("hidden");
}

function clearNotice(el) {
  if (!el) return;
  el.textContent = "";
  el.className = "notice hidden";
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json"
    },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

function renderState(state) {
  latestState = state;
  renderRuntime(state);
  renderSettings(state);
  renderWallet(state);
  renderNodes(state.nodes || []);
  renderRecipients(state.nodes || []);
  renderReceivedNotes(state.receivedNotes || []);
  renderCreatedNotes(state.createdNotes || []);
  renderActivity(state.activity || []);
}

function renderRuntime(state) {
  const mesh = state.meshtastic || {};
  const wallet = state.wallet || {};
  const meshClass = mesh.connected ? "ok" : mesh.error ? "err" : "warn";
  els.meshBadge.textContent = mesh.connected ? "Mesh connected" : "Mesh offline";
  els.meshBadge.className = `status-badge ${meshClass}`;
  els.walletBadge.textContent = wallet.configured ? "Wallet ready" : "No wallet";
  els.walletBadge.className = `status-badge ${wallet.configured ? "ok" : "warn"}`;
  els.meshStatusText.textContent = mesh.connected ? "Connected" : mesh.mode || "Offline";
  els.localNodeId.textContent = mesh.localNodeId || "-";
  if (mesh.error) {
    setNotice(els.runtimeError, mesh.error, "notice-danger");
  } else {
    clearNotice(els.runtimeError);
  }
}

function renderSettings(state) {
  const settings = state.settings || {};
  els.rpcUrlInput.value = settings.rpcUrl || "";
  els.contractAddressInput.value = settings.contractAddress || "";
  els.meshtasticPortInput.value = settings.meshtasticPort || "";
  els.autoAnnounceInput.checked = settings.autoAnnounce !== false;
}

function renderWallet(state) {
  const wallet = state.wallet || {};
  els.walletAddressPreview.textContent = wallet.address || "Not configured";
  els.walletAddressText.textContent = wallet.address || "-";
  els.onchainBalanceValue.textContent = wallet.onchainBalanceEth == null ? "-" : `${wallet.onchainBalanceEth} ETH`;
  els.vaultAvailableValue.textContent = wallet.availableLockedEth == null ? "-" : `${wallet.availableLockedEth} ETH`;
  els.vaultReservedValue.textContent = wallet.reservedLockedEth == null ? "-" : `${wallet.reservedLockedEth} ETH`;
  els.walletMissing.classList.toggle("hidden", Boolean(wallet.configured));
  els.copyAddressButton.disabled = !wallet.address;

  if (!wallet.address) {
    els.walletQr.classList.add("hidden");
    return;
  }

  fetchJson("/api/wallet/qr")
    .then((data) => {
      els.walletQr.src = data.qr;
      els.walletQr.classList.remove("hidden");
    })
    .catch(() => {
      els.walletQr.classList.add("hidden");
    });
}

function renderNodes(nodes) {
  if (!nodes.length) {
    els.nodesList.innerHTML = '<div class="empty">No Meshtastic nodes yet.</div>';
    return;
  }
  els.nodesList.innerHTML = nodes
    .map((node) => `
      <div class="node-card">
        <div class="node-head">
          <div class="node-title">${node.name || node.id}</div>
          <span class="status-badge ${node.online ? "ok" : "warn"}">${node.online ? "online" : "offline"}</span>
        </div>
        <div class="node-meta">Node ID: ${node.id}</div>
        <div class="node-meta">Last announcement: ${node.announcedAt ? epochToLocale(node.announcedAt) : "none"}</div>
        <div class="node-wallet">${node.address ? node.address : "No verified wallet announcement"}</div>
      </div>
    `)
    .join("");
}

function renderRecipients(nodes) {
  const options = nodes.filter((node) => node.address && node.addressValid);
  const current = els.recipientSelect.value;
  const html = ['<option value="">Select Meshtastic node</option>']
    .concat(
      options.map(
        (node) =>
          `<option value="${node.id}">${node.name || node.id} | ${formatAddress(node.address)}</option>`
      )
    )
    .join("");
  els.recipientSelect.innerHTML = html;
  if ([...els.recipientSelect.options].some((option) => option.value === current)) {
    els.recipientSelect.value = current;
  }
}

function renderReceivedNotes(notes) {
  if (!notes.length) {
    els.receivedNotesList.innerHTML = '<div class="empty">No radio notes received.</div>';
    return;
  }
  els.receivedNotesList.innerHTML = notes
    .map((note) => {
      const canRedeem = note.status === "ready_to_redeem" && note.validSignature && note.walletMatches;
      return `
        <div class="note-card">
          <div class="note-head">
            <div class="note-title">${note.amountEth} ETH</div>
            <span class="status-badge ${canRedeem ? "ok" : note.status === "redeemed" ? "ok" : "warn"}">${note.status}</span>
          </div>
          <div class="note-meta">From node: ${note.senderNodeId}</div>
          <div class="note-meta">Issuer: ${formatAddress(note.issuer)}</div>
          <div class="note-meta">Expires: ${epochToLocale(note.expiry)}</div>
          <div class="note-meta">Signature: ${note.validSignature ? "valid" : "invalid"}</div>
          <div class="note-actions">
            <button type="button" data-action="redeem" data-note-id="${note.noteId}" ${canRedeem ? "" : "disabled"}>Redeem</button>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderCreatedNotes(notes) {
  if (!notes.length) {
    els.createdNotesList.innerHTML = '<div class="empty">No notes created yet.</div>';
    return;
  }
  els.createdNotesList.innerHTML = notes
    .map(
      (note) => `
        <div class="note-card">
          <div class="note-head">
            <div class="note-title">${note.amountEth} ETH</div>
            <span class="status-badge ${note.status.includes("failed") ? "err" : "warn"}">${note.status}</span>
          </div>
          <div class="note-meta">To node: ${note.recipientNodeId}</div>
          <div class="note-meta">Recipient: ${formatAddress(note.recipientAddress)}</div>
          <div class="note-meta">Expiry: ${epochToLocale(note.expiry)}</div>
          <div class="note-meta">Note ID: ${note.noteId}</div>
          <div class="note-actions">
            <button type="button" data-action="resend" data-note-id="${note.noteId}">Resend</button>
            <button type="button" data-action="cancel" data-note-id="${note.noteId}">Cancel expired</button>
          </div>
        </div>
      `
    )
    .join("");
}

function renderActivity(activity) {
  if (!activity.length) {
    els.activityList.innerHTML = '<div class="empty">No activity yet.</div>';
    return;
  }
  els.activityList.innerHTML = activity
    .map(
      (item) => `
        <div class="activity-item">
          <div class="activity-title">${item.type.replaceAll("_", " ")}</div>
          <div class="activity-meta">${formatTime(item.timestamp)}</div>
          <div class="activity-meta">${Object.entries(item)
            .filter(([key]) => !["id", "type", "timestamp"].includes(key))
            .slice(0, 3)
            .map(([key, value]) => `${key}: ${value}`)
            .join(" | ")}</div>
        </div>
      `
    )
    .join("");
}

async function refreshState() {
  const state = await fetchJson("/api/state");
  renderState(state);
}

els.refreshButton.addEventListener("click", () => {
  refreshState().catch((error) => setNotice(els.runtimeError, error.message, "notice-danger"));
});

els.settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearNotice(els.settingsStatus);
  try {
    await fetchJson("/api/settings", {
      method: "POST",
      body: JSON.stringify({
        rpcUrl: els.rpcUrlInput.value.trim(),
        contractAddress: els.contractAddressInput.value.trim(),
        meshtasticPort: els.meshtasticPortInput.value.trim(),
        autoAnnounce: els.autoAnnounceInput.checked
      })
    });
    setNotice(els.settingsStatus, "Settings saved. Bridge restarted.", "notice-success");
    await refreshState();
  } catch (error) {
    setNotice(els.settingsStatus, error.message, "notice-danger");
  }
});

els.announceButton.addEventListener("click", async () => {
  try {
    await fetchJson("/api/meshtastic/announce", { method: "POST" });
    setNotice(els.settingsStatus, "Announcement queued.", "notice-success");
    await refreshState();
  } catch (error) {
    setNotice(els.settingsStatus, error.message, "notice-danger");
  }
});

els.createWalletButton.addEventListener("click", async () => {
  try {
    const data = await fetchJson("/api/wallet/create", { method: "POST" });
    els.mnemonicCard.textContent = `Seed phrase:\n${data.mnemonic}\n\nStore it offline. Anyone with this phrase controls the wallet.`;
    els.mnemonicCard.classList.remove("hidden");
    await refreshState();
  } catch (error) {
    setNotice(els.sendStatus, error.message, "notice-danger");
  }
});

els.copyAddressButton.addEventListener("click", async () => {
  if (!latestState?.wallet?.address) return;
  await navigator.clipboard.writeText(latestState.wallet.address);
  setNotice(els.sendStatus, "Wallet address copied.", "notice-success");
});

els.onchainSendForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const data = await fetchJson("/api/wallet/send", {
      method: "POST",
      body: JSON.stringify({
        to: els.sendAddressInput.value.trim(),
        amountEth: els.sendAmountInput.value.trim()
      })
    });
    setNotice(els.sendStatus, `On-chain tx submitted: ${data.txHash}`, "notice-success");
    els.sendAmountInput.value = "";
    await refreshState();
  } catch (error) {
    setNotice(els.sendStatus, error.message, "notice-danger");
  }
});

els.depositForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const data = await fetchJson("/api/vault/deposit", {
      method: "POST",
      body: JSON.stringify({ amountEth: els.depositAmountInput.value.trim() })
    });
    setNotice(els.vaultStatus, `Deposit tx submitted: ${data.txHash}`, "notice-success");
    els.depositAmountInput.value = "";
    await refreshState();
  } catch (error) {
    setNotice(els.vaultStatus, error.message, "notice-danger");
  }
});

els.withdrawForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const data = await fetchJson("/api/vault/withdraw", {
      method: "POST",
      body: JSON.stringify({ amountEth: els.withdrawAmountInput.value.trim() })
    });
    setNotice(els.vaultStatus, `Withdraw tx submitted: ${data.txHash}`, "notice-success");
    els.withdrawAmountInput.value = "";
    await refreshState();
  } catch (error) {
    setNotice(els.vaultStatus, error.message, "notice-danger");
  }
});

els.noteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const data = await fetchJson("/api/notes/create", {
      method: "POST",
      body: JSON.stringify({
        recipientNodeId: els.recipientSelect.value,
        amountEth: els.noteAmountInput.value.trim(),
        expiryMinutes: Number(els.noteExpiryInput.value),
        memo: els.noteMemoInput.value.trim()
      })
    });
    setNotice(els.noteStatus, `Note committed: ${data.note.noteId}`, "notice-success");
    els.noteAmountInput.value = "";
    els.noteMemoInput.value = "";
    await refreshState();
  } catch (error) {
    setNotice(els.noteStatus, error.message, "notice-danger");
  }
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const noteId = button.dataset.noteId;
  const action = button.dataset.action;
  try {
    if (action === "redeem") {
      await fetchJson("/api/notes/redeem", {
        method: "POST",
        body: JSON.stringify({ noteId })
      });
      setNotice(els.noteStatus, `Redeem submitted for ${noteId}`, "notice-success");
    } else if (action === "resend") {
      await fetchJson("/api/notes/resend", {
        method: "POST",
        body: JSON.stringify({ noteId })
      });
      setNotice(els.noteStatus, `Note resent for ${noteId}`, "notice-success");
    } else if (action === "cancel") {
      await fetchJson("/api/notes/cancel", {
        method: "POST",
        body: JSON.stringify({ noteId })
      });
      setNotice(els.noteStatus, `Cancel submitted for ${noteId}`, "notice-success");
    }
    await refreshState();
  } catch (error) {
    setNotice(els.noteStatus, error.message, "notice-danger");
  }
});

refreshState().catch((error) => setNotice(els.runtimeError, error.message, "notice-danger"));
setInterval(() => {
  refreshState().catch(() => {});
}, 10000);
