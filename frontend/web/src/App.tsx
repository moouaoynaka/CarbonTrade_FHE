import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface CarbonTradeData {
  id: string;
  name: string;
  carbonCredits: string;
  price: string;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [trades, setTrades] = useState<CarbonTradeData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingTrade, setCreatingTrade] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newTradeData, setNewTradeData] = useState({ name: "", credits: "", price: "" });
  const [selectedTrade, setSelectedTrade] = useState<CarbonTradeData | null>(null);
  const [decryptedData, setDecryptedData] = useState<{ credits: number | null; price: number | null }>({ credits: null, price: null });
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterVerified, setFilterVerified] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const tradesList: CarbonTradeData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          tradesList.push({
            id: businessId,
            name: businessData.name,
            carbonCredits: businessId,
            price: businessId,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setTrades(tradesList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createTrade = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingTrade(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating carbon trade with FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const creditsValue = parseInt(newTradeData.credits) || 0;
      const businessId = `carbon-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, creditsValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newTradeData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newTradeData.price) || 0,
        0,
        "Carbon Credit Trade"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Carbon trade created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewTradeData({ name: "", credits: "", price: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingTrade(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted and verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const callIsAvailable = async () => {
    try {
      const contract = await getContractWithSigner();
      if (!contract) return;
      
      setTransactionStatus({ visible: true, status: "pending", message: "Checking availability..." });
      const tx = await contract.isAvailable();
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Contract is available!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredTrades = trades.filter(trade => {
    const matchesSearch = trade.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = !filterVerified || trade.isVerified;
    return matchesSearch && matchesFilter;
  });

  const stats = {
    totalTrades: trades.length,
    verifiedTrades: trades.filter(t => t.isVerified).length,
    totalVolume: trades.reduce((sum, t) => sum + t.publicValue1, 0),
    avgPrice: trades.length > 0 ? trades.reduce((sum, t) => sum + t.publicValue2, 0) / trades.length : 0
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>🌿 Confidential Carbon Trading</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🌿</div>
            <h2>Connect Your Wallet to Access Carbon Market</h2>
            <p>Private carbon credit trading with FHE encryption for enterprise data protection</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading carbon trading platform...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>🌿 Confidential Carbon Trading</h1>
          <p>FHE Protected Carbon Credit Marketplace</p>
        </div>
        
        <div className="header-actions">
          <button onClick={callIsAvailable} className="availability-btn">
            Check Availability
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + New Trade
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="stats-panel">
          <div className="stat-card">
            <h3>Total Trades</h3>
            <div className="stat-value">{stats.totalTrades}</div>
          </div>
          <div className="stat-card">
            <h3>Verified</h3>
            <div className="stat-value">{stats.verifiedTrades}</div>
          </div>
          <div className="stat-card">
            <h3>Total Volume</h3>
            <div className="stat-value">{stats.totalVolume}</div>
          </div>
          <div className="stat-card">
            <h3>Avg Price</h3>
            <div className="stat-value">${stats.avgPrice.toFixed(2)}</div>
          </div>
        </div>

        <div className="search-filters">
          <div className="search-box">
            <input 
              type="text" 
              placeholder="Search carbon trades..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="filters">
            <label>
              <input 
                type="checkbox" 
                checked={filterVerified}
                onChange={(e) => setFilterVerified(e.target.checked)}
              />
              Show Verified Only
            </label>
            <button onClick={loadData} className="refresh-btn">
              Refresh
            </button>
          </div>
        </div>

        <div className="trades-list">
          {filteredTrades.length === 0 ? (
            <div className="no-trades">
              <p>No carbon trades found</p>
              <button onClick={() => setShowCreateModal(true)} className="create-btn">
                Create First Trade
              </button>
            </div>
          ) : (
            filteredTrades.map((trade, index) => (
              <div 
                className={`trade-item ${trade.isVerified ? "verified" : ""}`}
                key={index}
                onClick={() => setSelectedTrade(trade)}
              >
                <div className="trade-header">
                  <h3>{trade.name}</h3>
                  <span className={`status ${trade.isVerified ? "verified" : "pending"}`}>
                    {trade.isVerified ? "✅ Verified" : "🔒 Encrypted"}
                  </span>
                </div>
                <div className="trade-details">
                  <div className="detail">
                    <span>Price:</span>
                    <strong>${trade.publicValue2}</strong>
                  </div>
                  <div className="detail">
                    <span>Credits:</span>
                    <strong>{trade.isVerified ? trade.decryptedValue : "🔒 FHE Encrypted"}</strong>
                  </div>
                  <div className="detail">
                    <span>Creator:</span>
                    <span>{trade.creator.substring(0, 8)}...</span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateTrade 
          onSubmit={createTrade} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingTrade} 
          tradeData={newTradeData} 
          setTradeData={setNewTradeData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedTrade && (
        <TradeDetailModal 
          trade={selectedTrade} 
          onClose={() => { 
            setSelectedTrade(null); 
            setDecryptedData({ credits: null, price: null }); 
          }} 
          decryptedData={decryptedData} 
          setDecryptedData={setDecryptedData} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedTrade.id)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <div className="footer-content">
          <p>🌿 Confidential Carbon Trading Platform - FHE Protected Transactions</p>
          <div className="footer-links">
            <span>ESG Compliant</span>
            <span>Privacy First</span>
            <span>Enterprise Ready</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

const ModalCreateTrade: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  tradeData: any;
  setTradeData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, tradeData, setTradeData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'credits') {
      const intValue = value.replace(/[^\d]/g, '');
      setTradeData({ ...tradeData, [name]: intValue });
    } else {
      setTradeData({ ...tradeData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-trade-modal">
        <div className="modal-header">
          <h2>New Carbon Trade</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Carbon Credit Encryption</strong>
            <p>Credit quantity encrypted with Zama FHE for privacy protection</p>
          </div>
          
          <div className="form-group">
            <label>Project Name *</label>
            <input 
              type="text" 
              name="name" 
              value={tradeData.name} 
              onChange={handleChange} 
              placeholder="Enter project name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Carbon Credits (Integer only) *</label>
            <input 
              type="number" 
              name="credits" 
              value={tradeData.credits} 
              onChange={handleChange} 
              placeholder="Enter credit quantity..." 
              step="1"
              min="0"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Price per Credit ($) *</label>
            <input 
              type="number" 
              name="price" 
              value={tradeData.price} 
              onChange={handleChange} 
              placeholder="Enter price..." 
              step="0.01"
              min="0"
            />
            <div className="data-type-label">Public Data</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !tradeData.name || !tradeData.credits || !tradeData.price} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting and Creating..." : "Create Trade"}
          </button>
        </div>
      </div>
    </div>
  );
};

const TradeDetailModal: React.FC<{
  trade: CarbonTradeData;
  onClose: () => void;
  decryptedData: { credits: number | null; price: number | null };
  setDecryptedData: (value: { credits: number | null; price: number | null }) => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ trade, onClose, decryptedData, setDecryptedData, isDecrypting, decryptData }) => {
  const handleDecrypt = async () => {
    if (decryptedData.credits !== null) { 
      setDecryptedData({ credits: null, price: null }); 
      return; 
    }
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setDecryptedData({ credits: decrypted, price: decrypted });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="trade-detail-modal">
        <div className="modal-header">
          <h2>Carbon Trade Details</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="trade-info">
            <div className="info-item">
              <span>Project:</span>
              <strong>{trade.name}</strong>
            </div>
            <div className="info-item">
              <span>Creator:</span>
              <strong>{trade.creator.substring(0, 8)}...{trade.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Date:</span>
              <strong>{new Date(trade.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-item">
              <span>Price:</span>
              <strong>${trade.publicValue2}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Carbon Credits</h3>
            
            <div className="data-row">
              <div className="data-label">Credit Quantity:</div>
              <div className="data-value">
                {trade.isVerified && trade.decryptedValue ? 
                  `${trade.decryptedValue} credits (Verified)` : 
                  decryptedData.credits !== null ? 
                  `${decryptedData.credits} credits (Decrypted)` : 
                  "🔒 FHE Encrypted"
                }
              </div>
              <button 
                className={`decrypt-btn ${(trade.isVerified || decryptedData.credits !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? "Decrypting..." : trade.isVerified ? "✅ Verified" : decryptedData.credits !== null ? "🔄 Re-verify" : "🔓 Decrypt"}
              </button>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE Protected Transaction</strong>
                <p>Credit quantity encrypted for enterprise privacy. Decryption requires on-chain verification.</p>
              </div>
            </div>
          </div>
          
          {(trade.isVerified || decryptedData.credits !== null) && (
            <div className="trade-summary">
              <h3>Trade Summary</h3>
              <div className="summary-grid">
                <div className="summary-item">
                  <span>Total Value:</span>
                  <strong>${((trade.isVerified ? trade.decryptedValue || 0 : decryptedData.credits || 0) * trade.publicValue2).toLocaleString()}</strong>
                </div>
                <div className="summary-item">
                  <span>Status:</span>
                  <span className={`status-badge ${trade.isVerified ? 'verified' : 'decrypted'}`}>
                    {trade.isVerified ? 'On-chain Verified' : 'Locally Decrypted'}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!trade.isVerified && (
            <button onClick={handleDecrypt} disabled={isDecrypting} className="verify-btn">
              Verify On-chain
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;