# Radio Note Protocol

*An off-grid protocol for transporting pre-authorized Sepolia ETH claims over Meshtastic and redeeming them later on-chain.*

Radio Note Protocol is the core system in this repository. It defines a model where real ETH is locked in a Sepolia smart contract, off-grid redemption notes are prepared in advance, those notes are transported over **Meshtastic**, and the receiver later redeems on-chain.

`Radio Note Wallet` is the reference local wallet and UI included in this repo for creating wallets, preparing notes, sending them over radio, receiving them, and redeeming them.

**This is not "ETH over LoRa" in the literal sense.** The radio leg carries signed redemption data for value that was already reserved in the contract. The ETH itself stays in `RadioNoteVault` on Sepolia until the receiver redeems.

> Experimental prototype. This repo is for Sepolia + Meshtastic testing and protocol exploration, not production custody.

## Why It Matters

This project explores a practical off-grid crypto transport model:

- keep settlement anchored to Ethereum on **Sepolia**
- move value-bearing claims over **Meshtastic**
- redeem later when the receiver is back online

What the app already does:

- runs a local seed-based Sepolia wallet inside the app
- shows Sepolia ETH balance and supports normal on-chain ETH send
- uses the `RadioNoteVault` contract for deposit, prepare, withdraw, cancel, and redeem flows
- uses a Python Meshtastic USB bridge for radio transport
- sends only **prepared off-grid chunks**, not live on-chain transactions
- checks the recipient node before sending
- transmits radio-note bundles in chunks with sender and receiver progress
- tracks redeem status from Sepolia contract state, not just mesh messages
- presents the flow in a retro local UI aligned with the `blackbox_node` style

## How It Works

1. A wallet is created locally inside the app.
2. The sender deposits Sepolia ETH into `RadioNoteVault`.
3. The sender prepares one or more off-grid chunks on-chain. Each prepared chunk reserves value inside the contract under a unique `noteId` and expiry.
4. When sending, the app checks the recipient node, signs recipient-bound redemption notes for the selected prepared chunks, bundles them, and transports them over Meshtastic.
5. The receiver stores those notes locally and sees them as claimable offline value.
6. When internet is available again, the receiver redeems the notes on Sepolia and the contract releases ETH to the receiver wallet.

Sender-side redemption visibility is confirmed from the smart contract. The sender does not have to trust a radio message to know whether a note was redeemed.

## Core Model / Balances

The UI revolves around four main states:

- `On-chain ETH`
  ETH sitting directly on the local wallet address.

- `Vault Available`
  ETH already deposited into `RadioNoteVault`, but not yet prepared for off-grid transfer.

- `Spendable Off-grid`
  ETH already prepared as off-grid chunks and ready to send without internet.

- `Claimable (offline)`
  Notes received over Meshtastic that are valid for the local wallet but not yet redeemed on-chain.

Under the hood, prepared notes are represented by reserved commitments in the vault contract. The send slider builds a summed send amount from those prepared chunks.

## Online vs Offline

### Works offline

- Meshtastic node discovery
- recipient `Check`
- off-grid send from already prepared chunks
- receiving radio notes
- viewing incoming transfer progress
- viewing `Claimable (offline)` value

### Requires internet / RPC

- reading fresh Sepolia balances
- depositing to the vault
- withdrawing from the vault
- preparing off-grid chunks
- redeeming received notes
- normal on-chain ETH send
- sender-side refresh of redeemed note state

## Quick Start

1. Install Node.js 18+ and Python 3.10+.
2. Install project dependencies:

```powershell
npm install
python -m pip install -r requirements.txt
```

3. Create `.env` from `.env.example` and set at least `SEPOLIA_RPC_URL`.
4. Compile and deploy `RadioNoteVault`, or point the app at an existing Sepolia deployment.
5. Start the app:

```powershell
npm start
```

6. Open `http://127.0.0.1:7861`, create a wallet in `Settings`, fund it with Sepolia ETH, deposit into the vault, prepare chunks, and send off-grid from `Send`.

## Installation / Environment

### Requirements

- Node.js 18+
- Python 3.10+
- a Meshtastic device connected over USB
- a Sepolia RPC endpoint
- Sepolia ETH for testing

