import { BigNumber } from "bignumber.js";
import fs = require("fs");
import * as _ from "lodash";
import { Artifacts } from "../util/artifacts";
import { Order } from "../util/order";
import { TxParser } from "../util/parseTx";
import { ProtocolSimulator } from "../util/protocol_simulator";
import { Ring } from "../util/ring";
import { RingFactory } from "../util/ring_factory";
import { RingHelper } from "../util/ring_helper";
import { OrderParams, RingBalanceInfo, RingInfo } from "../util/types";
import * as rawTxs from "./rawTxs";

const {
  LoopringProtocolImpl,
  TokenRegistry,
  TokenTransferDelegate,
  DummyToken,
} = new Artifacts(artifacts);

contract("LoopringProtocolImpl", (accounts: string[]) => {
  const owner = accounts[0];
  const order1Owner = accounts[1];
  const order2Owner = accounts[2];
  const order3Owner = accounts[3];
  const ringOwner = accounts[6];
  const orderAuthAddr = accounts[7]; // should generate each time in front-end. we just mock it here.
  const walletAddr = accounts[8];

  let loopringProtocolImpl: any;
  let tokenRegistry: any;
  let tokenTransferDelegate: any;

  let lrcAddress: string;
  let eosAddress: string;
  let neoAddress: string;
  let qtumAddress: string;
  let delegateAddr: string;

  let lrc: any;
  let eos: any;
  let neo: any;
  let qtum: any;

  const tokenMap = new Map();
  const tokenSymbolMap = new Map();

  let currBlockTimeStamp: number;
  let walletSplitPercentage: number;

  let ringFactory: RingFactory;
  let ringHelper: RingHelper;

  const getTokenBalanceAsync = async (token: any, addr: string) => {
    const tokenBalanceStr = await token.balanceOf(addr);
    const balance = new BigNumber(tokenBalanceStr);
    return balance;
  };

  const getEthBalanceAsync = async (addr: string) => {
    const balanceStr = await web3.eth.getBalance(addr);
    const balance = new BigNumber(balanceStr);
    return balance;
  };

  const assertNumberEqualsWithPrecision = (n1: number, n2: number, precision: number = 8) => {
    const numStr1 = (n1 / 1e18).toFixed(precision);
    const numStr2 = (n2 / 1e18).toFixed(precision);

    return assert.equal(Number(numStr1), Number(numStr2));
  };

  const clear = async (tokens: any[], addresses: string[]) => {
    for (const token of tokens) {
      for (const address of addresses) {
        await token.setBalance(address, 0, {from: owner});
      }
    }
  };

  const approve = async (tokens: any[], addresses: string[], amounts: number[]) => {
    for (let i = 0; i < tokens.length; i++) {
      await tokens[i].approve(delegateAddr, 0, {from: addresses[i]});
      await tokens[i].approve(delegateAddr, amounts[i], {from: addresses[i]});
    }
  };

  const setBalanceBefore = async (ring: Ring) => {
    const ringSize = ring.orders.length;
    let lrcRewardTotal = 0;
    for (let i = 0; i < ringSize; i++) {
      const order = ring.orders[i];
      const orderOwner = order.owner;
      const balance = order.params.amountS.toNumber();
      const tokenSAddr = order.params.tokenS;
      const tokenInstance = tokenMap.get(tokenSAddr);
      await tokenInstance.setBalance(orderOwner, balance);

      const lrcFee = order.params.lrcFee.toNumber();
      await lrc.setBalance(orderOwner, lrcFee);
      lrcRewardTotal += lrcFee;
    }

    await lrc.setBalance(ring.owner, lrcRewardTotal);
  };

  // const getRingBalanceInfo = async (ring: Ring) => {
  //   const participiants: string[] = [];
  //   const tokenBalances: number[][] = [];

  //   const ringSize = ring.orders.length;
  //   const tokenSet = new Set();
  //   for (let i = 0; i < ringSize; i++) {
  //     const order: Order = ring.orders[i];
  //     participiants.push(order.owner);

  //     const tokenSAddr = order.params.tokenS;
  //     const tokenBAddr = order.params.tokenB;
  //     tokenSet.add(tokenSAddr);
  //     tokenSet.add(tokenBAddr);
  //   }

  //   tokenSet.add(lrcAddress);
  //   const tokenList: string[] = [...tokenSet];
  //   const tokenSymbolList = tokenList.map((addr) => tokenSymbolMap.get(addr));
  //   participiants.push(ring.owner);
  //   participiants.push(walletAddr);

  //   for (const participiant of participiants) {
  //     const participiantBalances: number[] = [];

  //     for (const tokenAddr of tokenList) {
  //       const tokenInstance = tokenMap.get(tokenAddr);
  //       const tokenBalance = await getTokenBalanceAsync(tokenInstance, participiant);
  //       participiantBalances.push(tokenBalance.toNumber());
  //     }

  //     tokenBalances.push(participiantBalances);
  //   }

  //   const balanceInfo: RingBalanceInfo = {
  //     participiants,
  //     tokenAddressList: tokenList,
  //     tokenSymbolList,
  //     tokenBalances,
  //   };

  //   return balanceInfo;
  // };

  // const printRingInfo = (ring: Ring) => {
  //   console.log("-".repeat(80));
  //   console.log("ring miner:", ring.owner);
  //   for (const order of ring.orders) {
  //     console.log("-".repeat(80));
  //     console.log("order owner:", order.owner);
  //     console.log("tokenS:", order.params.tokenS, "; amount:", order.params.amountS.toNumber());
  //     console.log("tokenB:", order.params.tokenB, "; amount:", order.params.amountB.toNumber());
  //     console.log("lrcFee:", order.params.lrcFee.toNumber());
  //     console.log("buyNoMoreThanAmountB:", order.params.buyNoMoreThanAmountB);
  //   }
  //   console.log("-".repeat(80));
  // };

  before( async () => {
    [loopringProtocolImpl, tokenRegistry, tokenTransferDelegate] = await Promise.all([
      LoopringProtocolImpl.deployed(),
      TokenRegistry.deployed(),
      TokenTransferDelegate.deployed(),
    ]);

    lrcAddress = await tokenRegistry.getAddressBySymbol("LRC");
    eosAddress = await tokenRegistry.getAddressBySymbol("EOS");
    neoAddress = await tokenRegistry.getAddressBySymbol("NEO");
    qtumAddress = await tokenRegistry.getAddressBySymbol("QTUM");
    delegateAddr = TokenTransferDelegate.address;

    const walletSplitPercentageBN = await loopringProtocolImpl.walletSplitPercentage();
    walletSplitPercentage = walletSplitPercentageBN.toNumber();

    tokenTransferDelegate.authorizeAddress(LoopringProtocolImpl.address);

    [lrc, eos, neo, qtum] = await Promise.all([
      DummyToken.at(lrcAddress),
      DummyToken.at(eosAddress),
      DummyToken.at(neoAddress),
      DummyToken.at(qtumAddress),
    ]);

    tokenMap.set(lrcAddress, lrc);
    tokenSymbolMap.set(lrcAddress, "LRC");
    tokenMap.set(eosAddress, eos);
    tokenSymbolMap.set(eosAddress, "EOS");
    tokenMap.set(neoAddress, neo);
    tokenSymbolMap.set(neoAddress, "NEO");
    tokenMap.set(qtumAddress, qtum);
    tokenSymbolMap.set(qtumAddress, "QTUM");

    const currBlockNumber = web3.eth.blockNumber;
    currBlockTimeStamp = web3.eth.getBlock(currBlockNumber).timestamp;

    ringFactory = new RingFactory(TokenTransferDelegate.address,
                                  eosAddress,
                                  neoAddress,
                                  lrcAddress,
                                  qtumAddress,
                                  orderAuthAddr,
                                  currBlockTimeStamp);
    ringFactory.walletAddr = walletAddr;

    // approve only once for all test cases.
    const allTokens = [lrc, eos, neo, qtum];
    const allAddresses = [order1Owner, order2Owner, order3Owner, ringOwner];
    for (const token of allTokens) {
      for (const address of allAddresses) {
        await token.approve(delegateAddr, web3.toWei(10000000000), {from: address});
      }
    }

    const tokenSymbols = ["EOS", "NEO", "QTUM", "LRC"];
    const getTokenAddrAsync = async (symbol: string) => {
      const addr = await tokenRegistry.getAddressBySymbol(symbol);
      return addr;
    };

    const getTokenContractFuncAsync = async (symbol: string) => {
      const addr = await tokenRegistry.getAddressBySymbol(symbol);
      const contract = await DummyToken.at(addr);
      return contract;
    };

    ringHelper = new RingHelper(tokenSymbols);
    await ringHelper.init(getTokenAddrAsync, getTokenContractFuncAsync);
  });

  const setDefaultValuesForRingInfo = (ringInfo: RingInfo) => {
    const ringSize = ringInfo.amountSList.length;
    assert(ringSize <= 3, "invalid orders size. amountSList:" + ringInfo.amountSList);

    const tokenAddresses = [eosAddress, neoAddress, lrcAddress];
    const orderOwners = [order1Owner, order2Owner, order3Owner];
    ringInfo.tokenAddressList = tokenAddresses.slice(0, ringSize);
    ringInfo.orderOwners = orderOwners.slice(0, ringSize);
    ringInfo.miner = ringOwner;
  };

  describe("submitRing", () => {
    const protocolAbi = fs.readFileSync("ABI/version151/LoopringProtocolImpl.abi", "ascii");
    const txParser = new TxParser(protocolAbi);

    const txs = rawTxs;
    for (let i = 0; i < txs.length; i++) {
      it("raw tx " + i, async () => {
        const rawTx = txs[i];
        const ringInfo = txParser.parseSubmitRingTx(rawTx);
        setDefaultValuesForRingInfo(ringInfo);

        const ring = await ringFactory.generateRing(ringInfo);
        await setBalanceBefore(ring);
        ringHelper.printRing(ring);

        const balanceInfoBefore = await ringHelper.getRingBalanceInfo(ring);
        console.log("balanceInfoBefore:",  balanceInfoBefore);

        const p = ringFactory.ringToSubmitableParams(ring);

        const tx = await loopringProtocolImpl.submitRing(p.addressList,
                                                         p.uintArgsList,
                                                         p.uint8ArgsList,
                                                         p.buyNoMoreThanAmountBList,
                                                         p.vList,
                                                         p.rList,
                                                         p.sList,
                                                         p.feeRecepient,
                                                         p.feeSelections,
                                                         {from: ring.owner});

        // console.log("tx.receipt.logs: ", tx.receipt.logs);

        const balanceInfoAfter = await ringHelper.getRingBalanceInfo(ring);
        console.log("balanceInfoAfter:",  balanceInfoAfter);
      });
    }

  });

});