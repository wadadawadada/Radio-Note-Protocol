// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract RadioNoteVault is EIP712, ReentrancyGuard {
    bytes32 private constant NOTE_TYPEHASH =
        keccak256(
            "Note(address issuer,address recipient,uint256 amount,bytes32 noteId,uint64 expiry,address contractAddress,uint256 chainId)"
        );

    struct Note {
        address issuer;
        address recipient;
        uint256 amount;
        bytes32 noteId;
        uint64 expiry;
        address contractAddress;
        uint256 chainId;
    }

    struct Commitment {
        address issuer;
        uint256 amount;
        uint64 expiry;
        bool spent;
        bool canceled;
    }

    mapping(address => uint256) public availableBalance;
    mapping(address => uint256) public reservedBalance;
    mapping(bytes32 => Commitment) public commitments;

    event Deposited(address indexed issuer, uint256 amount);
    event Withdrawn(address indexed issuer, uint256 amount);
    event NotePrepared(bytes32 indexed noteId, address indexed issuer, uint256 amount, uint64 expiry);
    event NoteRedeemed(
        bytes32 indexed noteId,
        address indexed issuer,
        address indexed recipient,
        uint256 amount
    );
    event NoteCanceled(bytes32 indexed noteId, address indexed issuer, uint256 amount);

    constructor() EIP712("RadioNoteVault", "1") {}

    function deposit() external payable {
        require(msg.value > 0, "No ETH supplied");
        availableBalance[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    function withdrawAvailable(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be > 0");
        uint256 available = availableBalance[msg.sender];
        require(available >= amount, "Insufficient available balance");
        unchecked {
            availableBalance[msg.sender] = available - amount;
        }
        _sendValue(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function prepareNote(bytes32 noteId, uint256 amount, uint64 expiry) external {
        require(noteId != bytes32(0), "noteId required");
        require(amount > 0, "amount required");
        require(expiry > block.timestamp, "expiry must be in future");
        require(commitments[noteId].issuer == address(0), "note already exists");

        uint256 available = availableBalance[msg.sender];
        require(available >= amount, "Insufficient available balance");

        unchecked {
            availableBalance[msg.sender] = available - amount;
        }
        reservedBalance[msg.sender] += amount;
        commitments[noteId] = Commitment({
            issuer: msg.sender,
            amount: amount,
            expiry: expiry,
            spent: false,
            canceled: false
        });

        emit NotePrepared(noteId, msg.sender, amount, expiry);
    }

    function cancelExpiredNote(bytes32 noteId) external {
        Commitment storage commitment = commitments[noteId];
        require(commitment.issuer == msg.sender, "Not issuer");
        require(!commitment.spent, "Already redeemed");
        require(!commitment.canceled, "Already canceled");
        require(commitment.expiry < block.timestamp, "Note not expired");

        commitment.canceled = true;
        reservedBalance[msg.sender] -= commitment.amount;
        availableBalance[msg.sender] += commitment.amount;

        emit NoteCanceled(noteId, msg.sender, commitment.amount);
    }

    function redeem(Note calldata note, bytes calldata signature) external nonReentrant {
        require(note.contractAddress == address(this), "Wrong contract");
        require(note.chainId == block.chainid, "Wrong chain");
        require(note.amount > 0, "Invalid amount");
        require(note.expiry >= block.timestamp, "Note expired");
        require(msg.sender == note.recipient, "Only recipient can redeem");

        Commitment storage commitment = commitments[note.noteId];
        require(commitment.issuer != address(0), "Unknown note");
        require(!commitment.spent, "Note already redeemed");
        require(!commitment.canceled, "Note canceled");
        require(commitment.issuer == note.issuer, "Issuer mismatch");
        require(commitment.amount == note.amount, "Amount mismatch");
        require(commitment.expiry == note.expiry, "Expiry mismatch");

        bytes32 structHash = keccak256(
            abi.encode(
                NOTE_TYPEHASH,
                note.issuer,
                note.recipient,
                note.amount,
                note.noteId,
                note.expiry,
                note.contractAddress,
                note.chainId
            )
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        address recovered = ECDSA.recover(digest, signature);
        require(recovered == note.issuer, "Invalid signature");

        commitment.spent = true;
        reservedBalance[note.issuer] -= note.amount;

        _sendValue(note.recipient, note.amount);
        emit NoteRedeemed(note.noteId, note.issuer, note.recipient, note.amount);
    }

    function previewDigest(Note calldata note) external view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                NOTE_TYPEHASH,
                note.issuer,
                note.recipient,
                note.amount,
                note.noteId,
                note.expiry,
                note.contractAddress,
                note.chainId
            )
        );
        return _hashTypedDataV4(structHash);
    }

    function _sendValue(address recipient, uint256 amount) private {
        (bool ok, ) = recipient.call{value: amount}("");
        require(ok, "ETH transfer failed");
    }
}