### Install Dependencies

```powershell
npm install
python -m pip install -r requirements.txt
```

### Environment File

Create `.env` from `.env.example`.

Example:

```env
# Sepolia RPC endpoint used by the wallet app and deploy scripts
SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com

# Optional legacy alias; leave empty unless you explicitly want to override SEPOLIA_RPC_URL
RPC_URL=

# Deployed RadioNoteVault contract address on Sepolia
CONTRACT_ADDRESS=0x0000000000000000000000000000000000000000

# Optional fixed Meshtastic serial port, for example COM7 on Windows
MESHTASTIC_PORT=

# Optional Python executable override for the Meshtastic bridge
# Windows examples: python, py
# macOS/Linux examples: python3, /usr/bin/python3
PYTHON_EXECUTABLE=

# Test-only deployer key for Sepolia contract deployment
DEPLOYER_PRIVATE_KEY=0xYOUR_TESTNET_PRIVATE_KEY
```

### Environment Variables

- `SEPOLIA_RPC_URL`
  Sepolia RPC used by the wallet app and deploy script.

- `RPC_URL`
  Optional legacy alias. The code prefers `SEPOLIA_RPC_URL`.

- `CONTRACT_ADDRESS`
  Address of the deployed `RadioNoteVault` contract.

- `MESHTASTIC_PORT`
  Optional fixed serial port.
  Examples: `COM7`, `/dev/cu.usbmodemXXXX`, `/dev/ttyACM0`

- `PYTHON_EXECUTABLE`
  Optional override for the Python command used to launch `bridge.py`.
  Examples: `python`, `py`, `python3`, `/usr/bin/python3`

- `DEPLOYER_PRIVATE_KEY`
  Test-only key used to deploy the contract.

Compatibility note: `scripts/deploy.js` also accepts legacy aliases `WALLET_PRIVATE_KEY` and `RPC_URL`.

### Cross-Platform Notes

The app logic is cross-platform. The OS-specific part is the Meshtastic USB serial bridge in `bridge.py`.

#### Windows

- usually works with `python` and `COM` ports such as `COM7`
- if `python` is not available in `PATH`, set `PYTHON_EXECUTABLE=py`

#### macOS

- serial ports usually look like `/dev/cu.usbmodem*` or `/dev/cu.usbserial*`
- if needed, set `PYTHON_EXECUTABLE=python3`
- terminal access to USB serial devices may need to be allowed

#### Linux

- serial ports usually look like `/dev/ttyACM0` or `/dev/ttyUSB0`
- if needed, set `PYTHON_EXECUTABLE=python3`
- you may need serial permissions, for example:

```bash
sudo usermod -aG dialout $USER
```

Then log out and back in.

## Smart Contract Commands

### Compile

```powershell
npm run contract:compile
```

Artifact output:

```text
artifacts/RadioNoteVault.json
```

### Deploy

```powershell
npm run contract:deploy
```

The deploy script prints the Sepolia contract address. Put that address in:

- `.env` as `CONTRACT_ADDRESS`
- or the app `Settings`

## Run The App

```powershell
npm start
```

Open:

```text
http://127.0.0.1:7861
```

### Python Bridge Resolution

The backend tries Python commands in this order:

- Windows:
  `PYTHON_EXECUTABLE` if set, then `python`, then `py -3`

- macOS / Linux:
  `PYTHON_EXECUTABLE` if set, then `python3`, then `python`

If the bridge does not start, the first fix to try is setting `PYTHON_EXECUTABLE` explicitly in `.env`.

## Recommended 2-Node Demo

### Node A

1. Create wallet.
2. Fund it with Sepolia ETH.
3. Deposit `0.02 ETH` into the vault.
4. Prepare:
   - `0.002 ETH`
   - `0.008 ETH`
   - `0.01 ETH`

### Node B

1. Create wallet.
2. Make sure Meshtastic is connected.
3. Open `Receive`.

### Send Test

1. On Node A, open `Send`.
2. Choose Node B.
3. Press `Check`.
4. Move the prepared slider to the amount you want.
5. Press `Send off-grid`.

### Receive Test

