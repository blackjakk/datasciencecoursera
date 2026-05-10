import React, { useState } from "react";
import { useWallet } from "./hooks/useWallet.js";
import { useContracts } from "./hooks/useContracts.js";
import WalletConnect from "./components/WalletConnect.jsx";
import Dashboard     from "./components/Dashboard.jsx";
import TeamManager   from "./components/TeamManager.jsx";
import DraftRoom     from "./components/DraftRoom.jsx";
import FreeAgencyMarket from "./components/FreeAgencyMarket.jsx";
import GameViewer    from "./components/GameViewer.jsx";
import Standings     from "./components/Standings.jsx";

const TABS = [
  { id: "dashboard", label: "🏠 Dashboard" },
  { id: "teams",     label: "🏟️ Teams" },
  { id: "draft",     label: "📋 Draft" },
  { id: "fa",        label: "💰 Free Agency" },
  { id: "game",      label: "🏈 Simulate" },
  { id: "standings", label: "📊 Standings" },
];

export default function App() {
  const [tab, setTab] = useState("dashboard");
  const wallet        = useWallet();
  const contracts     = useContracts(wallet.signer || wallet.provider);

  return (
    <div className="app">
      <nav className="nav">
        <a className="nav-logo" href="#">Gridiron<span>Chain</span></a>
        <div className="nav-tabs">
          {TABS.map(t => (
            <button
              key={t.id}
              className={`nav-tab${tab === t.id ? " active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="nav-wallet">
          <WalletConnect wallet={wallet} contracts={contracts} />
        </div>
      </nav>

      <main className="main">
        {tab === "dashboard" && <Dashboard  wallet={wallet} contracts={contracts} />}
        {tab === "teams"     && <TeamManager wallet={wallet} contracts={contracts} />}
        {tab === "draft"     && <DraftRoom   wallet={wallet} contracts={contracts} />}
        {tab === "fa"        && <FreeAgencyMarket wallet={wallet} contracts={contracts} />}
        {tab === "game"      && <GameViewer  wallet={wallet} contracts={contracts} />}
        {tab === "standings" && <Standings   wallet={wallet} contracts={contracts} />}
      </main>
    </div>
  );
}
