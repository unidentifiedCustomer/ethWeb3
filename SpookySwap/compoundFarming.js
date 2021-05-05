import Web3 from 'web3';
import readlineSync from 'readline-sync';
import { wFTM_BOO_MASTERCHEF_CONTRACT, wFTM_BOO_MASTER_CONTRACT_ABI, wFTMABI, uniswapV2PairABI, wFTMBOOspLPAddress, wFTMAddress, SPOOKYSWAP_ROUTER_ABI, SPOOKYSWAP_ROUTER_ADDRESS, BOO_ADDRESS, BOO_CONTRACT_ABI, SPOOKYSWAP_DEPOSIT_CONTRACT_ABI, SPOOKYSWAP_DEPOSIT_CONTRACT_ADDRESS, SPOOKYSWAP_WITHDRAW_CONTRACT_ADDRESS, SPOOKYSWAP_WITHDRAW_CONTRACT_ABI } from './contracts.js'
import { FANTOM_MAINNET_RPC } from './constants.js'
import { ethers } from 'ethers';
import { convertToHex } from './functionCalls.js'

var customHttpProvider = new ethers.providers.JsonRpcProvider(FANTOM_MAINNET_RPC);

const key = readlineSync.question('Enter private key\n', {
  hideEchoBack: true // The typed text on screen is hidden by `*` (default).
});

const account = new ethers.Wallet(key, customHttpProvider);

const spookyContract = new ethers.Contract(BOO_ADDRESS, BOO_CONTRACT_ABI, account);

const wFTMContract = new ethers.Contract(wFTMAddress, wFTMABI, account)

const depositContract = new ethers.Contract(SPOOKYSWAP_DEPOSIT_CONTRACT_ADDRESS, SPOOKYSWAP_DEPOSIT_CONTRACT_ABI, account)

const withdrawContract = new ethers.Contract(SPOOKYSWAP_WITHDRAW_CONTRACT_ADDRESS, SPOOKYSWAP_WITHDRAW_CONTRACT_ABI, account)

const spookySwapRouter = new ethers.Contract(SPOOKYSWAP_ROUTER_ADDRESS, SPOOKYSWAP_ROUTER_ABI, account)

const wFTMBOOspLPContract = new ethers.Contract(wFTMBOOspLPAddress, uniswapV2PairABI, account)

const wFTMBooContract = new ethers.Contract(wFTM_BOO_MASTERCHEF_CONTRACT, wFTM_BOO_MASTER_CONTRACT_ABI, account)

const timeToCheckInMinutes = 7
const timeToCheckInMs = timeToCheckInMinutes * 60000

var booCompounded = 0
var timesCompounded = 0

async function getPrices(pairAddress) {
  // const reserves = await wFTMBOOspLPContract.getReserves()
  // const resv0 = Number(reserves._reserve1)
  // console.log(resv0)
  const getEthUsdPrice = await wFTMBOOspLPContract.getReserves()
    .then(reserves => Number(reserves._reserve0) / Number(reserves._reserve1));
  return getEthUsdPrice;
}

async function compoundMoney() {
  console.log("Starting compounding at time ", new Date())
  await withdrawContract.withdraw(0, 0);
  const currentPendingBoo = await depositContract.pendingBOO(0, account.address);
  const currentBalanceBoo = await spookyContract.balanceOf(account.address);
  const balanceToDeposit = Number(currentBalanceBoo) + Number(currentPendingBoo)
  booCompounded += balanceToDeposit
  console.log("currentPendingBoo: ", currentPendingBoo, " currentBalanceBoo: ", currentBalanceBoo, " \nBalance to deposit: " + balanceToDeposit)

  const currentNonce = await account.getTransactionCount();

  console.log("Depositing ", currentBalanceBoo)
  depositContract.deposit(0, currentBalanceBoo, { nonce: currentNonce });

  console.log("Depositing ", currentPendingBoo)
  depositContract.deposit(0, currentPendingBoo, { nonce: currentNonce + 1 });

  timesCompounded += +1
  console.log("Finished depositing, resuming sleep \ntotal Boo compounded this session: " + booCompounded + " over " + timesCompounded * timeToCheckInMinutes + " minutes")
}

var booLPCompounded = 0
var timesLPCompounded = 0

function convertEthToWei(number) {
  return Web3.utils.toWei(number.toString(), 'ether')
}

async function compoundMoneyIntoLP() {
  console.log("Starting LP compounding at time ", new Date())

  // withdraw SLP rewards
  await withdrawContract.withdraw(0,0).then(tx => tx.wait()).then(tx => console.log(tx.transactionHash))
  const currentBalanceBoo = await spookyContract.balanceOf(account.address);

  const amountToSell = Math.floor(currentBalanceBoo / 2)
  console.log("selling " + amountToSell)

  const wFTMperBOO = await getPrices(wFTMBOOspLPAddress)

  const slippage = Number(0.01)
  const expectedwFTMAmountOut = wFTMperBOO * amountToSell * (Number(1) - slippage)
  console.log("expecting out " + expectedwFTMAmountOut)

  const path = new Array(BOO_ADDRESS, wFTMAddress)

  // swap half
  await spookySwapRouter.swapExactTokensForETH(convertToHex(amountToSell), convertToHex(expectedwFTMAmountOut), path, account.address, getTimeLimit(), { gasLimit: 350000 }).then(tx => tx.wait()).then(tx => console.log(tx.transactionHash))
  console.log("swapped half of BOO for FTM")
  
  const newBalanceBoo = await spookyContract.balanceOf(account.address);

  // get new ratio to deposit
  const amountToDepositFTM = await getPrices(wFTMBOOspLPAddress) * newBalanceBoo

  const lpSlippage = Number(0.97)

  const amountBooToDeposit = newBalanceBoo
  const newLocal = convertToHex(amountBooToDeposit * lpSlippage);
  // add liquidity
  await spookySwapRouter.addLiquidityETH(BOO_ADDRESS, amountBooToDeposit.toHexString(), newLocal, convertToHex(Math.floor(amountToDepositFTM * lpSlippage)), account.address, getTimeLimit(), { gasLimit: 400000, value: convertToHex(amountToDepositFTM) }).then(tx => tx.wait()).then(tx => console.log(tx.transactionHash))
  console.log("liquidity added")
  const sLPBalance = await wFTMBOOspLPContract.balanceOf(account.address)
  const sLPBalanceHex = sLPBalance.toHexString()
  console.log(sLPBalanceHex)

  await wFTMBooContract.deposit(0, sLPBalanceHex).then(tx => tx.wait()).then(tx => console.log(tx.transactionHash))
  console.log("sLP deposited")

  timesCompounded += +1
  console.log("Finished depositing, resuming sleep")
}

// compoundMoney()
// setInterval(compoundMoney, timeToCheckInMs)

// compoundMoneyIntoLP()
setInterval(compoundMoneyIntoLP, timeToCheckInMs)
