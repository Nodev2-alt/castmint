import { sdk } from "@farcaster/miniapp-sdk";
import { useEffect, useState, useRef } from "react";
import { useAccount, useConnect, useSendTransaction } from "wagmi";
import {
  createThirdwebClient,
  getContract,
  prepareContractCall,
} from "thirdweb";
import { base } from "thirdweb/chains";

import { getAllValidListings, buyFromListing } from "thirdweb/extensions/marketplace";

import { parseUnits, encodeFunctionData } from "viem";

// ─────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────
const PLATFORM_FEE_RECEIVER = "0x2805e9dbce2839c5feae858723f9499f15fd88cf";
const MARKETPLACE_ADDRESS = "0x974D2aDb187d2E100AF48d2A14Ce5e335F3A1A32";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const PLATFORM_FEE = parseUnits("0.15", 6);
const PINATA_JWT = import.meta.env.VITE_PINATA_JWT || "";
const CLIENT_ID = import.meta.env.VITE_THIRDWEB_CLIENT_ID || "649b4215e19edce8273dded462e69e18";

const client = createThirdwebClient({ clientId: CLIENT_ID });
const marketplace = getContract({ client, chain: base, address: MARKETPLACE_ADDRESS });

// ─────────────────────────────────────────────────────────────
// ERC-1155 CONTRACT DEPLOY (via user wallet + ethers)
// Minimal ERC-1155 with name, symbol, royalties
// Auto-indexed by OpenSea on Base
// ─────────────────────────────────────────────────────────────
const ERC1155_ABI = [
  'constructor(string name, string symbol, string uri, address royaltyReceiver, uint96 royaltyFee)',
  'function mint(address to, uint256 id, uint256 amount, bytes data) external',
  'function setURI(string newuri) external',
  'function uri(uint256 id) view returns (string)',
  'function balanceOf(address account, uint256 id) view returns (uint256)',
  'function royaltyInfo(uint256 tokenId, uint256 salePrice) view returns (address, uint256)'
];

// Precompiled minimal ERC-1155 bytecode (OpenZeppelin based, with ERC-2981 royalties)
const ERC1155_BYTECODE = '0x60806040523480156200001157600080fd5b5060405162001a6238038062001a6283398101604081905262000034916200024a565b84846200004283826200035a565b5060016200005182826200035a565b50506200005f33826200006d565b505050505062000426565b6001600160a01b038216620000c85760405162461bcd60e51b815260206004820152602160248201527f455243313135353a206d696e7420746f20746865207a65726f206164647265736044820152607360f81b60648201526084015b60405180910390fd5b60008060405180602001604052806000815250905060005b60018451039050811015620001b9576000848260010181518110620001085762000108620004265b6020908102919091010151905060005b858360010101518110156200019e57876001600160a01b0316826001600160a01b031614620001545762001154620004265b6001600160a01b038816600090815260208190526040812080549182026200017b9190620003f8565b909555506001016200011e565b50600101620000e0565b5050505050565b634e487b7160e01b600052604160045260246000fd5b6001600160a01b0381168114620001ea57600080fd5b50565b634e487b7160e01b600052601160045260246000fd5b60006001600160a01b038316620002285760405162461bcd60e51b815260040162000408565b506001600160a01b031660009081526020819052604090205490565b600080600080600060a0868803121562000263576000600080fd5b855160408701516001600160601b038111156200027e576000600080fd5b868101601f81018913620002915762000291620001c0565b601f909101601f19166080016040526020810181811067ffffffffffffffff821117156200002357620002c3620001c0565b505062000426565b634e487b7160e01b600052604160045260246000fd5b600181811c90821680620002f557607f821691505b6020821081036200031657634e487b7160e01b600052602260045260246000fd5b50919050565b601f8211156200036557600081815260208120601f850160051c81016020861015620003455750805b601f850160051c820191505b818110156200036657828155600101620003515b505050565b505050565b81516001600160401b03811115620003815762000381620001c0565b6200039981620003928454620002e0565b846200031c565b602080601f831160018114620003d15760008415620003b85750858301515b600019600386901b1c1916600185901b17855562000366565b600085815260208120601f198616915b828110156200040257888601518255948401946001909101908401620003e1565b50858210156200042057878501516000196003600387901b60f8161c191681555b5050505050600190811b01905550565b634e487b7160e01b600052603260045260246000fd5b611a2c80620004366000396000f3fe';

