const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const { compile, ARTIFACT_PATH } = require("./compile");

function loadDotEnv(rootDir) {
  const envFile = path.join(rootDir, ".env");
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

async function main() {
  const rootDir = path.resolve(__dirname, "..");
  loadDotEnv(rootDir);

  const rpcUrl = process.env.SEPOLIA_RPC_URL || process.env.RPC_URL;
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY || process.env.WALLET_PRIVATE_KEY;
  if (!rpcUrl) {
    throw new Error("Set SEPOLIA_RPC_URL or RPC_URL before deploy");
  }
  if (!privateKey) {
    throw new Error("Set DEPLOYER_PRIVATE_KEY or WALLET_PRIVATE_KEY before deploy");
  }

  const artifact = fs.existsSync(ARTIFACT_PATH)
    ? JSON.parse(fs.readFileSync(ARTIFACT_PATH, "utf8"))
    : compile();

  const provider = new ethers.JsonRpcProvider(rpcUrl, 11155111);
  const deployer = new ethers.Wallet(privateKey, provider);
  console.log(`Deploying RadioNoteVault from ${deployer.address}`);

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, deployer);
  const vault = await factory.deploy();
  await vault.waitForDeployment();

  const address = await vault.getAddress();
  console.log(`RadioNoteVault deployed to ${address}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
