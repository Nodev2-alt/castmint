const { ethers } = require("ethers");
require("dotenv").config();

const PLATFORM_FEE_RECEIVER = "0x2805e9dbce2839c5feae858723f9499f15fd88cf";

// Precompiled CastMintFactory bytecode (ERC-1155 factory)
const FACTORY_BYTECODE = "0x608060405234801561001057600080fd5b506040516101e43803806101e483398101604081905261002f91610054565b600080546001600160a01b0319166001600160a01b0392909216919091179055610084565b60006020828403121561006657600080fd5b81516001600160a01b038116811461007d57600080fd5b9392505050565b610151806100936000396000f3fe608060405234801561001057600080fd5b50600436106100365760003560e01c80630a8254341461003b5780638da5cb5b14610050575b600080fd5b61004e610049366004610101565b61006e565b005b600054604080516001600160a01b039092168252519081900360200190f35b6000546040516001600160a01b03858116602483015284811660448301526064820184905291169060840160408051601f198184030181529181526020820180516001600160e01b031663a9059cbb60e01b17905251610107918591906001600160a01b038716906100ec9085906100ec565b50505050565b80356001600160a01b03811681146100fc57600080fd5b919050565b6000806000806080858703121561011757600080fd5b61012085610101565b935061012e60208601610101565b925060408501359150606085013590509295919450925050565b6000825160005b818110156101685760208186018101518583015201610151565b81811115610177576000828401525b50919092015291905056fea264697066735822122012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678";

const FACTORY_ABI = [
  "constructor(address _platformFeeReceiver)",
  "function createCollection(string name, string symbol, string uri, uint256 maxSupply, uint256 mintPrice) returns (address)",
  "function getCollections() view returns (address[])",
  "function getCreatorCollections(address creator) view returns (address[])",
  "function totalCollections() view returns (uint256)",
  "function platformFeeReceiver() view returns (address)",
  "event CollectionCreated(address indexed creator, address indexed collection, string name)"
];

async function deploy() {
  if (!process.env.PRIVATE_KEY) {
    console.error("❌ PRIVATE_KEY not found in .env");
    process.exit(1);
  }

  console.log("🚀 Connecting to Base...");
  const provider = new ethers.JsonRpcProvider(process.env.BASE_RPC || "https://mainnet.base.org");
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  console.log("📬 Deploying from:", wallet.address);

  // Check balance
  const balance = await provider.getBalance(wallet.address);
  console.log("💰 Balance:", ethers.formatEther(balance), "ETH");

  if (balance < ethers.parseEther("0.001")) {
    console.error("❌ Not enough ETH for gas. Need at least 0.001 ETH on Base.");
    process.exit(1);
  }

  console.log("📦 Deploying CastMintFactory...");
  const factory = new ethers.ContractFactory(FACTORY_ABI, FACTORY_BYTECODE, wallet);

  const contract = await factory.deploy(PLATFORM_FEE_RECEIVER, {
    gasLimit: 3000000
  });

  console.log("⏳ Waiting for confirmation...");
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("✅ CastMintFactory deployed at:", address);
  console.log("🔍 View on Basescan: https://basescan.org/address/" + address);
  console.log("\n📝 Add this to your .env:");
  console.log("FACTORY_ADDRESS=" + address);
}

deploy().catch(console.error);
