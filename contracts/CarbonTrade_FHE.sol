pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract CarbonTrade_FHE is ZamaEthereumConfig {
    
    struct TradeOrder {
        string orderId;                    
        euint32 encryptedAmount;            
        euint32 encryptedPrice;             
        uint256 publicAssetId;              
        string assetType;                   
        address creator;                    
        uint256 timestamp;                  
        uint32 decryptedAmount;             
        uint32 decryptedPrice;              
        bool isVerified;                    
    }
    
    mapping(string => TradeOrder) public tradeOrders;
    string[] public orderIds;
    
    event TradeOrderCreated(string indexed orderId, address indexed creator);
    event DecryptionVerified(string indexed orderId, uint32 amount, uint32 price);
    
    constructor() ZamaEthereumConfig() {
    }
    
    function createTradeOrder(
        string calldata orderId,
        externalEuint32 encryptedAmount,
        bytes calldata amountProof,
        externalEuint32 encryptedPrice,
        bytes calldata priceProof,
        uint256 publicAssetId,
        string calldata assetType
    ) external {
        require(bytes(tradeOrders[orderId].orderId).length == 0, "Order already exists");
        
        require(FHE.isInitialized(FHE.fromExternal(encryptedAmount, amountProof)), "Invalid encrypted amount");
        require(FHE.isInitialized(FHE.fromExternal(encryptedPrice, priceProof)), "Invalid encrypted price");
        
        tradeOrders[orderId] = TradeOrder({
            orderId: orderId,
            encryptedAmount: FHE.fromExternal(encryptedAmount, amountProof),
            encryptedPrice: FHE.fromExternal(encryptedPrice, priceProof),
            publicAssetId: publicAssetId,
            assetType: assetType,
            creator: msg.sender,
            timestamp: block.timestamp,
            decryptedAmount: 0,
            decryptedPrice: 0,
            isVerified: false
        });
        
        FHE.allowThis(tradeOrders[orderId].encryptedAmount);
        FHE.allowThis(tradeOrders[orderId].encryptedPrice);
        
        FHE.makePubliclyDecryptable(tradeOrders[orderId].encryptedAmount);
        FHE.makePubliclyDecryptable(tradeOrders[orderId].encryptedPrice);
        
        orderIds.push(orderId);
        
        emit TradeOrderCreated(orderId, msg.sender);
    }
    
    function verifyDecryption(
        string calldata orderId, 
        bytes memory abiEncodedClearAmount,
        bytes memory amountProof,
        bytes memory abiEncodedClearPrice,
        bytes memory priceProof
    ) external {
        require(bytes(tradeOrders[orderId].orderId).length > 0, "Order does not exist");
        require(!tradeOrders[orderId].isVerified, "Data already verified");
        
        bytes32[] memory cts = new bytes32[](2);
        cts[0] = FHE.toBytes32(tradeOrders[orderId].encryptedAmount);
        cts[1] = FHE.toBytes32(tradeOrders[orderId].encryptedPrice);
        
        FHE.checkSignatures(cts, abiEncodedClearAmount, amountProof);
        FHE.checkSignatures(cts, abiEncodedClearPrice, priceProof);
        
        uint32 decodedAmount = abi.decode(abiEncodedClearAmount, (uint32));
        uint32 decodedPrice = abi.decode(abiEncodedClearPrice, (uint32));
        
        tradeOrders[orderId].decryptedAmount = decodedAmount;
        tradeOrders[orderId].decryptedPrice = decodedPrice;
        tradeOrders[orderId].isVerified = true;
        
        emit DecryptionVerified(orderId, decodedAmount, decodedPrice);
    }
    
    function getEncryptedAmount(string calldata orderId) external view returns (euint32) {
        require(bytes(tradeOrders[orderId].orderId).length > 0, "Order does not exist");
        return tradeOrders[orderId].encryptedAmount;
    }
    
    function getEncryptedPrice(string calldata orderId) external view returns (euint32) {
        require(bytes(tradeOrders[orderId].orderId).length > 0, "Order does not exist");
        return tradeOrders[orderId].encryptedPrice;
    }
    
    function getTradeOrder(string calldata orderId) external view returns (
        string memory orderIdVal,
        uint256 publicAssetId,
        string memory assetType,
        address creator,
        uint256 timestamp,
        bool isVerified,
        uint32 decryptedAmount,
        uint32 decryptedPrice
    ) {
        require(bytes(tradeOrders[orderId].orderId).length > 0, "Order does not exist");
        TradeOrder storage order = tradeOrders[orderId];
        
        return (
            order.orderId,
            order.publicAssetId,
            order.assetType,
            order.creator,
            order.timestamp,
            order.isVerified,
            order.decryptedAmount,
            order.decryptedPrice
        );
    }
    
    function getAllOrderIds() external view returns (string[] memory) {
        return orderIds;
    }
    
    function isAvailable() public pure returns (bool) {
        return true;
    }
}

