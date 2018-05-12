import { BigNumber } from "bignumber.js";
import Web3 = require("web3");
import fs = require("fs");

export class ChainReader {
  private web3Instance: Web3;
  private ERC20Contract: any;
  private DelegateContract: any;

  constructor() {
    try {
      if (web3) {
        this.web3Instance = web3; // inject by truffle.
      } else {
        this.web3Instance = new Web3(new Web3.providers.HttpProvider("http://localhost:8545"));

        // connect to main-net via a public node:
        // new Web3.providers.HttpProvider('https://api.myetherapi.com/eth')
      }
    } catch (err) {
      console.log("get web3 instance in class ChainReader failed. err:", err);
    }

    const erc20Abi = fs.readFileSync("ABI/version151/ERC20.abi", "ascii");
    const delegateAbi = fs.readFileSync("ABI/version151/TokenTransferDelegate.abi", "ascii");
    this.ERC20Contract = this.web3Instance.eth.contract(JSON.parse(erc20Abi));
    this.DelegateContract = this.web3Instance.eth.contract(JSON.parse(delegateAbi));
  }

  public async getERC20TokenBalance(tokenAddr: string, ownerAddr: string) {
    const tokenContractInstance = this.ERC20Contract.at(tokenAddr);
    const balance = await tokenContractInstance.balanceOf(ownerAddr);
    const balanceBN = new BigNumber(balance);
    return balanceBN.toNumber();
  }

  public async getERC20TokenAllowance(tokenAddr: string,
                                      ownerAddr: string,
                                      spenderAddr: string) {
    const tokenContractInstance = this.ERC20Contract.at(tokenAddr);
    const balance = await tokenContractInstance.allowance(ownerAddr, spenderAddr);
    const balanceBN = new BigNumber(balance);
    return balanceBN.toNumber();
  }

  public async getERC20TokenSpendable(tokenAddr: string,
                                      ownerAddr: string,
                                      spenderAddr: string) {
    const balance = await this.getERC20TokenBalance(tokenAddr, ownerAddr);
    const allowance = await this.getERC20TokenAllowance(tokenAddr, ownerAddr, spenderAddr);
    return Math.min(balance, allowance);
  }

  public async getOrderCancelledOrFilledAmount(orderHash: string, delegateAddr: string) {
    const delegateContractInstance = this.DelegateContract.at(delegateAddr);
    const amount = await delegateContractInstance.cancelledOrFilled(orderHash);
    const amountBN = new BigNumber(amount);
    return amount.toNumber();
  }

}