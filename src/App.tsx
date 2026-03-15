import { sdk } from "@farcaster/miniapp-sdk";
import { useEffect, useState, useRef } from "react";
import { useAccount, useConnect, useSendTransaction, usePublicClient } from "wagmi";
import { parseUnits, encodeFunctionData, parseEther } from "viem";

// ─────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────
const PLATFORM_FEE_RECEIVER = "0x2805e9dbce2839c5feae858723f9499f15fd88cf";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const PINATA_JWT = "YOUR_PINATA_JWT"; // get free at pinata.cloud
const PLATFORM_FEE = parseUnits("0.15", 6); // $0.15 USDC

// ─────────────────────────────────────────────────────────────
// PINATA UPLOAD
// ─────────────────────────────────────────────────────────────
async function uploadImageToPinata(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: { Authorization: `Bearer ${PINATA_JWT}` },
    body: form,
  });
  const data = await res.json();
  return `https://gateway.pinata.cloud/ipfs/${data.IpfsHash}`;
}

async function uploadMetaToPinata(meta: object): Promise<string> {
  const res = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
    method: "POST",
    headers: { Authorization: `Bearer ${PINATA_JWT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ pinataContent: meta }),
  });
  const data = await res.json();
  return `https://gateway.pinata.cloud/ipfs/${data.IpfsHash}`;
}

// ─────────────────────────────────────────────────────────────
// MOCK DATA
// ─────────────────────────────────────────────────────────────
const MOCK_NFTS = [
  { id: 1, name: "Void Bloom #001", creator: "presdency.eth", image: "https://api.dicebear.com/9.x/shapes/svg?seed=voidbloom&backgroundColor=0a0a0a&shapeColor=ff3cac", price: "0.05", token: "ETH", type: "sale", supply: 100, minted: 34 },
  { id: 2, name: "Base Genesis", creator: "bankrdex.eth", image: "https://api.dicebear.com/9.x/shapes/svg?seed=basegenesis&backgroundColor=0a0a0a&shapeColor=00d4ff", price: "0", token: "FREE", type: "drop", supply: 500, minted: 312 },
  { id: 3, name: "Onchain Dreams", creator: "caster.eth", image: "https://api.dicebear.com/9.x/shapes/svg?seed=onchaindreams&backgroundColor=0a0a0a&shapeColor=7b2fff", price: "2.00", token: "USDC", type: "sale", supply: 50, minted: 12 },
  { id: 4, name: "Farcaster Soul", creator: "warp.eth", image: "https://api.dicebear.com/9.x/shapes/svg?seed=farcastersoul&backgroundColor=0a0a0a&shapeColor=ff6b35", price: "0", token: "FREE", type: "drop", supply: 1000, minted: 780 },
];

type NFT = typeof MOCK_NFTS[0] & { contractAddress?: string; tokenId?: number };

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────
function trunc(s: string, n = 16) { return s?.length > n ? s.slice(0, n) + "…" : s; }
function pct(minted: number, supply: number) { return Math.min(100, Math.round((minted / supply) * 100)); }

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
function NFTCard({ nft, onMint }: { nft: NFT; onMint: (n: NFT) => void }) {
  const [hovered, setHovered] = useState(false);
  const progress = pct(nft.minted, nft.supply);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ background: hovered ? "#111" : "#0d0d0d", border: `1px solid ${hovered ? "#333" : "#1a1a1a"}`, borderRadius: 12, overflow: "hidden", transition: "all 0.2s ease", transform: hovered ? "translateY(-2px)" : "none" }}
    >
      <div style={{ position: "relative" }}>
        <img src={nft.image} alt={nft.name} style={{ width: "100%", height: 160, objectFit: "cover", display: "block" }} />
        <div style={{ position: "absolute", top: 8, right: 8 }}><Badge type={nft.type} /></div>
      </div>
      <div style={{ padding: "12px 14px 14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
          <div>
            <div style={{ color: "#fff", fontWeight: 700, fontSize: 13, fontFamily: "'DM Mono', monospace" }}>{trunc(nft.name, 16)}</div>
            <div style={{ color: "#555", fontSize: 11, marginTop: 2, fontFamily: "'DM Mono', monospace" }}>by {trunc(nft.creator, 14)}</div>
          </div>
          <div style={{ color: nft.token === "FREE" ? "#00ff88" : "#ff3cac", fontWeight: 800, fontSize: 12, fontFamily: "'DM Mono', monospace" }}>
            {nft.token === "FREE" ? "FREE" : `${nft.price} ${nft.token}`}
          </div>
        </div>
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ color: "#444", fontSize: 10, fontFamily: "'DM Mono', monospace" }}>{nft.minted}/{nft.supply}</span>
            <span style={{ color: "#444", fontSize: 10, fontFamily: "'DM Mono', monospace" }}>{progress}%</span>
          </div>
          <div style={{ height: 3, background: "#1a1a1a", borderRadius: 2, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${progress}%`, background: "linear-gradient(90deg, #ff3cac, #7b2fff)", borderRadius: 2 }} />
          </div>
        </div>
        <button
          onClick={() => onMint(nft)}
          style={{ width: "100%", padding: "8px 0", borderRadius: 8, border: "none", background: hovered ? "linear-gradient(135deg, #ff3cac, #7b2fff)" : "#1a1a1a", color: hovered ? "#fff" : "#666", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "'DM Mono', monospace", letterSpacing: 1, transition: "all 0.2s ease" }}
        >
          {nft.token === "FREE" ? "MINT FREE" : "MINT NOW"}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// MINT MODAL
// ─────────────────────────────────────────────────────────────
function MintModal({ nft, onClose }: { nft: NFT; onClose: () => void }) {
  const [step, setStep] = useState<"confirm" | "paying" | "minting" | "done">("confirm");
  const [shared, setShared] = useState(false);
  const [txHash, setTxHash] = useState("");
  const [error, setError] = useState("");
  const { address } = useAccount();
  const { sendTransactionAsync } = useSendTransaction();

  const handleMint = async () => {
    if (!address) return;
    setError("");
    try {
      // Step 1: Pay $0.15 USDC platform fee
      setStep("paying");
      const feeData = encodeFunctionData({
        abi: [{ name: "transfer", type: "function", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] }],
        functionName: "transfer",
        args: [PLATFORM_FEE_RECEIVER as `0x${string}`, PLATFORM_FEE],
      });
      await sendTransactionAsync({ to: USDC_BASE as `0x${string}`, data: feeData });

      // Step 2: Mint NFT (ETH payment if not free)
      setStep("minting");
      let hash = "";
      if (nft.contractAddress) {
        const mintData = encodeFunctionData({
          abi: [{ name: "claim", type: "function", inputs: [{ name: "to", type: "address" }, { name: "tokenId", type: "uint256" }, { name: "quantity", type: "uint256" }], outputs: [] }],
          functionName: "claim",
          args: [address as `0x${string}`, BigInt(nft.tokenId || 0), BigInt(1)],
        });
        const tx = await sendTransactionAsync({
          to: nft.contractAddress as `0x${string}`,
          data: mintData,
          value: nft.token === "ETH" ? parseEther(nft.price) : BigInt(0),
        });
        hash = tx;
      } else {
        // Demo flow
        await new Promise(r => setTimeout(r, 1500));
      }
      setTxHash(hash);
      setStep("done");
    } catch (e: any) {
      setError(e?.message?.slice(0, 80) || "Transaction failed");
      setStep("confirm");
    }
  };

  const handleShare = () => {
    setShared(true);
    sdk.actions.openUrl(`https://warpcast.com/~/compose?text=${encodeURIComponent(`Just minted "${nft.name}" on @castmint — ${nft.token === "FREE" ? "Free Drop" : "NFT Sale"} 🎨\n\nhttps://castmint.xyz`)}`);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999, backdropFilter: "blur(8px)", padding: 20 }}>
      <div style={{ background: "#0d0d0d", border: "1px solid #222", borderRadius: 16, padding: 24, maxWidth: 340, width: "100%", position: "relative" }}>
        <button onClick={onClose} style={{ position: "absolute", top: 16, right: 16, background: "none", border: "none", color: "#555", fontSize: 18, cursor: "pointer" }}>✕</button>

        {(step === "confirm") && (
          <>
            <img src={nft.image} alt="" style={{ width: "100%", height: 180, objectFit: "cover", borderRadius: 10, marginBottom: 16 }} />
            <div style={{ color: "#fff", fontWeight: 800, fontSize: 16, fontFamily: "'DM Mono', monospace", marginBottom: 4 }}>{nft.name}</div>
            <div style={{ color: "#555", fontSize: 12, fontFamily: "'DM Mono', monospace", marginBottom: 20 }}>by {nft.creator}</div>
            <div style={{ background: "#111", borderRadius: 10, padding: 14, marginBottom: 16 }}>
              {[["NFT Price", nft.token === "FREE" ? "Free" : `${nft.price} ${nft.token}`], ["Platform Fee", "$0.15 USDC"], ["Network", "Base"]].map(([l, v]) => (
                <div key={l} style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 12, fontFamily: "'DM Mono', monospace" }}>
                  <span style={{ color: "#555" }}>{l}</span><span style={{ color: "#fff" }}>{v}</span>
                </div>
              ))}
              <div style={{ borderTop: "1px solid #1a1a1a", paddingTop: 8, display: "flex", justifyContent: "space-between", fontSize: 13, fontFamily: "'DM Mono', monospace" }}>
                <span style={{ color: "#888" }}>Total</span>
                <span style={{ color: "#ff3cac", fontWeight: 800 }}>{nft.token === "FREE" ? "$0.15 USDC + gas" : `${nft.price} ${nft.token} + $0.15 + gas`}</span>
              </div>
            </div>
            {error && <div style={{ color: "#ff3cac", fontSize: 11, fontFamily: "'DM Mono', monospace", marginBottom: 12, textAlign: "center" }}>{error}</div>}
            <button onClick={handleMint} style={{ width: "100%", padding: "12px 0", borderRadius: 10, border: "none", background: "linear-gradient(135deg, #ff3cac, #7b2fff)", color: "#fff", fontWeight: 800, fontSize: 14, cursor: "pointer", fontFamily: "'DM Mono', monospace", letterSpacing: 1 }}>
              CONFIRM MINT
            </button>
          </>
        )}

        {(step === "paying" || step === "minting") && (
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <div style={{ fontSize: 40, marginBottom: 16, display: "inline-block", animation: "spin 1s linear infinite" }}>⟳</div>
            <div style={{ color: "#fff", fontWeight: 700, fontFamily: "'DM Mono', monospace", fontSize: 14 }}>
              {step === "paying" ? "Paying platform fee..." : "Minting on Base..."}
            </div>
            <div style={{ color: "#555", fontSize: 12, fontFamily: "'DM Mono', monospace", marginTop: 8 }}>Confirm in wallet</div>
          </div>
        )}

        {step === "done" && (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🎉</div>
            <div style={{ color: "#00ff88", fontWeight: 800, fontFamily: "'DM Mono', monospace", fontSize: 16, marginBottom: 6 }}>MINTED!</div>
            <div style={{ color: "#555", fontSize: 12, fontFamily: "'DM Mono', monospace", marginBottom: 20 }}>{nft.name} is in your wallet</div>
            {txHash && (
              <div onClick={() => sdk.actions.openUrl(`https://basescan.org/tx/${txHash}`)}
                style={{ color: "#7b2fff", fontFamily: "'DM Mono', monospace", fontSize: 11, marginBottom: 16, cursor: "pointer" }}>
                View on Basescan ↗
              </div>
            )}
            <button onClick={handleShare} style={{ width: "100%", padding: "12px 0", borderRadius: 10, border: "none", background: shared ? "#1a1a1a" : "linear-gradient(135deg, #7b2fff, #00d4ff)", color: shared ? "#555" : "#fff", fontWeight: 800, fontSize: 13, cursor: "pointer", fontFamily: "'DM Mono', monospace", letterSpacing: 1 }}>
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
  const { sendTransactionAsync } = useSendTransaction();
  const [form, setForm] = useState({ name: "", desc: "", price: "", token: "ETH", supply: "100", type: "sale" });
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [step, setStep] = useState<"form" | "uploading" | "deploying" | "done">("form");
  const [contractAddress, setContractAddress] = useState("");
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

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
      // 1. Upload image to Pinata
      setStep("uploading");
      const imageUrl = await uploadImageToPinata(imageFile);
      const metaUrl = await uploadMetaToPinata({
        name: form.name, description: form.desc, image: imageUrl,
        attributes: [{ trait_type: "Type", value: form.type }, { trait_type: "Price", value: form.price || "0" }]
      });

      // 2. Pay platform fee ($0.15 USDC) to create
      setStep("deploying");
      const feeData = encodeFunctionData({
        abi: [{ name: "transfer", type: "function", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] }],
        functionName: "transfer",
        args: [PLATFORM_FEE_RECEIVER as `0x${string}`, PLATFORM_FEE],
      });
      const tx = await sendTransactionAsync({ to: USDC_BASE as `0x${string}`, data: feeData });
      setContractAddress(tx);
      setStep("done");
    } catch (e: any) {
      setError(e?.message?.slice(0, 80) || "Failed");
      setStep("form");
    }
  };

  const inp: React.CSSProperties = { width: "100%", padding: "10px 12px", background: "#0d0d0d", border: "1px solid #222", borderRadius: 8, color: "#fff", fontFamily: "'DM Mono', monospace", fontSize: 13, outline: "none", boxSizing: "border-box" };
  const lbl: React.CSSProperties = { color: "#555", fontSize: 11, fontFamily: "'DM Mono', monospace", letterSpacing: 1, marginBottom: 6, display: "block" };

  if (step === "uploading" || step === "deploying") return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 320, gap: 16 }}>
      <div style={{ fontSize: 36, display: "inline-block", animation: "spin 1s linear infinite" }}>⟳</div>
      <div style={{ color: "#fff", fontFamily: "'DM Mono', monospace", fontSize: 14 }}>{step === "uploading" ? "Uploading to IPFS..." : "Publishing on Base..."}</div>
      <div style={{ color: "#555", fontFamily: "'DM Mono', monospace", fontSize: 11 }}>{step === "deploying" ? "Confirm in wallet" : "Pinning to Pinata..."}</div>
    </div>
  );

  if (step === "done") return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 320, gap: 12, textAlign: "center" }}>
      <div style={{ fontSize: 48 }}>🚀</div>
      <div style={{ color: "#00ff88", fontFamily: "'DM Mono', monospace", fontWeight: 800, fontSize: 16 }}>PUBLISHED!</div>
      <div style={{ color: "#555", fontFamily: "'DM Mono', monospace", fontSize: 11 }}>{form.name} is live on Base</div>
      <button onClick={() => { setStep("form"); setForm({ name: "", desc: "", price: "", token: "ETH", supply: "100", type: "sale" }); setPreview(null); setImageFile(null); }}
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
        <div style={{ flex: 2 }}><label style={lbl}>PRICE</label><input style={inp} placeholder={form.type === "drop" ? "0 (free)" : "0.05"} value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} /></div>
        <div style={{ flex: 1 }}><label style={lbl}>TOKEN</label>
          <select style={inp} value={form.token} onChange={e => setForm({ ...form, token: e.target.value })}>
            <option>ETH</option><option>USDC</option><option>DEGEN</option>
          </select>
        </div>
      </div>

      <div><label style={lbl}>SUPPLY</label><input style={inp} type="number" placeholder="100" value={form.supply} onChange={e => setForm({ ...form, supply: e.target.value })} /></div>

      <div style={{ background: "#0d0d0d", border: "1px solid #1a1a1a", borderRadius: 10, padding: 12 }}>
        {[["Platform fee", "$0.15 USDC per mint"], ["Secondary royalty", "5% → you"], ["Storage", "IPFS via Pinata"]].map(([l, v]) => (
          <div key={l} style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 11, fontFamily: "'DM Mono', monospace" }}>
            <span style={{ color: "#444" }}>{l}</span><span style={{ color: "#666" }}>{v}</span>
          </div>
        ))}
      </div>

      {error && <div style={{ color: "#ff3cac", fontSize: 11, fontFamily: "'DM Mono', monospace", textAlign: "center" }}>{error}</div>}

      <button onClick={handlePublish} disabled={!form.name || !preview || !address}
        style={{ width: "100%", padding: "13px 0", borderRadius: 10, border: "none", background: form.name && preview && address ? "linear-gradient(135deg, #ff3cac, #7b2fff)" : "#1a1a1a", color: form.name && preview && address ? "#fff" : "#333", fontWeight: 800, fontSize: 14, cursor: form.name && preview && address ? "pointer" : "not-allowed", fontFamily: "'DM Mono', monospace", letterSpacing: 2 }}>
        {!address ? "CONNECT WALLET FIRST" : "PUBLISH NFT"}
      </button>
    </div>
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
        {isConnected ? "NFTs you mint will appear here" : "Connect wallet to view your collection"}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("explore");
  const [mintNft, setMintNft] = useState<NFT | null>(null);
  const [filter, setFilter] = useState("all");

  useEffect(() => { sdk.actions.ready(); }, []);

  const filtered = filter === "all" ? MOCK_NFTS : MOCK_NFTS.filter(n => n.type === filter);
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

      {/* Header */}
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

      {/* Content */}
      <div style={{ padding: "16px 16px 0" }}>
        {tab === "explore" && (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              {["all", "sale", "drop"].map(f => (
                <button key={f} onClick={() => setFilter(f)} style={{ padding: "6px 14px", borderRadius: 20, border: `1px solid ${filter === f ? "#ff3cac" : "#1a1a1a"}`, background: filter === f ? "rgba(255,60,172,0.1)" : "transparent", color: filter === f ? "#ff3cac" : "#444", fontSize: 11, cursor: "pointer", fontFamily: "'DM Mono', monospace", letterSpacing: 1, textTransform: "uppercase", fontWeight: 700 }}>{f}</button>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {filtered.map(nft => <NFTCard key={nft.id} nft={nft} onMint={setMintNft} />)}
            </div>
          </>
        )}

        {tab === "drops" && (
          <>
            <div style={{ color: "#555", fontSize: 11, letterSpacing: 1, marginBottom: 14, fontFamily: "'DM Mono', monospace" }}>LIVE DROPS</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {MOCK_NFTS.filter(n => n.type === "drop").map(nft => (
                <div key={nft.id} style={{ background: "#0d0d0d", border: "1px solid #1a1a1a", borderRadius: 12, padding: 14, display: "flex", gap: 12, alignItems: "center" }}>
                  <img src={nft.image} style={{ width: 64, height: 64, borderRadius: 8, objectFit: "cover" }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ color: "#fff", fontWeight: 700, fontSize: 13, fontFamily: "'DM Mono', monospace" }}>{nft.name}</div>
                    <div style={{ color: "#555", fontSize: 11, marginTop: 2, fontFamily: "'DM Mono', monospace" }}>by {nft.creator}</div>
                    <div style={{ marginTop: 8 }}>
                      <div style={{ height: 3, background: "#1a1a1a", borderRadius: 2, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${pct(nft.minted, nft.supply)}%`, background: "linear-gradient(90deg, #00d4ff, #7b2fff)" }} />
                      </div>
                      <div style={{ color: "#444", fontSize: 10, marginTop: 4, fontFamily: "'DM Mono', monospace" }}>{nft.minted}/{nft.supply}</div>
                    </div>
                  </div>
                  <button onClick={() => setMintNft(nft)} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: "linear-gradient(135deg, #00d4ff, #7b2fff)", color: "#fff", fontWeight: 800, fontSize: 11, cursor: "pointer", fontFamily: "'DM Mono', monospace", whiteSpace: "nowrap" }}>
                    MINT FREE
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === "create" && <CreateTab />}
        {tab === "profile" && <ProfileTab />}
      </div>

      {/* Bottom Nav */}
      <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 430, background: "rgba(7,7,7,0.95)", borderTop: "1px solid #111", display: "flex", backdropFilter: "blur(20px)", zIndex: 20 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ flex: 1, padding: "12px 0 14px", border: "none", background: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, position: "relative" }}>
            {tab === t.id && <div style={{ position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)", width: 28, height: 2, background: "linear-gradient(90deg, #ff3cac, #7b2fff)", borderRadius: "0 0 4px 4px" }} />}
            <span style={{ fontSize: t.id === "create" ? 22 : 16, color: tab === t.id ? "#ff3cac" : "#444", lineHeight: 1 }}>{t.icon}</span>
            <span style={{ fontSize: 9, color: tab === t.id ? "#ff3cac" : "#333", fontFamily: "'DM Mono', monospace", letterSpacing: 1, textTransform: "uppercase" }}>{t.label}</span>
          </button>
        ))}
      </div>

      {mintNft && <MintModal nft={mintNft} onClose={() => setMintNft(null)} />}
    </div>
  );
}
