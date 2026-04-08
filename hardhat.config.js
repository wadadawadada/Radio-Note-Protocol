require("@nomicfoundation/hardhat-ethers");

const sepoliaUrl = process.env.SEPOLIA_RPC_URL || process.env.RPC_URL || "";
const deployerKey = process.env.DEPLOYER_PRIVATE_KEY || process.env.WALLET_PRIVATE_KEY || "";

const networks = {
  hardhat: {}
};

if (sepoliaUrl) {
  networks.sepolia = {
    url: sepoliaUrl,
    accounts: deployerKey ? [deployerKey] : []
  };
}

/** @type {import("hardhat/config").HardhatUserConfig} */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks
};
