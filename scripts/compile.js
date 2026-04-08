const fs = require("fs");
const path = require("path");
const solc = require("solc");

const ROOT = path.resolve(__dirname, "..");
const CONTRACT_FILE = path.join(ROOT, "contracts", "RadioNoteVault.sol");
const ARTIFACTS_DIR = path.join(ROOT, "artifacts");
const ARTIFACT_PATH = path.join(ARTIFACTS_DIR, "RadioNoteVault.json");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function findImports(importPath) {
  const localContract = path.join(ROOT, importPath);
  const nodeModule = path.join(ROOT, "node_modules", importPath);
  const resolvedPath = fs.existsSync(localContract) ? localContract : nodeModule;
  if (!fs.existsSync(resolvedPath)) {
    return { error: `Import not found: ${importPath}` };
  }
  return { contents: fs.readFileSync(resolvedPath, "utf8") };
}

function compile() {
  const source = fs.readFileSync(CONTRACT_FILE, "utf8");
  const input = {
    language: "Solidity",
    sources: {
      "contracts/RadioNoteVault.sol": {
        content: source
      }
    },
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      },
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"]
        }
      }
    }
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
  const errors = Array.isArray(output.errors) ? output.errors : [];
  const fatalErrors = errors.filter((entry) => entry.severity === "error");
  if (fatalErrors.length) {
    throw new Error(fatalErrors.map((entry) => entry.formattedMessage || entry.message).join("\n\n"));
  }

  const contract = output.contracts["contracts/RadioNoteVault.sol"].RadioNoteVault;
  const artifact = {
    contractName: "RadioNoteVault",
    abi: contract.abi,
    bytecode: `0x${contract.evm.bytecode.object}`,
    deployedBytecode: `0x${contract.evm.deployedBytecode.object}`
  };

  ensureDir(ARTIFACTS_DIR);
  fs.writeFileSync(ARTIFACT_PATH, JSON.stringify(artifact, null, 2), "utf8");
  return artifact;
}

if (require.main === module) {
  try {
    const artifact = compile();
    console.log(`Compiled ${artifact.contractName} -> ${ARTIFACT_PATH}`);
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

module.exports = {
  ARTIFACT_PATH,
  compile
};
