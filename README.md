# Radio Note Wallet

Sepolia ETH wallet with Meshtastic transport for off-grid value movement.

Flow:

1. Fund a local wallet with Sepolia ETH.
2. Deposit ETH into `RadioNoteVault`.
3. Commit a note on-chain for a recipient wallet address announced over Meshtastic.
4. Send the signed note proof over radio.
5. Recipient redeems on-chain and receives real ETH.

## What is implemented

- Local seed-based ETH wallet in the app
- On-chain ETH send
- Vault deposit / withdraw
- `RadioNoteVault` Solidity contract
- Note commit / resend / redeem / cancel flows
- Meshtastic USB bridge over Python
- Wallet address announcement over mesh
- Recipient discovery from Meshtastic node announcements
- Retro web UI inspired by `blackbox_node`

## Install

```powershell
npm install
python -m pip install -r requirements.txt
```

## Contract compile

```powershell
npm run contract:compile
```

Compiled artifact goes to `./artifacts/RadioNoteVault.json`.

## Contract deploy

Create `.env` from `.env.example` and set:

- `SEPOLIA_RPC_URL`
- `DEPLOYER_PRIVATE_KEY`

Then deploy:

```powershell
npm run contract:deploy
```

Take the deployed contract address and put it into the app settings or `.env` as `CONTRACT_ADDRESS`.

## Run the wallet

```powershell
npm start
```

Open:

```text
http://127.0.0.1:7861
```

## Meshtastic notes

- Each wallet announces `Meshtastic node id -> ETH address`
- Send flow is enabled only for nodes with a verified announcement
- Notes are recipient-bound, not bearer tokens
- Radio only transports the proof, not native ETH

## Important note for this Codex session

Inside the Codex sandbox, `node` cannot spawn the Python bridge process and returns `spawn EPERM`.
That is a sandbox restriction here, not a protocol design limit.
Running `npm start` directly on your machine should allow the app to start the bridge normally if Python deps and the Meshtastic device are present.
