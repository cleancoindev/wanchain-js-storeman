"use strict"
const baseAgent = require("agent/BaseAgent.js");

// let Eos = require("eosjs");
let RawTrans = require("trans/EosRawTrans.js");

const {
  encodeAccount,
  hexAdd0x,
  hexTrip0x,
  decodeAccount,
  eosToFloat,
  floatToEos,
  tokenToWei,
  weiToToken
} = require('comm/lib');

module.exports = class EosAgent extends baseAgent{
  constructor(crossChain, tokenType, record = null) {
    super(crossChain, tokenType, record);

    this.RawTrans = RawTrans;

    this.crossFunc = (this.crossDirection === 0) ? this.crossInfoInst.depositAction : this.crossInfoInst.withdrawAction;
    this.depositEvent = this.crossInfoInst.depositAction;
    this.withdrawEvent = this.crossInfoInst.withdrawAction;

    this.debtFunc = this.crossInfoInst.debtAction;
    this.debtEvent = this.crossInfoInst.debtAction;

    this.withdrawFeeFunc = this.crossInfoInst.withdrawFeeAction;
    this.withdrawFeeEvent = this.crossInfoInst.withdrawFeeAction;
  }

  getTransInfo(action) {
    let from;
    let to;
    let amount;

    return new Promise(async (resolve, reject) => {
      try {
        from = this.storemanAddress;

        to = this.contractAddr;

        this.amount = weiToToken(this.amount, this.decimals);
        this.amount = floatToEos(this.amount, this.tokenSymbol, this.decimals);

        amount = this.amount;

        this.logger.info("transInfo is: crossDirection- %s, transChainType- %s,\n from- %s, to- %s, amount- %s, \n hashX- %s", this.crossDirection, this.transChainType, from, to, amount, this.hashKey);
        resolve([from, to, amount]);
      } catch (err) {
        this.logger.error("getTransInfo failed", err);
        reject(err);
      }
    });
  }

  signTrans() {
    let self = this;
    return new Promise(async (resolve, reject) => {
      try {
        let rawTx;
        // let password = process.env.KEYSTORE_PWD;

        if (!global.keosd) {
          if (global.secret['EOS_KEY']) {
            let privateKey= [global.secret['EOS_KEY']];
            rawTx = await this.trans.signTransDebug(privateKey, self.chain);
          } else {
            reject("Missing EOS private key!")
          }
        } else {
          if (global.wallet) {
            let wallet = global.wallet;
            let password = this.getChainPassword();
            rawTx = await self.trans.signTransFromKeosd(wallet, password, self.chain);
          } else {
            reject('Missing wallet name!');
          }
        }
        resolve(rawTx);
      } catch (err) {
        self.logger.error("********************************** signTrans failed ********************************** hashX", self.hashKey);
        reject(err);
      }
    });
  }

  // outlock(eosio::name user, eosio::name account, eosio::asset quantity, std::string xHash, std::string pk, std::string r, std::string s)
  // verify(&userView, &acctView, &qView, &xHashView)
  // debtOpt, debtOptEnable is needed in moduleConfig
  // lockdebt(std::string npk, eosio::name account, eosio::asset quantity, std::string xHash, std::string pk, std::string r, std::string s)
  // verify(&npkView, &acctView, &qView, &xHashView)
  async getLockData() {
    this.logger.debug("********************************** funcInterface **********************************", this.crossFunc[0], "hashX", this.hashKey);
    this.logger.debug('getLockData: transChainType-', this.transChainType, 'crossDirection-', this.crossDirection, 'tokenAddr-', this.tokenAddr, 'hashKey-', this.hashKey, 'crossAddress-', this.crossAddress, 'Amount-', this.amount);

    let signData;
    if (!this.isDebt) {
      signData = [hexTrip0x(this.crossAddress), this.tokenAddr.split(':')[0], this.amount, hexTrip0x(this.hashKey)];
    } else {
      signData = [hexTrip0x(this.record.storeman), this.tokenAddr.split(':')[0], this.amount, hexTrip0x(this.hashKey)];
    }
     
    let internalSignature = await this.internalSignViaMpc(signData);

    if (this.isLeader) {
      let actions = [{
        account: this.contractAddr,
        name: this.crossFunc[0],
        authorization: [{
          actor: this.storemanAddress,
          permission: 'active',
        }],
        data: {
          // storeman: this.storemanAddress,
          // user: this.crossAddress,
          account: this.tokenAddr.split(':')[0],
          quantity: this.amount,
          xHash: hexTrip0x(this.hashKey),
          pk: hexTrip0x(this.storemanPk),
          r: hexTrip0x(internalSignature.R),
          s: hexTrip0x(internalSignature.S)
        }
      }];
      if (!this.isDebt) {
        actions[0].data.user = hexTrip0x(this.crossAddress);
      } else {
        actions[0].data.npk = hexTrip0x(this.record.storeman);
      }
      return actions;
    } else {
      return null;
    }
  }

  // inredeem(eosio::name storeman, std::string x, std::string r, std::string s)
  // inredeem(std::string x)
  // redeemdebt(std::string x)
  async getRedeemData() {
    this.logger.debug("********************************** funcInterface **********************************", this.crossFunc[1], "hashX", this.hashKey);
    this.logger.debug('getRedeemData: transChainType-', this.transChainType, 'crossDirection-', this.crossDirection, 'tokenAddr-', this.tokenAddr, 'hashKey-', this.hashKey, 'key-', this.key);

    // let signData = [hexTrip0x(this.storemanAddress), hexTrip0x(this.key)];
    // let internalSignature = await this.internalSignViaMpc(signData);

    if (this.isLeader) {
      let actions = [{
        account: this.contractAddr,
        name: this.crossFunc[1],
        authorization: [{
          actor: this.storemanAddress,
          permission: 'active',
        }],
        data: {
          // storemanGroup: decodeAccount(this.crossChain, this.storemanAddress),
          // storeman: hexTrip0x(this.storemanPk),
          // storeman: this.storemanAddress,
          x: hexTrip0x(this.key),
          // r: hexTrip0x(internalSignature.R),
          // s: hexTrip0x(internalSignature.S)
        }
      }];
      return actions;
    } else {
      return null;
    }
  }

  // outrevoke(eosio::name storeman, std::string xHash, std::string r, std::string s)
  // outrevoke(std::string xHash)
  // revokedebt(std::string xHash)
  async getRevokeData() {
    this.logger.debug("********************************** funcInterface **********************************", this.crossFunc[2], "hashX", this.hashKey);
    this.logger.debug('getRevokeData: transChainType-', this.transChainType, 'crossDirection-', this.crossDirection, 'tokenAddr-', this.tokenAddr, 'hashKey-', this.hashKey);

    // let signData = [hexTrip0x(this.storemanAddress), hexTrip0x(this.hashKey)];
    // let internalSignature = await this.internalSignViaMpc(signData);

    if (this.isLeader) {
      let actions = [{
        account: this.contractAddr,
        name: this.crossFunc[2],
        authorization: [{
          actor: this.storemanAddress,
          permission: 'active',
        }],
        data: {
          // storeman: hexTrip0x(this.storemanAddress),
          xHash: hexTrip0x(this.hashKey),
          // r: hexTrip0x(internalSignature.R),
          // s: hexTrip0x(internalSignature.S)
        }
      }];
      return actions;
    } else {
      return null;
    }
  }

  // // debt opt
  // // debtOptEnable is needed in moduleConfig
  // // lockdebt(eosio::name storeman, std::string npk, eosio::name account, eosio::asset quantity, std::string xHash, std::string pk, std::string r, std::string s)
  // // verify(&npkView, &acctView, &qView, &xHashView)
  // async getDebtLockData() {
  //   if (this.debtOptEnable) {
  //     this.logger.debug("********************************** funcInterface **********************************", this.debtFunc[0], "hashX", this.hashKey);
  //     this.logger.debug('getDebtLockData: transChainType-', this.transChainType, 'crossDirection-', this.crossDirection, 'tokenAddr-', this.tokenAddr, 'hashKey-', this.hashKey, 'crossAddress-', this.crossAddress, 'Amount-', this.amount);
  
  //     let signData = [this.storemanAddress, this.tokenAddr.split(':')[0], this.amount, hexTrip0x(this.crossAddress), hexTrip0x(this.hashKey)];
  //     let internalSignature = await this.internalSignViaMpc(signData);
  
  //     if (this.isLeader) {
  //       let actions = [{
  //         account: this.contractAddr,
  //         name: this.debtFunc[0],
  //         authorization: [{
  //           actor: this.storemanAddress,
  //           permission: 'active',
  //         }],
  //         data: {
  //           storeman: this.storemanAddress,
  //           account: this.tokenAddr.split(':')[0],
  //           quantity: this.amount,
  //           npk: hexTrip0x(this.crossAddress),
  //           xHash: hexTrip0x(this.hashKey),
  //           pk: hexTrip0x(this.storemanPk),
  //           r: hexTrip0x(internalSignature.R),
  //           s: hexTrip0x(internalSignature.S)
  //         }
  //       }];
  //       return actions;
  //     } else {
  //       return null;
  //     }
  //   } else {
  //     this.logger.warn("********************************** funcInterface ********************************** getDebtLockData", "hashX", this.hashKey, "debtOptEnable is ", this.debtOptEnable);
  //     this.logger.warn('getDebtLockData: transChainType-', this.transChainType, 'crossDirection-', this.crossDirection, 'tokenAddr-', this.tokenAddr, 'hashKey-', this.hashKey, 'crossAddress-', this.crossAddress, 'Amount-', this.amount);
  
  //     return null;
  //   }

  // }

  // // redeemdebt(eosio::name storeman, std::string x, std::string r, std::string s)
  // async getDebtRedeemData() {
  //   if (this.debtOptEnable) {
  //     this.logger.debug("********************************** funcInterface **********************************", this.debtFunc[1], "hashX", this.hashKey);
  //     this.logger.debug('getDebtRedeemData: transChainType-', this.transChainType, 'crossDirection-', this.crossDirection, 'tokenAddr-', this.tokenAddr, 'hashKey-', this.hashKey, 'key-', this.key);
  
  //     let signData = [hexTrip0x(this.storemanAddress), hexTrip0x(this.key)];
  //     let internalSignature = await this.internalSignViaMpc(signData);
  
  //     if (this.isLeader) {
  //       let actions = [{
  //         account: this.contractAddr,
  //         name: this.debtFunc[1],
  //         authorization: [{
  //           actor: this.storemanAddress,
  //           permission: 'active',
  //         }],
  //         data: {
  //           storeman: this.storemanAddress,
  //           x: hexTrip0x(this.key),
  //           r: hexTrip0x(internalSignature.R),
  //           s: hexTrip0x(internalSignature.S)
  //         }
  //       }];
  //       return actions;
  //     } else {
  //       return null;
  //     }
  //   } else {
  //     this.logger.warn("********************************** funcInterface ********************************** getDebtRedeemData", "hashX", this.hashKey, "debtOptEnable is ", this.debtOptEnable);
  //     this.logger.warn('getDebtRedeemData: transChainType-', this.transChainType, 'crossDirection-', this.crossDirection, 'tokenAddr-', this.tokenAddr, 'hashKey-', this.hashKey, 'key-', this.key);

  //     return null;
  //   }

  // }

  // // revokedebt(std::string xHash, std::string r, std::string s)
  // async getDebtRevokeData() {
  //   if (this.debtOptEnable) {
  //     this.logger.debug("********************************** funcInterface **********************************", this.debtFunc[2], "hashX", this.hashKey);
  //     this.logger.debug('getDebtRevokeData: transChainType-', this.transChainType, 'crossDirection-', this.crossDirection, 'tokenAddr-', this.tokenAddr, 'hashKey-', this.hashKey);
  
  //     // let signData = [hexTrip0x(this.storemanAddress), hexTrip0x(this.hashKey)];
  //     // let internalSignature = await this.internalSignViaMpc(signData);
  
  //     if (this.isLeader) {
  //       let actions = [{
  //         account: this.contractAddr,
  //         name: this.debtFunc[2],
  //         authorization: [{
  //           actor: this.storemanAddress,
  //           permission: 'active',
  //         }],
  //         data: {
  //           // storeman: hexTrip0x(this.storemanAddress),
  //           xHash: hexTrip0x(this.hashKey),
  //           // r: hexTrip0x(internalSignature.R),
  //           // s: hexTrip0x(internalSignature.S)
  //         }
  //       }];
  //       return actions;
  //     } else {
  //       return null;
  //     }
  //   } else {
  //     this.logger.warn("********************************** funcInterface ********************************** getDebtRevokeData", "hashX", this.hashKey, "debtOptEnable is ", this.debtOptEnable);
  //     this.logger.warn('getDebtRevokeData: transChainType-', this.transChainType, 'crossDirection-', this.crossDirection, 'tokenAddr-', this.tokenAddr, 'hashKey-', this.hashKey);

  //     return null;
  //   }

  // }

  // withdraw(eosio::name storeman, std::string account, std::string sym, std::string pk, std::string timeStamp,eosio::name receiver,std::string r,std::string s)
  // verify(&timeStampView, &receiverView, &acctView, &symVie)
  async getWithdrawFeeData() {
    if (this.debtOptEnable) {
      this.logger.debug("********************************** funcInterface **********************************", this.withdrawFeeFunc, "hashX", this.hashKey);
      this.logger.debug('getWithdrawFeeData: transChainType-', this.transChainType, 'crossDirection-', this.crossDirection, 'tokenAddr-', this.tokenAddr, 'hashKey-', this.hashKey);

      let account = '';
      let sys = '';
      if (tokenAddr) {
        account = this.tokenAddr.split(':')[0];
        sys = this.decimals + ',' + this.tokenSymbol;
      }
      let signData = [this.record.withdrawFeeTime, this.crossAddress, account, sys];
      let internalSignature = await this.internalSignViaMpc(signData);

      if (this.isLeader) {
        let actions = [{
          account: this.contractAddr,
          name: this.withdrawFeeFunc,
          authorization: [{
            actor: this.storemanAddress,
            permission: 'active',
          }],
          data: {
            storeman: hexTrip0x(this.storemanAddress),
            account: account,
            sys: sys,
            pk: hexTrip0x(this.storemanPk),
            timeStamp: this.record.withdrawFeeTime,
            receiver: this.crossAddress,
            r: hexTrip0x(internalSignature.R),
            s: hexTrip0x(internalSignature.S)
          }
        }];
        return actions;
      } else {
        return null;
      }
    } else {
      this.logger.warn("********************************** funcInterface ********************************** getWithdrawFeeData", "hashX", this.hashKey, "debtOptEnable is ", this.debtOptEnable);
      this.logger.warn('getWithdrawFeeData: transChainType-', this.transChainType, 'crossDirection-', this.crossDirection, 'tokenAddr-', this.tokenAddr, 'hashKey-', this.hashKey);

      return null;
    }
  }

  getDecodeEventTokenAddr(decodeEvent) {
    return decodeEvent.args.tokenOrigAccount;
  }

  getDecodeEventStoremanGroup(decodeEvent) {
    if (decodeEvent.event === this.debtEvent[0]) {
      return decodeEvent.args.npk;
    } else {
      return decodeEvent.args.storeman;
    }
  }

  getDecodeEventValue(decodeEvent) {
    // return decodeEvent.args.value;
    let symbol = this.config.crossTokens[this.crossChain].TOKEN[this.getDecodeEventTokenAddr(decodeEvent)].tokenSymbol;
    let decimals = this.config.crossTokens[this.crossChain].TOKEN[this.getDecodeEventTokenAddr(decodeEvent)].decimals;
    let value = eosToFloat(decodeEvent.args.value);
    return tokenToWei(value, decimals);
  }

  getDecodeEventToHtlcAddr(decodeEvent) {
    return decodeEvent.args.toHtlcAddr;
  }

  getDecodeCrossAddress(decodeEvent) {
    if (decodeEvent.event === this.debtEvent[0]) {
      return decodeEvent.args.pk;
    } else {
      return decodeEvent.args.wanAddr;
    }
  }

  _stringToHex(string) {
    var val = "0x";
      for (var i = 0; i < string.length; i++) {
        if (val == "")
          val = string.charCodeAt(i).toString(16);
        else
          val += string.charCodeAt(i).toString(16);
      }
      return val;
  }

  stringToHex(str) {
    const buf = Buffer.from(str, 'utf8');
    return buf.toString('hex');
  }

  hexToString(str) {
    const buf = new Buffer(str, 'hex');
    return buf.toString('utf8');
  }

  encodeBase64(data) {
    return new Buffer(data).toString('base64');
  }

  decodeBase64(data) {
    return new Buffer(data, 'base64').toString();
  }

  encodeToken(account, quantity) {
    let symbol = quantity.split(' ')[1];
    return account + ':' + symbol;
  }

  encode(signData, typesArray) {
    let data = '';
    if (Array.isArray(signData)) {
      data = signData.join(':');
    } else {
      data = signData;
    }
    this.logger.debug("********************************** encode signData **********************************", data, "hashX:", this.hashKey);
    let str = this.encodeBase64(data);
    this.logger.debug("********************************** encode signData after base64 **********************************", str, "hashX:", this.hashKey);
    return hexAdd0x(this.stringToHex(str));
    // return this._stringToHex(str);
  }

  decode(signData, typesArray) {
    this.logger.debug("********************************** decode signData **********************************", signData, "hashX:", this.hashKey);

    let strData = this.hexToString(hexTrip0x(signData));
    let decodeResult = this.decodeBase64(strData);

    return decodeResult.split(':');
  }

  // only follower with decodeSignatureData to create debtlock
  decodeSignatureData(signData) {
    // signData extern should be "cross:debt:EOS:tokenType:EOS"  /"cross:withdraw:EOS:tokenType:EOS"  /"cross:withdraw:EOS:tokenType:WAN"  / "cross:normal:EOS:tokenType:EOS" /"cross:normal:EOS:tokenType:WAN"
    let content = null;
    let extern = signData.extern.split(':');
    if (extern.length === 5 && extern[0] === 'cross') {
      let data = this.decode(signData.data);
      if (extern[1] === this.debtFunc[0]) {
        // lockdebt(eosio::name storeman, std::string npk, eosio::name account, eosio::asset quantity, std::string xHash, std::string pk, std::string r, std::string s)
        // verify(&npkView, &acctView, &qView, &xHashView)
        let debtor = data[0];
        let tokenAddr = this.encodeToken(data[1], data[2]);
        let debt = eosToFloat(data[2]);
        let hashX = data[3];

        content = this.createDebtData(this.crossChain, this.crossChain, this.tokenType, tokenAddr, debtor, debt, hashX);
      } else if (extern[1] === this.withdrawFeeFunc && global.argv.oriReceiver) {
        // withdraw(eosio::name storeman, std::string account, std::string sym, std::string pk, std::string timeStamp,eosio::name receiver,std::string r,std::string s)
        // verify(&timeStampView, &receiverView, &acctView, &symVie)
        let timestamp = data[0];
        let receiver;
        // receiver = data[1];
        receiver = global.argv.oriReceiver;
        let symbol = dat1[3].split(',')[1];
        let tokenAddr = this.encodeToken(data[2], symbol);

        content = this.createWithdrawFeeData(this.crossChain, this.crossChain, this.tokenType, tokenAddr, receiver, timestamp);
      }
    }
    return content;
  }
}