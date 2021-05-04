import { ethers } from 'ethers';
import { MATIC_MAINNET_RPC } from './constants.js'
import Web3 from 'web3'
import { AAVE_WMATIC_CONTRACT, AAVE_WMATIC_DEBT_CONTRACT, AAVE_WETH_GATEWAY_MATIC, AAVE_WETH_GATEWAY_MATIC_ABI, WMATIC_ADDRESS, WMATIC_CONTRACT_ABI, AAVE_INCENTIVES_CONTRACT_MATIC, AAVE_INCENTIVES_CONTRACT_MATIC_ABI, AAVE_LENDING_CONTRACT_MATIC, AAVE_LENDING_CONTRACT_MATIC_ABI, MATIC_ADDRESS, MATIC_CONTRACT_ABI, AAVE_PRICE_ORACLE_MATIC, AAVE_PRICE_ORACLE_MATIC_ABI } from './contracts.js'
import { convertToHex } from './functionCalls.js'
import readlineSync from 'readline-sync';

var customHttpProvider = new ethers.providers.JsonRpcProvider(MATIC_MAINNET_RPC);

const key = readlineSync.question('Enter private key\n', {
    hideEchoBack: true // The typed text on screen is hidden by `*` (default).
  });
  
const account = new ethers.Wallet(key, customHttpProvider);

const aaveIncentivesContract = new ethers.Contract(AAVE_INCENTIVES_CONTRACT_MATIC, AAVE_INCENTIVES_CONTRACT_MATIC_ABI, account);

const aaveLendingContract = new ethers.Contract(AAVE_LENDING_CONTRACT_MATIC, AAVE_LENDING_CONTRACT_MATIC_ABI, account)

const wMATICContract = new ethers.Contract(WMATIC_ADDRESS, WMATIC_CONTRACT_ABI, account)

const maticContract = new ethers.Contract(MATIC_ADDRESS, MATIC_CONTRACT_ABI, account)

const aavePriceOracleContract = new ethers.Contract(AAVE_PRICE_ORACLE_MATIC, AAVE_PRICE_ORACLE_MATIC_ABI, account)

const aaveWETHGatewayContract = new ethers.Contract(AAVE_WETH_GATEWAY_MATIC, AAVE_WETH_GATEWAY_MATIC_ABI, account)

function convertEthToWei(number) {
    return Web3.utils.toWei(number.toString(), 'ether')
}

async function getAvailableToBorrow(address) {
    const accountData = await aaveLendingContract.getUserAccountData(address)
    const availableToBorrowInETH = accountData.availableBorrowsETH
    const aaveMaticOraclePrice = (await aavePriceOracleContract.getAssetPrice(WMATIC_ADDRESS));
    const totalMaticBorrowable = convertEthToWei((availableToBorrowInETH / aaveMaticOraclePrice) * Number(0.98))
    console.log("availableToBorrowInETH | aaveMaticOraclePrice | totalMaticBorrowable")
    console.log(availableToBorrowInETH.toString(), aaveMaticOraclePrice.toString(), totalMaticBorrowable.toString())
    return Number(totalMaticBorrowable)
}

// getAvailableToBorrow(account.address)

const claimMax = "115792089237316195423570985008687907853269984665640564039457584007913129639935"
const loopThreshold = 15 * 1e18

async function aaveLeverageUp() {
    console.log("Starting leverage up on MATIC AAVE")

    console.log("claiming pending rewards")
    await aaveIncentivesContract.claimRewards([AAVE_WMATIC_CONTRACT, AAVE_WMATIC_DEBT_CONTRACT], claimMax, account.address, { gasLimit: 1000000 }).then(tx => tx.wait()).then(tx => console.log(tx.transactionHash));
    console.log("claimed pending rewards")
    // get wMATIC balance

    const wMaticBalance = await wMATICContract.balanceOf(account.address)

    // convert wMATIC to MATIC
    console.log("unwrapping wMATIC to MATIC")
    await wMATICContract.withdraw(wMaticBalance.toString()).then(tx => tx.wait()).then(tx => console.log(tx.transactionHash));

    // deposit, borrow, repeat till threshold
    const maticToKeep = Number(100) * 1e18

    // get current balance of MATIC
    const currentMaticBalance = await maticContract.balanceOf(account.address)

    if (currentMaticBalance > maticToKeep) {
        const initialAmountToDeposit = currentMaticBalance - maticToKeep;
        console.log("depositing current balance of MATIC " + initialAmountToDeposit)
        await aaveWETHGatewayContract.depositETH(AAVE_LENDING_CONTRACT_MATIC, account.address, 0, { gasLimit: 1000000, value: convertToHex(initialAmountToDeposit) }).then(tx => tx.wait()).then(tx => console.log(tx.transactionHash))
    }

    var availableToBorrow = (await getAvailableToBorrow(account.address))

    console.log("starting borrow/deposit loop")
    while (availableToBorrow > +loopThreshold) {
        console.log("available to borrow > " + loopThreshold + " will borrow " + availableToBorrow)
        await aaveWETHGatewayContract.borrowETH(AAVE_LENDING_CONTRACT_MATIC, convertToHex(availableToBorrow), 2, 0, { gasLimit: 1000000 }).then(tx => tx.wait()).then(tx => console.log(tx.transactionHash))
        console.log("preparing to deposit")
        await aaveWETHGatewayContract.depositETH(AAVE_LENDING_CONTRACT_MATIC, account.address, 0, { gasLimit: 1000000, value: convertToHex(availableToBorrow) }).then(tx => tx.wait()).then(tx => console.log(tx.transactionHash))
        console.log("finished depositing")
        availableToBorrow = (await getAvailableToBorrow(account.address))
        console.log("new available to borrow balance is " + availableToBorrow)
    }
    console.log("balance is < threshold, going to sleep")
}

const timeToCheckInMinutes = 120
const timeToCheckInMs = timeToCheckInMinutes * 60000

aaveLeverageUp()
setInterval(aaveLeverageUp, timeToCheckInMs)

