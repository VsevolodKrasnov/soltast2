// frontend/src/App.jsx
// PRO дизайн из твоего кода + DEV оригинальный
import React, { useState } from "react";
import WalletCreator from "./components/WalletCreator.jsx";
import FundingPanel from "./components/FundingPanel.jsx";
import SmartBuyPanel from "./components/SmartBuyPanel.jsx";
import TradePanel from "./components/TradePanel.jsx";
import ProTradingPanel from "./components/ProTradingPanel.jsx";
import FreshTracker from "./components/FreshTracker.jsx";
import './ProTradingPanel.css';

export default function App() {
  const [currentPage, setCurrentPage] = useState('dev'); // 'dev' | 'pro'
  const [wallets, setWallets] = useState([]);
  const [selectedWallets, setSelectedWallets] = useState([]);
  const [mint, setMint] = useState("");

  const API = "http://localhost:4000";

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

  const selectedWalletObjects = wallets.filter((w) =>
    selectedWallets.includes(w.publicKey)
  );

  return (
    <div className={currentPage === 'pro' ? 'app-root-pro' : 'app-root'}>
      {/* Sidebar - разный для PRO и DEV */}
      {currentPage === 'pro' ? (
        // PRO SIDEBAR (твой дизайн)
        <aside className="sidebar-pro">
          <h1 className="logo-pro">
            Solana
            <br />
            Bundler
          </h1>
          <p className="subtitle-pro">Pump.fun multi-wallet panel</p>
          
          <nav className="page-tabs-pro">
            <div 
              className={`page-tab-pro ${currentPage === 'dev' ? 'active' : ''}`}
              onClick={() => setCurrentPage('dev')}
            >
              🛠️ DEV
            </div>
            <div 
              className={`page-tab-pro ${currentPage === 'pro' ? 'active' : ''}`}
              onClick={() => setCurrentPage('pro')}
            >
              ⚡ PRO
            </div>
          </nav>

          <nav className="sidebar-nav-pro">
            <span>1. Generate wallets</span>
            <span>2. SOL distribution</span>
            <span>3. Trading operations</span>
            <span>4. Smart buy & sell</span>
          </nav>
        </aside>
      ) : (
        // DEV SIDEBAR (оригинальный)
        <aside className="sidebar">
          <h1 className="logo">
            Solana
            <br />
            Bundler
          </h1>
          <p className="subtitle">Pump.fun multi-wallet panel</p>
          
          {/* Кнопки переключения */}
          <div style={{
            display: 'flex',
            gap: '8px',
            marginBottom: '16px',
            padding: '8px',
            background: 'rgba(0,0,0,0.2)',
            borderRadius: '8px'
          }}>
            <button
              onClick={() => setCurrentPage('dev')}
              style={{
                flex: 1,
                padding: '8px',
                borderRadius: '6px',
                border: 'none',
                background: currentPage === 'dev' 
                  ? 'linear-gradient(135deg, #c69fff, #b478ff)' 
                  : 'rgba(255,255,255,0.05)',
                color: currentPage === 'dev' ? '#020617' : '#9ca3af',
                fontWeight: 600,
                fontSize: '13px',
                cursor: 'pointer'
              }}
            >
              🛠️ DEV
            </button>
            <button
              onClick={() => setCurrentPage('pro')}
              style={{
                flex: 1,
                padding: '8px',
                borderRadius: '6px',
                border: 'none',
                background: currentPage === 'pro' 
                  ? 'linear-gradient(135deg, #c69fff, #b478ff)' 
                  : 'rgba(255,255,255,0.05)',
                color: currentPage === 'pro' ? '#020617' : '#9ca3af',
                fontWeight: 600,
                fontSize: '13px',
                cursor: 'pointer'
              }}
            >
              ⚡ PRO
            </button>
          </div>

          <nav className="sidebar-nav">
            <span>1. Generate wallets</span>
            <span>2. SOL distribution</span>
            <span>3. Buy / Sell like Axiom</span>
          </nav>
        </aside>
      )}

      {/* Main Content */}
      {currentPage === 'pro' ? (
        // ⚡ PRO PAGE (твой дизайн)
        <div className="pro-layout">
          <div className="pro-trading-column">
            <ProTradingPanel
              wallets={wallets}
              selectedWallets={selectedWallets}
              setSelectedWallets={setSelectedWallets}
              mint={mint}
              setMint={setMint}
              callBackend={callBackend}
            />
          </div>

          <div className="fresh-tracker-column">
            <FreshTracker
              onCopyAddress={(address) => {
                setMint(address);
                console.log('📋 Token copied to mint:', address);
              }}
              mint={mint}
              setMint={setMint}
            />
          </div>
        </div>
      ) : (
        // 🛠️ DEV PAGE (оригинальный layout)
        <main className="main">
          <section className="panel-grid-vertical-left">
            {/* LEFT COLUMN */}
            <div className="left-col">
              <div className="card">
                <WalletCreator
                  wallets={wallets}
                  setWallets={setWallets}
                  setSelectedWallets={setSelectedWallets}
                />
              </div>

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
      )}

      <style jsx>{`
        /* ========================================== */
        /* PRO STYLES (твой дизайн) */
        /* ========================================== */
        .app-root-pro {
          display: flex;
          height: 100vh;
          background: #0f0f23;
          color: #e0e0e0;
        }

        .sidebar-pro {
          width: 240px;
          background: linear-gradient(180deg, #1a1a2e 0%, #16213e 100%);
          padding: 24px 16px;
          border-right: 2px solid #2d2d44;
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .logo-pro {
          font-size: 28px;
          font-weight: 700;
          background: linear-gradient(135deg, #b478ff 0%, #7c3aed 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          line-height: 1.2;
          margin: 0;
        }

        .subtitle-pro {
          font-size: 12px;
          color: #9ca3af;
          margin: -16px 0 0 0;
        }

        .page-tabs-pro {
          display: flex;
          gap: 8px;
          padding: 8px;
          background: rgba(0, 0, 0, 0.2);
          border-radius: 8px;
        }

        .page-tab-pro {
          flex: 1;
          padding: 10px;
          text-align: center;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.3s;
          font-weight: 600;
          font-size: 14px;
          background: rgba(255, 255, 255, 0.05);
          color: #9ca3af;
        }

        .page-tab-pro:hover {
          background: rgba(255, 255, 255, 0.1);
          color: white;
        }

        .page-tab-pro.active {
          background: linear-gradient(135deg, #b478ff 0%, #7c3aed 100%);
          color: white;
        }

        .sidebar-nav-pro {
          display: flex;
          flex-direction: column;
          gap: 8px;
          font-size: 13px;
          color: #9ca3af;
        }

        .sidebar-nav-pro span {
          padding: 8px 12px;
          border-left: 2px solid transparent;
          transition: all 0.2s;
        }

        .sidebar-nav-pro span:hover {
          border-left-color: #b478ff;
          color: white;
          padding-left: 16px;
        }

        .pro-layout {
          flex: 1;
          display: flex;
          overflow: hidden;
        }

        .pro-trading-column {
          flex: 2;
          padding: 24px;
          overflow-y: auto;
          background: #16213e;
          border-right: 2px solid #2d2d44;
        }

        .fresh-tracker-column {
          flex: 1;
          min-width: 400px;
          max-width: 500px;
          background: #1a1a2e;
          display: flex;
          flex-direction: column;
        }

        /* Scrollbar for PRO */
        .pro-trading-column::-webkit-scrollbar,
        .fresh-tracker-column::-webkit-scrollbar {
          width: 8px;
        }

        .pro-trading-column::-webkit-scrollbar-track,
        .fresh-tracker-column::-webkit-scrollbar-track {
          background: rgba(0, 0, 0, 0.2);
        }

        .pro-trading-column::-webkit-scrollbar-thumb,
        .fresh-tracker-column::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.2);
          border-radius: 4px;
        }

        .pro-trading-column::-webkit-scrollbar-thumb:hover,
        .fresh-tracker-column::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.3);
        }

        /* ========================================== */
        /* DEV STYLES (оригинальные - НЕ ТРОГАТЬ) */
        /* ========================================== */
        /* Эти стили для DEV страницы берутся из App.css */
        /* Здесь только минимальные инлайн стили для кнопок */
      `}</style>
    </div>
  );
}