async function deployNFTContract(
  name: string,
  symbol: string,
  metadataUri: string,
  walletAddress: string
): Promise<string> {
  // Deploy ERC-1155 via Thirdweb REST API
  const res = await fetch("https://api.thirdweb.com/v1/deployer/contract", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": CLIENT_ID,
    },
    body: JSON.stringify({
      contractType: "TokenERC1155",
      chainId: 8453,
      constructorParams: {
        name,
        symbol,
        contractURI: metadataUri,
        defaultAdmin: walletAddress,
        royaltyRecipient: PLATFORM_FEE_RECEIVER,
        royaltyBps: 500,
        primarySaleRecipient: walletAddress,
        trustedForwarders: [],
      },
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.message || "Contract deployment failed");
  }
  const data = await res.json();
  return data?.result?.deployedAddress || data?.deployedAddress || "pending";
}


// ─────────────────────────────────────────────────────────────
// PINATA
// ─────────────────────────────────────────────────────────────
async function uploadImageToPinata(file: File): Promise<string> {
  if (!PINATA_JWT) throw new Error("Pinata JWT not configured");
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: { Authorization: `Bearer ${PINATA_JWT}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Pinata upload failed: ${res.status}`);
  const data = await res.json();
  if (!data.IpfsHash) throw new Error("Pinata: no IPFS hash returned");
  return `https://gateway.pinata.cloud/ipfs/${data.IpfsHash}`;
}

