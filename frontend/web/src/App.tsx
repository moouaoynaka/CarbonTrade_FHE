import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface CarbonOrder {
  id: string;
  name: string;
  encryptedAmount: string;
  price: number;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

interface TradingStats {
  totalOrders: number;
  totalVolume: number;
  avgPrice: number;
  verifiedOrders: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<CarbonOrder[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newOrderData, setNewOrderData] = useState({ name: "", amount: "", price: "" });
  const [selectedOrder, setSelectedOrder] = useState<CarbonOrder | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterVerified, setFilterVerified] = useState(false);
  const [userHistory, setUserHistory] = useState<CarbonOrder[]>([]);
  const [partners] = useState([
    { name: "Green Energy Corp", logo: "🌿" },
    { name: "Eco Tech Ltd", logo: "🌱" },
    { name: "Sustainable Solutions", logo: "🍃" },
    { name: "Carbon Neutral Inc", logo: "🌳" }
  ]);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized) return;
      
      try {
        console.log('Initializing FHEVM for carbon trading...');
        await initialize();
        console.log('FHEVM initialized successfully');
      } catch (error) {
        console.error('Failed to initialize FHEVM:', error);
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadOrders();
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  useEffect(() => {
    if (address && orders.length > 0) {
      const userOrders = orders.filter(order => order.creator.toLowerCase() === address.toLowerCase());
      setUserHistory(userOrders);
    }
  }, [address, orders]);

  const loadOrders = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const ordersList: CarbonOrder[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          ordersList.push({
            id: businessId,
            name: businessData.name,
            encryptedAmount: businessId,
            price: Number(businessData.publicValue1) || 0,
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
      
      setOrders(ordersList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load orders" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createOrder = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingOrder(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating carbon order with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const amountValue = parseInt(newOrderData.amount) || 0;
      const businessId = `carbon-${Date.now()}`;
      
      const encryptedResult = await encrypt(await contract.getAddress(), address, amountValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newOrderData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newOrderData.price) || 0,
        0,
        "Carbon Credit Order"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Carbon order created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadOrders();
      setShowCreateModal(false);
      setNewOrderData({ name: "", amount: "", price: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Creation failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingOrder(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Carbon amount already verified" 
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
        await contractRead.getAddress(),
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying carbon amount..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadOrders();
      
      setTransactionStatus({ visible: true, status: "success", message: "Carbon amount verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Carbon amount is already verified" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadOrders();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const available = await contract.isAvailable();
      if (available) {
        setTransactionStatus({ visible: true, status: "success", message: "FHE system is available!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const getTradingStats = (): TradingStats => {
    const totalOrders = orders.length;
    const verifiedOrders = orders.filter(o => o.isVerified).length;
    const totalVolume = orders.reduce((sum, order) => {
      const amount = order.isVerified ? (order.decryptedValue || 0) : 0;
      return sum + (amount * order.price);
    }, 0);
    const avgPrice = orders.length > 0 ? orders.reduce((sum, order) => sum + order.price, 0) / orders.length : 0;

    return { totalOrders, totalVolume, avgPrice, verifiedOrders };
  };

  const filteredOrders = orders.filter(order => {
    const matchesSearch = order.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = !filterVerified || order.isVerified;
    return matchesSearch && matchesFilter;
  });

  const renderTradingStats = () => {
    const stats = getTradingStats();
    
    return (
      <div className="stats-grid">
        <div className="stat-card metal-card">
          <div className="stat-icon">📊</div>
          <div className="stat-content">
            <h3>Total Orders</h3>
            <div className="stat-value">{stats.totalOrders}</div>
          </div>
        </div>
        
        <div className="stat-card metal-card">
          <div className="stat-icon">💰</div>
          <div className="stat-content">
            <h3>Trading Volume</h3>
            <div className="stat-value">${stats.totalVolume.toLocaleString()}</div>
          </div>
        </div>
        
        <div className="stat-card metal-card">
          <div className="stat-icon">⚡</div>
          <div className="stat-content">
            <h3>Verified Orders</h3>
            <div className="stat-value">{stats.verifiedOrders}/{stats.totalOrders}</div>
          </div>
        </div>
        
        <div className="stat-card metal-card">
          <div className="stat-icon">🌿</div>
          <div className="stat-content">
            <h3>Avg Price</h3>
            <div className="stat-value">${stats.avgPrice.toFixed(1)}</div>
          </div>
        </div>
      </div>
    );
  };

  const renderCarbonChart = (order: CarbonOrder) => {
    const amount = order.isVerified ? (order.decryptedValue || 0) : 50;
    const impact = Math.min(100, (amount * order.price) / 1000 * 100);
    
    return (
      <div className="carbon-chart">
        <div className="chart-header">
          <h4>Carbon Impact Analysis</h4>
        </div>
        <div className="chart-bars">
          <div className="chart-bar">
            <div className="bar-label">Carbon Credits</div>
            <div className="bar-container">
              <div 
                className="bar-fill green-fill" 
                style={{ width: `${Math.min(100, amount)}%` }}
              >
                <span>{amount} tons</span>
              </div>
            </div>
          </div>
          <div className="chart-bar">
            <div className="bar-label">Environmental Impact</div>
            <div className="bar-container">
              <div 
                className="bar-fill blue-fill" 
                style={{ width: `${impact}%` }}
              >
                <span>{impact.toFixed(1)}%</span>
              </div>
            </div>
          </div>
          <div className="chart-bar">
            <div className="bar-label">Price per Ton</div>
            <div className="bar-container">
              <div 
                className="bar-fill gold-fill" 
                style={{ width: `${Math.min(100, order.price)}%` }}
              >
                <span>${order.price}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo-section">
            <div className="logo">🌿</div>
            <h1>Confidential Carbon Trading</h1>
          </div>
          <ConnectButton />
        </header>
        
        <div className="connection-prompt">
          <div className="prompt-content metal-panel">
            <h2>🔐 Connect Your Wallet</h2>
            <p>Access encrypted carbon credit trading with FHE protection</p>
            <div className="features-list">
              <div className="feature-item">• Zero-knowledge order matching</div>
              <div className="feature-item">• Encrypted carbon amount verification</div>
              <div className="feature-item">• ESG compliance automation</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <h2>Initializing FHE System...</h2>
        <p>Status: {status}</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <h2>Loading Carbon Trading Platform</h2>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo-section">
          <div className="logo">🌿</div>
          <h1>Confidential Carbon Trading</h1>
        </div>
        
        <nav className="nav-controls">
          <button className="nav-btn" onClick={checkAvailability}>
            Check FHE Status
          </button>
          <button 
            className="nav-btn primary" 
            onClick={() => setShowCreateModal(true)}
          >
            + New Carbon Order
          </button>
          <ConnectButton />
        </nav>
      </header>

      <main className="main-content">
        <section className="dashboard-section">
          <div className="section-header">
            <h2>Carbon Market Dashboard</h2>
            <button 
              onClick={loadOrders} 
              className="refresh-btn"
              disabled={isRefreshing}
            >
              {isRefreshing ? "🔄" : "⟳"} Refresh
            </button>
          </div>
          
          {renderTradingStats()}
        </section>

        <section className="trading-section">
          <div className="section-header">
            <h2>Carbon Order Book</h2>
            <div className="filters">
              <input
                type="text"
                placeholder="Search orders..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="search-input"
              />
              <label className="filter-toggle">
                <input
                  type="checkbox"
                  checked={filterVerified}
                  onChange={(e) => setFilterVerified(e.target.checked)}
                />
                Verified Only
              </label>
            </div>
          </div>

          <div className="orders-grid">
            {filteredOrders.length === 0 ? (
              <div className="empty-state metal-panel">
                <div className="empty-icon">🌱</div>
                <h3>No Carbon Orders Found</h3>
                <p>Create the first carbon credit trading order</p>
                <button 
                  className="create-btn"
                  onClick={() => setShowCreateModal(true)}
                >
                  Create Carbon Order
                </button>
              </div>
            ) : (
              filteredOrders.map((order) => (
                <div 
                  key={order.id}
                  className={`order-card metal-card ${order.isVerified ? 'verified' : ''}`}
                  onClick={() => setSelectedOrder(order)}
                >
                  <div className="order-header">
                    <h3>{order.name}</h3>
                    <span className={`status-badge ${order.isVerified ? 'verified' : 'pending'}`}>
                      {order.isVerified ? '✅ Verified' : '🔒 Encrypted'}
                    </span>
                  </div>
                  
                  <div className="order-details">
                    <div className="detail-item">
                      <span>Price:</span>
                      <strong>${order.price}/ton</strong>
                    </div>
                    <div className="detail-item">
                      <span>Carbon Amount:</span>
                      <strong>
                        {order.isVerified ? 
                          `${order.decryptedValue} tons` : 
                          '🔐 FHE Encrypted'
                        }
                      </strong>
                    </div>
                    <div className="detail-item">
                      <span>Creator:</span>
                      <span>{order.creator.substring(0, 8)}...</span>
                    </div>
                  </div>
                  
                  <div className="order-footer">
                    <span>{new Date(order.timestamp * 1000).toLocaleDateString()}</span>
                    <button className="view-btn">View Details</button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="user-section">
          <div className="user-history metal-panel">
            <h3>Your Trading History</h3>
            {userHistory.length === 0 ? (
              <p className="no-history">No trading history found</p>
            ) : (
              <div className="history-list">
                {userHistory.slice(0, 5).map(order => (
                  <div key={order.id} className="history-item">
                    <span>{order.name}</span>
                    <span>${order.price}</span>
                    <span className={`status ${order.isVerified ? 'verified' : 'pending'}`}>
                      {order.isVerified ? 'Verified' : 'Pending'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="partners-panel metal-panel">
            <h3>ESG Partners</h3>
            <div className="partners-grid">
              {partners.map((partner, index) => (
                <div key={index} className="partner-card">
                  <div className="partner-logo">{partner.logo}</div>
                  <span>{partner.name}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      {showCreateModal && (
        <CreateOrderModal
          onSubmit={createOrder}
          onClose={() => setShowCreateModal(false)}
          creating={creatingOrder}
          orderData={newOrderData}
          setOrderData={setNewOrderData}
          isEncrypting={isEncrypting}
        />
      )}

      {selectedOrder && (
        <OrderDetailModal
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onDecrypt={decryptData}
          isDecrypting={fheIsDecrypting}
          renderChart={renderCarbonChart}
        />
      )}

      {transactionStatus.visible && (
        <div className={`transaction-toast ${transactionStatus.status}`}>
          <div className="toast-content">
            <span className="toast-icon">
              {transactionStatus.status === "pending" && "⏳"}
              {transactionStatus.status === "success" && "✅"}
              {transactionStatus.status === "error" && "❌"}
            </span>
            {transactionStatus.message}
          </div>
        </div>
      )}
    </div>
  );
};

const CreateOrderModal: React.FC<{
  onSubmit: () => void;
  onClose: () => void;
  creating: boolean;
  orderData: any;
  setOrderData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, orderData, setOrderData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'amount') {
      const intValue = value.replace(/[^\d]/g, '');
      setOrderData({ ...orderData, [name]: intValue });
    } else {
      setOrderData({ ...orderData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal metal-panel">
        <div className="modal-header">
          <h2>Create Carbon Credit Order</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <div className="notice-icon">🔐</div>
            <div>
              <strong>FHE Encrypted Carbon Trading</strong>
              <p>Carbon amount encrypted with Zama FHE for privacy protection</p>
            </div>
          </div>

          <div className="form-group">
            <label>Order Name *</label>
            <input
              type="text"
              name="name"
              value={orderData.name}
              onChange={handleChange}
              placeholder="e.g., Corporate Carbon Offset 2024"
            />
          </div>

          <div className="form-group">
            <label>Carbon Amount (tons) *</label>
            <input
              type="number"
              name="amount"
              value={orderData.amount}
              onChange={handleChange}
              placeholder="Enter carbon credit amount"
              min="1"
            />
            <span className="input-hint">FHE Encrypted Integer</span>
          </div>

          <div className="form-group">
            <label>Price per Ton ($) *</label>
            <input
              type="number"
              name="price"
              value={orderData.price}
              onChange={handleChange}
              placeholder="Enter price per carbon ton"
              min="1"
            />
            <span className="input-hint">Public Market Price</span>
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit}
            disabled={creating || isEncrypting || !orderData.name || !orderData.amount || !orderData.price}
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting..." : "Create Order"}
          </button>
        </div>
      </div>
    </div>
  );
};

const OrderDetailModal: React.FC<{
  order: CarbonOrder;
  onClose: () => void;
  onDecrypt: (id: string) => Promise<number | null>;
  isDecrypting: boolean;
  renderChart: (order: CarbonOrder) => JSX.Element;
}> = ({ order, onClose, onDecrypt, isDecrypting, renderChart }) => {
  const [localDecrypted, setLocalDecrypted] = useState<number | null>(null);

  const handleDecrypt = async () => {
    if (order.isVerified) return;
    
    const result = await onDecrypt(order.id);
    if (result !== null) {
      setLocalDecrypted(result);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="detail-modal metal-panel">
        <div className="modal-header">
          <h2>Carbon Order Details</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>

        <div className="modal-body">
          <div className="order-info">
            <div className="info-grid">
              <div className="info-item">
                <label>Order Name</label>
                <span>{order.name}</span>
              </div>
              <div className="info-item">
                <label>Price per Ton</label>
                <span>${order.price}</span>
              </div>
              <div className="info-item">
                <label>Carbon Amount</label>
                <span>
                  {order.isVerified ? 
                    `${order.decryptedValue} tons` : 
                    localDecrypted ? 
                    `${localDecrypted} tons (Decrypted)` : 
                    "🔐 FHE Encrypted"
                  }
                </span>
              </div>
              <div className="info-item">
                <label>Status</label>
                <span className={`status ${order.isVerified ? 'verified' : 'encrypted'}`}>
                  {order.isVerified ? '✅ On-chain Verified' : '🔒 Encrypted'}
                </span>
              </div>
            </div>
          </div>

          {renderChart(order)}

          <div className="verification-section">
            <h4>FHE Verification</h4>
            <div className="verification-content">
              <div className="fhe-process">
                <div className="process-step">
                  <span>1</span>
                  <p>Carbon amount encrypted with Zama FHE</p>
                </div>
                <div className="process-step">
                  <span>2</span>
                  <p>Stored on-chain as encrypted data</p>
                </div>
                <div className="process-step">
                  <span>3</span>
                  <p>Client-side decryption with proof generation</p>
                </div>
                <div className="process-step">
                  <span>4</span>
                  <p>On-chain verification via FHE.checkSignatures</p>
                </div>
              </div>
              
              <button 
                className={`verify-btn ${order.isVerified ? 'verified' : ''}`}
                onClick={handleDecrypt}
                disabled={isDecrypting || order.isVerified}
              >
                {isDecrypting ? "Verifying..." : 
                 order.isVerified ? "✅ Verified" : 
                 "🔓 Verify Carbon Amount"}
              </button>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;

