# Radio Note Wallet

Retro local wallet for moving **prepared Sepolia ETH claims** over **Meshtastic**.

This app is not "ETH over LoRa" in the literal sense. Real ETH is locked in a Sepolia smart contract, then the wallet prepares off-grid notes in advance. Those notes are transported over Meshtastic. The receiver later redeems them on-chain and gets real ETH.

## What It Does

- Local seed-based Sepolia wallet inside the app
- Sepolia ETH balance view and normal on-chain send
- `RadioNoteVault` contract for deposit, prepare, withdraw, cancel, redeem
- Meshtastic USB bridge over Python
- Offline send workflow based on **prepared off-grid chunks**
- Recipient node check / handshake before send
- Chunked radio transport with progress on sender and receiver
- On-chain redeem tracking for the sender activity log
- Retro UI based on the `blackbox_node` design language

## Core Model

There are 4 different balances / states in the UI:

- `On-chain ETH`
  ETH sitting directly on the wallet address.

- `Vault Available`
  ETH already deposited into the smart contract, but not yet turned into off-grid chunks.

- `Spendable Off-grid`
  ETH already prepared as off-grid chunks. This is what you can send **without internet**.

- `Claimable (offline)`
  Notes you received over Meshtastic but have not redeemed on-chain yet.

## Online vs Offline

### Works offline

- Meshtastic node discovery
- Recipient `Check`
- Off-grid send from already prepared chunks
- Receiving radio notes
- Viewing incoming/offline claimable value

### Requires internet / RPC

- Reading fresh Sepolia balances
- Deposit to vault
- Withdraw from vault
- Prepare off-grid chunks
- Redeem received notes
- Normal on-chain ETH send
- Sender-side confirmation that a note was redeemed on-chain

## Current Workflow

### First-time setup

1. Create a local wallet in `Settings`.
2. Copy the wallet address.
3. Send Sepolia ETH to that address.
4. Open `Prepare`.
5. Deposit some ETH into the vault.
6. Prepare one or more off-grid chunks.

### Off-grid send

1. Open `Send`.
2. Choose `Recipient node`.
3. Press `Check`.
4. Wait until the node becomes ready.
5. Use the prepared-amount slider to pick the summed amount from your prepared chunks.
6. Press `Send off-grid`.

### Receive + redeem

1. On the receiver, incoming chunks appear live in `Home` and `Receive -> Radio Notes`.
2. After the transfer is complete, the received amount appears as `claimable (offline)`.
3. When internet is available, press `Redeem`.
4. The ETH is redeemed from the contract to the receiver wallet address.

### Sender-side redeem visibility

The sender does **not** rely on a mesh message for this.  
When internet is available, the sender checks the smart contract and updates:

- `Activity`
- sent note status
- redeemed state of the bundle

## Installation

### Requirements

- Node.js 18+
- Python 3.10+
- a Meshtastic device connected over USB
- Sepolia RPC endpoint
- Sepolia ETH for testing

### Install dependencies

```powershell
npm install
python -m pip install -r requirements.txt
```

### Cross-platform notes

The app logic is cross-platform. The part that differs by OS is the **Meshtastic USB serial bridge**.

#### Windows

- usually works with `python` and `COM` ports like `COM7`
- if `python` is not available in PATH, set `PYTHON_EXECUTABLE=py`

#### macOS

- serial ports usually look like `/dev/cu.usbmodem*` or `/dev/cu.usbserial*`
- if needed, set `PYTHON_EXECUTABLE=python3`
- you may need to allow terminal access to USB serial devices

#### Linux

- serial ports usually look like `/dev/ttyACM0` or `/dev/ttyUSB0`
- if needed, set `PYTHON_EXECUTABLE=python3`
- you may need serial permissions, for example:

```bash
sudo usermod -aG dialout $USER
```

then log out and back in

## Environment

Create `.env` from `.env.example`.

Minimal example:

```env
SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
CONTRACT_ADDRESS=0x0000000000000000000000000000000000000000
MESHTASTIC_PORT=
PYTHON_EXECUTABLE=
DEPLOYER_PRIVATE_KEY=0xYOUR_TESTNET_PRIVATE_KEY
```

Variables:

- `SEPOLIA_RPC_URL`
  Sepolia RPC used by the wallet and deploy script.

- `CONTRACT_ADDRESS`
  Address of deployed `RadioNoteVault`.

