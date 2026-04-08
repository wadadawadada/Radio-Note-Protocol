# LoRa EVM Wallet Node (Final Minimal Spec)

## Idea

This system transfers value as a **portable signed proof**, not as native ETH.

- funds are locked on-chain
- a proof is created off-chain
- proof is sent over LoRa (Meshtastic)
- receiver redeems later via smart contract

This behaves like transferring a digital object between users.

---

## Core Rule

**One proof = one redemption**

After a successful redeem:
- the proof becomes invalid
- sender cannot use it anymore
- any further attempts fail on-chain

---

## Components

### Smart Contract
- holds locked funds
- verifies proofs
- tracks used proofs (`noteId`)
- releases funds on valid redeem

### Sender (Wallet Node)
- deposits funds into contract
- creates signed proof
- sends proof over LoRa
- deletes proof locally (UX rule)

### Receiver
- receives proof
- reconstructs and verifies it
- redeems later online

---

## Proof Structure

issuer: address  
asset: address  
amount: uint256  
recipient: address  
noteId: bytes32  
expiry: uint64  
contract: address  

+ signature

---

## Flow

### 1. Lock Funds
Sender deposits ETH / ERC20 into the smart contract.

### 2. Create Proof
Sender creates a signed proof with:
- unique `noteId`
- recipient address
- amount
- expiry

### 3. Transfer over LoRa
- proof is serialized
- split into chunks
- sent via mesh network
- receiver reconstructs proof

### 4. Local Deletion (Sender)
Sender deletes the proof after sending.

Important:
this is NOT security, only expected behavior.

### 5. Redeem
Receiver calls:

redeem(proof, signature)

Contract:
- verifies signature
- checks expiry
- checks `noteId` is unused
- marks `noteId` as spent
- transfers funds to recipient

---

## Double Spend Model

- each proof has a unique `noteId`
- contract stores used `noteId`s

Rule:

if noteId already used -> reject

Result:
- first successful redeem wins
- all later attempts fail

---

## Trust Model

- system is not fully trustless offline
- sender could copy proof before deletion
- but only ONE redeem can succeed

After redeem:
- proof is permanently invalid
- sender loses ability to claim funds

---

## Recommended Protections

- bind proof to recipient address
- use short expiry (TTL)
- use encrypted transport if possible

---

## What This System Is

- off-chain transferable proof
- on-chain enforced redemption
- mesh used only as transport

---

## What This System Is NOT

- not native ETH over radio
- not consensus over mesh
- not double-spend-proof offline

---

## Summary

portable proof -> radio transfer -> on-chain redemption

with:

smart contract enforcing single valid spend