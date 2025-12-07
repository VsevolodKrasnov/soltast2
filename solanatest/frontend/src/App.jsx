import React, { useState } from "react";
import WalletCreator from "./components/WalletCreator.jsx";
import FundingPanel from "./components/FundingPanel.jsx";
import SmartBuyPanel from "./components/SmartBuyPanel.jsx";
import TradePanel from "./components/TradePanel.jsx";

export default function App() {
  const [wallets, setWallets] = useState([]); // [{ publicKey, secretKey }]
  const [selectedWallets, setSelectedWallets] = useState([]); // array of pubkeys
  const [mint, setMint] = useState("");

  // ======================================
  // 🔥 BACKEND BASE URL (ВАЖНО!)
  // ======================================
  const API = "http://localhost:4000";

  // ======================================
  // 🔥 Единая функция взаимодействия с backend
  // ======================================
  const callBackend = async (url, body = {}) => {
    try {
      const res = await fetch(API + url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (data.error) throw new Error(data.error);
      return data;
    } catch (err) {
      console.error("Backend error:", err.message);
      throw err;
    }
  };

  // ======================================
  // Получить объекты выбранных кошельков
  // ======================================
  const selectedWalletObjects = wallets.filter((w) =>
    selectedWallets.includes(w.publicKey)
  );

  return (
    <div className="app-root">
      <aside className="sidebar">
        <h1 className="logo">
          Solana
          <br />
          Bundler
        </h1>
        <p className="subtitle">Pump.fun multi-wallet panel</p>
        <nav className="sidebar-nav">
          <span>1. Generate wallets</span>
          <span>2. SOL distribution</span>
          <span>3. Buy / Sell like Axiom</span>
        </nav>
      </aside>

      <main className="main">
        <section className="panel-grid-vertical-left">
          {/* LEFT COLUMN */}
          <div className="left-col">
            {/* Wallet Creator */}
            <div className="card">
              <WalletCreator
                wallets={wallets}
                setWallets={setWallets}
                setSelectedWallets={setSelectedWallets}
              />
            </div>

            {/* Funding Panel */}
            <div className="card" style={{ marginTop: 20 }}>
              <FundingPanel
                wallets={wallets}
                selectedWallets={selectedWallets}
                setSelectedWallets={setSelectedWallets}
                mint={mint}
                setMint={setMint}
                callBackend={callBackend}
              />
            </div>
          </div>

          {/* MIDDLE COLUMN — SMART BUY */}
          <div className="card">
            <SmartBuyPanel
              wallets={wallets}
              selectedWallets={selectedWallets}
              selectedWalletObjects={selectedWalletObjects}
              mint={mint}
              priorityFee={0.0001}
              slippage={10}
              lamportsFromSol={(x) => Math.floor(Number(x) * 1e9)}
              callBackend={callBackend}
            />
          </div>

          {/* RIGHT COLUMN — MANUAL BUY/SELL */}
          <div className="card">
            <TradePanel
              wallets={wallets}
              selectedWallets={selectedWallets}
              setSelectedWallets={setSelectedWallets}
              mint={mint}
              setMint={setMint}
              callBackend={callBackend}
            />
          </div>
        </section>
      </main>
    </div>
  );
}