- `MESHTASTIC_PORT`
  Optional fixed serial port.
  Examples:
  - Windows: `COM7`
  - macOS: `/dev/cu.usbmodemXXXX`
  - Linux: `/dev/ttyACM0`

- `PYTHON_EXECUTABLE`
  Optional override for the Python command used by the Meshtastic bridge.
  Examples:
  - Windows: `python` or `py`
  - macOS/Linux: `python3`

- `DEPLOYER_PRIVATE_KEY`
  Test-only key used to deploy the contract.

## Smart Contract

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

The script prints the deployed address. Put that address into:

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

### How Python bridge startup is resolved

The backend now tries Python commands in this order:

- Windows:
  - `PYTHON_EXECUTABLE` if set
  - `python`
  - `py -3`

- macOS / Linux:
  - `PYTHON_EXECUTABLE` if set
  - `python3`
  - `python`

If the bridge does not start, the first thing to try is setting `PYTHON_EXECUTABLE` explicitly in `.env`.

## Recommended 2-Node Test

### Node A

1. Create wallet.
2. Fund with Sepolia ETH.
3. Deposit `0.02 ETH` into vault.
4. Prepare:
   - `0.002 ETH`
   - `0.008 ETH`
   - `0.01 ETH`

### Node B

1. Create wallet.
2. Make sure Meshtastic is connected.
3. Open `Receive`.

### Send test

1. On Node A, open `Send`.
2. Choose Node B.
3. Press `Check`.
4. Move the prepared slider to the amount you want.
5. Press `Send off-grid`.

### Receive test

1. On Node B, watch incoming chunk progress.
2. Confirm the note appears in `Receive -> Radio Notes`.
3. Confirm `Home` shows claimable offline value.

### Redeem test

1. On Node B, restore internet if it is offline.
2. Press `Redeem`.
3. Confirm on-chain ETH increases on Node B.
4. On Node A, refresh and confirm `Activity` eventually shows `note_redeemed`.

## UI Walkthrough

### Home

- Shows wallet address
- `Spendable Off-grid ETH`
- `On-chain ETH`
- offline claimable amount
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
- send progress
- latest sent transfer card
- compact older transfer history

### Prepare

- vault balances
- deposit into vault
- prepare off-grid chunks
- ready off-grid inventory
- withdraw available vault ETH

### Settings

- RPC URL
- contract address
- Meshtastic port
- wallet creation
- seed reveal
- wallet reset

## Screenshots

The repo currently does **not** contain screenshot assets yet.

If you want the README to render screenshots, add PNG files here:

```text
docs/screenshots/home.png
docs/screenshots/prepare.png
docs/screenshots/send.png
docs/screenshots/receive.png
docs/screenshots/settings.png
```

Recommended captures:

1. `Home` with spendable off-grid and claimable offline rows visible
2. `Prepare` with deposit + prepared chunks
3. `Send` with recipient check and prepared-amount slider
4. `Receive` with incoming chunk progress
5. `Receive -> Radio Notes` showing redeem

## Project Structure

```text
contracts/RadioNoteVault.sol   Solidity vault contract
scripts/compile.js             Contract compile script
scripts/deploy.js              Contract deploy script
server.js                      Node backend + wallet logic + protocol logic
bridge.py                      Python Meshtastic USB bridge
static/index.html              UI markup
static/wallet-ui.js            Frontend logic
static/wallet-ui.css           Frontend styles
data/                          Local runtime state, wallet, settings, logs
```

## Local State Files

These are intentionally local and should not go to a public repo:

- `data/wallet.json`
- `data/settings.json`
- `data/radio_state.json`
- `data/logs.json`
- `.env`

The project already includes `.gitignore` and `.env.example` for this.

## Troubleshooting

### `Meshtastic offline`

- Click the device status block
- choose a specific COM port
- press `Connect`

### `Insufficient available balance`

This means:

- your wallet has `On-chain ETH`
- but `Vault Available` is still `0`

Fix:

1. Open `Prepare`
2. Deposit ETH into vault
3. Only then prepare off-grid chunks

### `JsonRpcProvider failed to detect network`

Your RPC URL is wrong or unavailable.  
Set a valid `SEPOLIA_RPC_URL`.

### Sender does not see redeem yet

Sender learns about redeem from the smart contract.  
So the sender must have:

- internet
- valid Sepolia RPC

Then refresh the app state.

## Important Note

This is a testnet prototype for Sepolia and Meshtastic experimentation.  
Do not treat it as production-grade custody software.