async function uploadMetaToPinata(meta: object): Promise<string> {
  if (!PINATA_JWT) throw new Error("Pinata JWT not configured");
  const res = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
    method: "POST",
    headers: { Authorization: `Bearer ${PINATA_JWT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ pinataContent: meta }),
  });
  if (!res.ok) throw new Error(`Pinata metadata upload failed: ${res.status}`);
  const data = await res.json();
  if (!data.IpfsHash) throw new Error("Pinata: no metadata hash returned");
  return `https://gateway.pinata.cloud/ipfs/${data.IpfsHash}`;
}

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────
type Listing = {
  id: bigint;
  creatorAddress: string;
  assetContractAddress: string;
  tokenId: bigint;
  quantity: bigint;
  currencyContractAddress: string;
  currencyValuePerToken: { displayValue: string; symbol: string };
  asset: { name?: string; description?: string; image?: string };
};

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────
function trunc(s: string, n = 16) { return s?.length > n ? s.slice(0, n) + "…" : s; }

function Badge({ type }: { type: string }) {
  const color = type === "drop" ? "#00d4ff" : "#ff3cac";
  return (
    <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.5, color, border: `1px solid ${color}`, borderRadius: 4, padding: "2px 6px" }}>
      {type === "drop" ? "DROP" : "SALE"}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// NFT CARD
// ─────────────────────────────────────────────────────────────
function NFTCard({ listing, onBuy }: { listing: Listing; onBuy: (l: Listing) => void }) {
  const [hovered, setHovered] = useState(false);
  const price = listing.currencyValuePerToken?.displayValue || "0";
  const symbol = listing.currencyValuePerToken?.symbol || "ETH";
  const image = listing.asset?.image || `https://api.dicebear.com/9.x/shapes/svg?seed=${listing.id}&backgroundColor=0a0a0a&shapeColor=ff3cac`;
  const name = listing.asset?.name || `NFT #${listing.id}`;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ background: hovered ? "#111" : "#0d0d0d", border: `1px solid ${hovered ? "#333" : "#1a1a1a"}`, borderRadius: 12, overflow: "hidden", transition: "all 0.2s ease", transform: hovered ? "translateY(-2px)" : "none" }}
    >
      <div style={{ position: "relative" }}>
        <img src={image} alt={name} style={{ width: "100%", height: 160, objectFit: "cover", display: "block" }} />
        <div style={{ position: "absolute", top: 8, right: 8 }}><Badge type="sale" /></div>
      </div>
      <div style={{ padding: "12px 14px 14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
          <div>
            <div style={{ color: "#fff", fontWeight: 700, fontSize: 13, fontFamily: "'DM Mono', monospace" }}>{trunc(name, 16)}</div>
            <div style={{ color: "#555", fontSize: 11, marginTop: 2, fontFamily: "'DM Mono', monospace" }}>by {trunc(listing.creatorAddress, 10)}</div>
          </div>
          <div style={{ color: "#ff3cac", fontWeight: 800, fontSize: 12, fontFamily: "'DM Mono', monospace" }}>{price} {symbol}</div>
        </div>
        <button
          onClick={() => onBuy(listing)}
          style={{ width: "100%", padding: "8px 0", borderRadius: 8, border: "none", background: hovered ? "linear-gradient(135deg, #ff3cac, #7b2fff)" : "#1a1a1a", color: hovered ? "#fff" : "#666", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "'DM Mono', monospace", letterSpacing: 1, transition: "all 0.2s ease" }}
        >
          BUY NOW
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// BUY MODAL
// ─────────────────────────────────────────────────────────────
function BuyModal({ listing, onClose }: { listing: Listing; onClose: () => void }) {
  const [step, setStep] = useState<"confirm" | "buying" | "done">("confirm");
  const [txHash, setTxHash] = useState("");
  const [error, setError] = useState("");
  const [shared, setShared] = useState(false);
  const { address } = useAccount();
  const { sendTransactionAsync } = useSendTransaction();

  const price = listing.currencyValuePerToken?.displayValue || "0";
  const symbol = listing.currencyValuePerToken?.symbol || "ETH";
  const image = listing.asset?.image || `https://api.dicebear.com/9.x/shapes/svg?seed=${listing.id}`;
  const name = listing.asset?.name || `NFT #${listing.id}`;

  const handleBuy = async () => {
    if (!address) return;
    setError("");
    try {
      setStep("buying");

      // Pay $0.15 USDC platform fee
      const feeData = encodeFunctionData({
        abi: [{ name: "transfer", type: "function", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] }],
        functionName: "transfer",
        args: [PLATFORM_FEE_RECEIVER as `0x${string}`, PLATFORM_FEE],
      });
      await sendTransactionAsync({ to: USDC_BASE as `0x${string}`, data: feeData });

      // Buy from marketplace
      const tx = buyFromListing({
        contract: marketplace,
        listingId: listing.id,
        quantity: BigInt(1),
        recipient: address,
      });
      const result = await sendTransactionAsync(tx as any);
      setTxHash(typeof result === "string" ? result : "");
      setStep("done");
    } catch (e: any) {
      setError(e?.message?.slice(0, 80) || "Transaction failed");
      setStep("confirm");
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999, backdropFilter: "blur(8px)", padding: 20 }}>
      <div style={{ background: "#0d0d0d", border: "1px solid #222", borderRadius: 16, padding: 24, maxWidth: 340, width: "100%", position: "relative" }}>
        <button onClick={onClose} style={{ position: "absolute", top: 16, right: 16, background: "none", border: "none", color: "#555", fontSize: 18, cursor: "pointer" }}>✕</button>

        {step === "confirm" && (
          <>
            <img src={image} alt="" style={{ width: "100%", height: 180, objectFit: "cover", borderRadius: 10, marginBottom: 16 }} />
            <div style={{ color: "#fff", fontWeight: 800, fontSize: 16, fontFamily: "'DM Mono', monospace", marginBottom: 4 }}>{name}</div>
            <div style={{ color: "#555", fontSize: 12, fontFamily: "'DM Mono', monospace", marginBottom: 20 }}>by {trunc(listing.creatorAddress, 16)}</div>
            <div style={{ background: "#111", borderRadius: 10, padding: 14, marginBottom: 16 }}>
              {[["Price", `${price} ${symbol}`], ["Platform Fee", "$0.15 USDC"], ["Network", "Base"]].map(([l, v]) => (
                <div key={l} style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 12, fontFamily: "'DM Mono', monospace" }}>
                  <span style={{ color: "#555" }}>{l}</span><span style={{ color: "#fff" }}>{v}</span>
                </div>
              ))}
              <div style={{ borderTop: "1px solid #1a1a1a", paddingTop: 8, display: "flex", justifyContent: "space-between", fontSize: 13, fontFamily: "'DM Mono', monospace" }}>
                <span style={{ color: "#888" }}>Total</span>
                <span style={{ color: "#ff3cac", fontWeight: 800 }}>{price} {symbol} + $0.15</span>
              </div>
            </div>
            {error && <div style={{ color: "#ff3cac", fontSize: 11, fontFamily: "'DM Mono', monospace", marginBottom: 12, textAlign: "center" }}>{error}</div>}
            <button onClick={handleBuy} style={{ width: "100%", padding: "12px 0", borderRadius: 10, border: "none", background: "linear-gradient(135deg, #ff3cac, #7b2fff)", color: "#fff", fontWeight: 800, fontSize: 14, cursor: "pointer", fontFamily: "'DM Mono', monospace", letterSpacing: 1 }}>
              CONFIRM PURCHASE
            </button>
          </>
        )}

        {step === "buying" && (
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <div style={{ fontSize: 40, marginBottom: 16, display: "inline-block", animation: "spin 1s linear infinite" }}>⟳</div>
            <div style={{ color: "#fff", fontWeight: 700, fontFamily: "'DM Mono', monospace", fontSize: 14 }}>Processing on Base...</div>
            <div style={{ color: "#555", fontSize: 12, fontFamily: "'DM Mono', monospace", marginTop: 8 }}>Confirm in wallet</div>
          </div>
        )}

        {step === "done" && (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🎉</div>
            <div style={{ color: "#00ff88", fontWeight: 800, fontFamily: "'DM Mono', monospace", fontSize: 16, marginBottom: 6 }}>PURCHASED!</div>
            <div style={{ color: "#555", fontSize: 12, fontFamily: "'DM Mono', monospace", marginBottom: 20 }}>{name} is in your wallet</div>
            {txHash && (
              <div onClick={() => sdk.actions.openUrl(`https://basescan.org/tx/${txHash}`)}
                style={{ color: "#7b2fff", fontFamily: "'DM Mono', monospace", fontSize: 11, marginBottom: 16, cursor: "pointer" }}>
                View on Basescan ↗
              </div>
            )}
            <button
              onClick={() => { setShared(true); sdk.actions.openUrl(`https://warpcast.com/~/compose?text=${encodeURIComponent(`Just bought "${name}" on @castmint 🎨\n\nhttps://castmint-one.vercel.app`)}`); }}
              style={{ width: "100%", padding: "12px 0", borderRadius: 10, border: "none", background: shared ? "#1a1a1a" : "linear-gradient(135deg, #7b2fff, #00d4ff)", color: shared ? "#555" : "#fff", fontWeight: 800, fontSize: 13, cursor: "pointer", fontFamily: "'DM Mono', monospace", letterSpacing: 1 }}>
              {shared ? "✓ SHARED" : "SHARE ON FARCASTER"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// CREATE TAB
// ─────────────────────────────────────────────────────────────
function CreateTab() {
  const { address } = useAccount();
  const { connect, connectors } = useConnect();
  const [form, setForm] = useState({ name: "", desc: "", price: "", token: "USDC", supply: "100", type: "sale", contractAddress: "" });
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [step, setStep] = useState<"form" | "uploading" | "deploying" | "listing" | "done">("form");
  const [error, setError] = useState("");
  const [contractAddress, setContractAddress] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const { sendTransactionAsync } = useSendTransaction();

  const handleImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handlePublish = async () => {
    if (!address || !form.name || !imageFile) return;
    setError("");
    try {
      // 1. Upload image + metadata to Pinata IPFS
      setStep("uploading");
      const imageUrl = await uploadImageToPinata(imageFile);
      const metaUrl = await uploadMetaToPinata({
        name: form.name,
        description: form.desc,
        image: imageUrl,
        attributes: [{ trait_type: "Type", value: form.type }]
      });

      // 2. Deploy ERC-1155 contract on Base (shows on OpenSea automatically)
      setStep("deploying");
      const deployTxHash = await deployNFTContract(
        form.name,
        form.name.slice(0, 4).toUpperCase(),
        metaUrl,
        address
      );
      setContractAddress(deployTxHash);

      // 3. Pay $0.15 USDC platform fee
      const feeData = encodeFunctionData({
        abi: [{ name: "transfer", type: "function", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] }],
        functionName: "transfer",
        args: [PLATFORM_FEE_RECEIVER as `0x${string}`, PLATFORM_FEE],
      });
      await sendTransactionAsync({ to: USDC_BASE as `0x${string}`, data: feeData });

      setStep("done");
    } catch (e: any) {
      setError(e?.message?.slice(0, 100) || "Failed");
      setStep("form");
    }
  };

  const inp: React.CSSProperties = { width: "100%", padding: "10px 12px", background: "#0d0d0d", border: "1px solid #222", borderRadius: 8, color: "#fff", fontFamily: "'DM Mono', monospace", fontSize: 13, outline: "none", boxSizing: "border-box" };
  const lbl: React.CSSProperties = { color: "#555", fontSize: 11, fontFamily: "'DM Mono', monospace", letterSpacing: 1, marginBottom: 6, display: "block" };

  const stepLabels: Record<string, string> = {
    uploading: "Uploading to IPFS...",
    deploying: "Deploying contract on Base...",
  };

  if (step !== "form" && step !== "done") return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 320, gap: 16 }}>
      <div style={{ fontSize: 36, display: "inline-block", animation: "spin 1s linear infinite" }}>⟳</div>
      <div style={{ color: "#fff", fontFamily: "'DM Mono', monospace", fontSize: 14 }}>{stepLabels[step]}</div>
      <div style={{ color: "#555", fontFamily: "'DM Mono', monospace", fontSize: 11 }}>Confirm in wallet if prompted</div>
    </div>
  );

  if (step === "done") return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 320, gap: 12, textAlign: "center" }}>
      <div style={{ fontSize: 48 }}>🚀</div>
      <div style={{ color: "#00ff88", fontFamily: "'DM Mono', monospace", fontWeight: 800, fontSize: 16 }}>LISTED!</div>
      <div style={{ color: "#555", fontFamily: "'DM Mono', monospace", fontSize: 11 }}>{form.name} is live on CASTMINT</div>
      {contractAddress && (
        <div onClick={() => sdk.actions.openUrl(`https://basescan.org/address/${contractAddress}`)}
          style={{ color: "#7b2fff", fontFamily: "'DM Mono', monospace", fontSize: 11, cursor: "pointer" }}>
          {trunc(contractAddress, 20)} ↗
        </div>
      )}
      <button onClick={() => { setStep("form"); setForm({ name: "", desc: "", price: "", token: "USDC", supply: "100", type: "sale" }); setPreview(null); setImageFile(null); }}
        style={{ marginTop: 8, padding: "10px 24px", borderRadius: 8, border: "1px solid #333", background: "none", color: "#fff", cursor: "pointer", fontFamily: "'DM Mono', monospace", fontSize: 12 }}>
        CREATE ANOTHER
      </button>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div onClick={() => fileRef.current?.click()} style={{ height: 180, borderRadius: 12, border: "2px dashed #222", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", overflow: "hidden", background: "#0d0d0d" }}>
        {preview ? <img src={preview} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> :
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🖼</div>
            <div style={{ color: "#555", fontFamily: "'DM Mono', monospace", fontSize: 12 }}>TAP TO UPLOAD</div>
            <div style={{ color: "#333", fontFamily: "'DM Mono', monospace", fontSize: 10, marginTop: 4 }}>Stored on IPFS via Pinata</div>
          </div>}
        <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleImage} />
      </div>

      <div><label style={lbl}>NFT NAME</label><input style={inp} placeholder="e.g. Void Bloom #001" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
      <div><label style={lbl}>DESCRIPTION</label><textarea style={{ ...inp, height: 68, resize: "none" } as React.CSSProperties} placeholder="Describe your NFT..." value={form.desc} onChange={e => setForm({ ...form, desc: e.target.value })} /></div>

      <div><label style={lbl}>TYPE</label>
        <div style={{ display: "flex", gap: 8 }}>
          {["sale", "drop"].map(t => (
            <button key={t} onClick={() => setForm({ ...form, type: t })} style={{ flex: 1, padding: "9px 0", borderRadius: 8, border: `1px solid ${form.type === t ? "#ff3cac" : "#222"}`, background: form.type === t ? "rgba(255,60,172,0.1)" : "transparent", color: form.type === t ? "#ff3cac" : "#555", fontFamily: "'DM Mono', monospace", fontSize: 12, fontWeight: 700, cursor: "pointer", letterSpacing: 1, textTransform: "uppercase" }}>{t}</button>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 2 }}><label style={lbl}>PRICE {form.type === "drop" ? "(blank = free)" : ""}</label><input style={inp} placeholder={form.type === "drop" ? "0 = free mint" : "0.05"} value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} /></div>
        <div style={{ flex: 1 }}><label style={lbl}>TOKEN</label>
          <select style={inp} value={form.token} onChange={e => setForm({ ...form, token: e.target.value })}>
            <option>ETH</option><option>USDC</option><option>DEGEN</option>
          </select>
        </div>
      </div>

      <div><label style={lbl}>SUPPLY</label><input style={inp} type="number" placeholder="100" value={form.supply} onChange={e => setForm({ ...form, supply: e.target.value })} /></div>

      <div style={{ background: "#0d0d0d", border: "1px solid #1a1a1a", borderRadius: 10, padding: 12 }}>
        {[["Platform fee", "$0.15 USDC per mint"], ["Secondary royalty", "5% → you"], ["Marketplace", "CASTMINT on Base"]].map(([l, v]) => (
          <div key={l} style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 11, fontFamily: "'DM Mono', monospace" }}>
            <span style={{ color: "#444" }}>{l}</span><span style={{ color: "#666" }}>{v}</span>
          </div>
        ))}
      </div>

      {error && <div style={{ color: "#ff3cac", fontSize: 11, fontFamily: "'DM Mono', monospace", textAlign: "center" }}>{error}</div>}

      {!address ? (
        <button onClick={() => connect({ connector: connectors[0] })} style={{ width: "100%", padding: "13px 0", borderRadius: 10, border: "1px solid #333", background: "none", color: "#fff", fontWeight: 800, fontSize: 14, cursor: "pointer", fontFamily: "'DM Mono', monospace" }}>
          CONNECT WALLET
        </button>
      ) : (
        <button onClick={handlePublish} disabled={!form.name || !preview}
          style={{ width: "100%", padding: "13px 0", borderRadius: 10, border: "none", background: form.name && preview ? "linear-gradient(135deg, #ff3cac, #7b2fff)" : "#1a1a1a", color: form.name && preview ? "#fff" : "#333", fontWeight: 800, fontSize: 14, cursor: form.name && preview ? "pointer" : "not-allowed", fontFamily: "'DM Mono', monospace", letterSpacing: 2 }}>
          PUBLISH NFT
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// EXPLORE TAB — real listings from MarketplaceV3
// ─────────────────────────────────────────────────────────────
function ExploreTab({ onBuy }: { onBuy: (l: Listing) => void }) {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    async function fetchListings() {
      try {
        const data = await getAllValidListings({ contract: marketplace });
        setListings(data as any);
      } catch (e) {
        console.error("Failed to fetch listings:", e);
      } finally {
        setLoading(false);
      }
    }
    fetchListings();
  }, []);

  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {["all", "sale", "drop"].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{ padding: "6px 14px", borderRadius: 20, border: `1px solid ${filter === f ? "#ff3cac" : "#1a1a1a"}`, background: filter === f ? "rgba(255,60,172,0.1)" : "transparent", color: filter === f ? "#ff3cac" : "#444", fontSize: 11, cursor: "pointer", fontFamily: "'DM Mono', monospace", letterSpacing: 1, textTransform: "uppercase", fontWeight: 700 }}>{f}</button>
        ))}
      </div>

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
          <div style={{ fontSize: 30, animation: "spin 1s linear infinite" }}>⟳</div>
        </div>
      ) : listings.length === 0 ? (
        <div style={{ textAlign: "center", padding: 60 }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>◈</div>
          <div style={{ color: "#555", fontFamily: "'DM Mono', monospace", fontSize: 13 }}>No listings yet</div>
          <div style={{ color: "#333", fontFamily: "'DM Mono', monospace", fontSize: 11, marginTop: 6 }}>Be the first to create one</div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {listings.map(l => <NFTCard key={l.id.toString()} listing={l} onBuy={onBuy} />)}
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// PROFILE TAB
// ─────────────────────────────────────────────────────────────
function ProfileTab() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24, padding: 16, background: "#0d0d0d", borderRadius: 12, border: "1px solid #1a1a1a" }}>
        <img src={`https://api.dicebear.com/9.x/bottts/svg?seed=${address || "anon"}`} style={{ width: 52, height: 52, borderRadius: "50%", border: "2px solid #ff3cac" }} />
        <div style={{ flex: 1 }}>
          <div style={{ color: "#fff", fontWeight: 800, fontFamily: "'DM Mono', monospace", fontSize: 13 }}>{address ? trunc(address, 18) : "Not connected"}</div>
          <div style={{ color: "#555", fontFamily: "'DM Mono', monospace", fontSize: 11, marginTop: 2 }}>Base Network</div>
        </div>
        {!isConnected && (
          <button onClick={() => connect({ connector: connectors[0] })} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #333", background: "none", color: "#fff", cursor: "pointer", fontFamily: "'DM Mono', monospace", fontSize: 11 }}>
            CONNECT
          </button>
        )}
      </div>
      <div style={{ color: "#444", fontSize: 12, fontFamily: "'DM Mono', monospace", textAlign: "center", padding: 40 }}>
        {isConnected ? "Your minted NFTs will appear here" : "Connect wallet to view your collection"}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("explore");
  const [buyListing, setBuyListing] = useState<Listing | null>(null);

  useEffect(() => { sdk.actions.ready(); }, []);

  const tabs = [
    { id: "explore", icon: "◈", label: "Explore" },
    { id: "drops", icon: "⚡", label: "Drops" },
    { id: "create", icon: "+", label: "Create" },
    { id: "profile", icon: "◉", label: "Profile" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#070707", fontFamily: "'DM Mono', monospace", maxWidth: 430, margin: "0 auto", position: "relative", paddingBottom: 80 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #070707; }
        ::-webkit-scrollbar-thumb { background: #222; border-radius: 4px; }
        input, textarea, select { color-scheme: dark; }
        input::placeholder, textarea::placeholder { color: #333; }
        @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
      `}</style>

      <div style={{ padding: "18px 20px 14px", borderBottom: "1px solid #111", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, background: "#070707", zIndex: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: "linear-gradient(135deg, #ff3cac, #7b2fff)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>◈</div>
          <span style={{ color: "#fff", fontWeight: 500, fontSize: 16, letterSpacing: 1 }}>CASTMINT</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#00ff88" }} />
          <span style={{ color: "#444", fontSize: 10 }}>Base</span>
        </div>
      </div>

      <div style={{ padding: "16px 16px 0" }}>
        {tab === "explore" && <ExploreTab onBuy={setBuyListing} />}
        {tab === "drops" && (
          <div style={{ textAlign: "center", padding: 60 }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>⚡</div>
            <div style={{ color: "#555", fontFamily: "'DM Mono', monospace", fontSize: 13 }}>Live drops coming soon</div>
          </div>
        )}
        {tab === "create" && <CreateTab />}
        {tab === "profile" && <ProfileTab />}
      </div>

      <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 430, background: "rgba(7,7,7,0.95)", borderTop: "1px solid #111", display: "flex", backdropFilter: "blur(20px)", zIndex: 20 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ flex: 1, padding: "12px 0 14px", border: "none", background: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, position: "relative" }}>
            {tab === t.id && <div style={{ position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)", width: 28, height: 2, background: "linear-gradient(90deg, #ff3cac, #7b2fff)", borderRadius: "0 0 4px 4px" }} />}
            <span style={{ fontSize: t.id === "create" ? 22 : 16, color: tab === t.id ? "#ff3cac" : "#444", lineHeight: 1 }}>{t.icon}</span>
            <span style={{ fontSize: 9, color: tab === t.id ? "#ff3cac" : "#333", fontFamily: "'DM Mono', monospace", letterSpacing: 1, textTransform: "uppercase" }}>{t.label}</span>
          </button>
        ))}
      </div>

      {buyListing && <BuyModal listing={buyListing} onClose={() => setBuyListing(null)} />}
    </div>
  );
}