1. On Node B, watch incoming chunk progress.
2. Confirm the note appears in `Receive -> Radio Notes`.
3. Confirm `Home` shows claimable offline value.

### Redeem Test

1. On Node B, restore internet if it is offline.
2. Press `Redeem`.
3. Confirm on-chain ETH increases on Node B.
4. On Node A, refresh and confirm `Activity` eventually shows `note_redeemed`.

## UI Overview

### Home

- wallet address
- `Spendable Off-grid ETH`
- `On-chain ETH`
- claimable offline amount
- live incoming transfer progress

### Receive

- wallet address and QR code
- incoming radio-transfer progress
- received radio notes
- redeem button

### Send

- recipient node selection
- `Check` handshake
- prepared-amount slider
- off-grid send progress
- normal on-chain ETH send
- latest sent transfer card and older history

### Prepare

- vault balances
- deposit into vault
- prepare off-grid chunks with expiry
- ready off-grid inventory
- withdraw available vault ETH

### Activity

- on-chain events
- vault events
- announcement and handshake events
- sent, delivered, and redeemed radio-note events

### Settings

- RPC URL
- contract address
- Meshtastic port
- wallet creation
- seed reveal
- wallet delete / reset controls

## Screenshots

Screenshot assets are not included in the repo yet.

If you want the README to render screenshots, add PNG files here:

```text
docs/screenshots/home.png
docs/screenshots/prepare.png
docs/screenshots/send.png
docs/screenshots/receive.png
docs/screenshots/settings.png
```

Recommended captures:

1. `Home` with `Spendable Off-grid ETH`, `On-chain ETH`, and claimable offline value visible
2. `Prepare` with deposit flow, vault balances, and prepared chunks
3. `Send` with recipient check and prepared-amount slider
4. `Receive` with incoming chunk progress or received radio notes
5. `Settings` with RPC, contract, Meshtastic port, and wallet controls

## Project Structure

- `contracts/RadioNoteVault.sol`
  Solidity vault contract for deposits, commitments, redemption, and expiry cancellation

- `scripts/compile.js`
  Contract compile script

- `scripts/deploy.js`
  Contract deploy script

- `server.js`
  Node backend, wallet logic, vault integration, off-grid protocol flow, and local API

- `bridge.py`
  Python Meshtastic USB bridge

- `static/index.html`
  UI markup

- `static/wallet-ui.js`
  Frontend wallet logic

- `static/wallet-ui.css`
  Frontend wallet styling

- `data/`
  Local runtime state, wallet data, settings, logs, and cached summaries

- `docs/screenshots/`
  Optional README screenshots

## Troubleshooting

### `Meshtastic offline`

- click the device status block
- choose a specific port
- press `Connect`

### `No Meshtastic serial port detected`

- connect the device over USB
- set `MESHTASTIC_PORT` if auto-detect picks the wrong port
- confirm the serial device is visible to the OS

### `Missing Python deps`

Install the bridge dependencies:

```powershell
python -m pip install -r requirements.txt
```

### `Insufficient available balance`

This means your wallet may have `On-chain ETH`, but `Vault Available` is still `0`.

Fix:

1. Open `Prepare`.
2. Deposit ETH into the vault.
3. Then prepare off-grid chunks.

### `JsonRpcProvider failed to detect network`

Your RPC URL is wrong, unavailable, or rate-limited. Set a valid `SEPOLIA_RPC_URL`.

### Sender does not see redeem yet

Sender-side redemption status comes from the smart contract, not from a radio message.

Make sure the sender has:

- internet access
- a valid Sepolia RPC

Then refresh the app state.

## Security / Prototype Warning

This is a **Sepolia testnet prototype** for Meshtastic and off-grid note transport experiments.

- do not treat it as production-grade custody software
- do not use mainnet funds
- protect the local seed phrase like a real wallet secret
- expect rough edges in transport, local state handling, and recovery flows

The app writes sensitive local state under `data/` and the repo root, including:

- `data/wallet.json`
- `data/settings.json`
- `data/radio_state.json`
- `data/logs.json`
- `data/wallet_summary.json`
- `.env`

Keep those files local. The repo already includes `.gitignore` and `.env.example` to support that workflow.
