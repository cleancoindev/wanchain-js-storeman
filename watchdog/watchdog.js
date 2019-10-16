"use strict";

const fs = require('fs');
const optimist = require('optimist');

let argv    = optimist
  .usage('Usage: nodejs $0  [--testnet]')
  .argv;
global.testnet = argv.testnet ? true : false;

const {
  getGlobalChain,
  sleep
} = require('comm/lib');

const Logger = require('comm/logger.js');
const config = require('watchdog/config.js');

let log = new Logger("watchdogLogger", "log/watchdog.log", "log/watchdog_error.log", 'debug');
let chainWeb3IpOpsDict = config.chainWeb3IpOpsDict;
let testnet = config.testNet;
let curEthWeb3Ip = config.curEthWeb3Ip;
let syncInterval = config.syncInterval;
let firstStart = true;

function checkTimeout(timeTicks,timeOutOfLastBlock,chainType){
  let nowTimeStamp = Math.round(new Date().getTime()/1000);   // ms->s
  log.info("nowTimeStamp: %s, inputTimeStamp: %s, timeOutOfLastBlock:%s, chainType:%s",
    nowTimeStamp,timeTicks,timeOutOfLastBlock,chainType);
  if(nowTimeStamp >= (timeTicks + timeOutOfLastBlock) ){
    return true;
  }else{
    return false;
  }
}

async function watchdog(chainType) {
  let blockNumber;
  let blockTimeStamp;
  let timeOutOrNot;
  let nodeIpOps = chainWeb3IpOpsDict[chainType];
  let timeOutOfLastBlock = nodeIpOps.timeOutOfLastBlock;
  let currentOKWeb3IpIndex = nodeIpOps.currentOKWeb3IpIndex;
  let fileName = nodeIpOps.nextWeb3IpFileName;
  let web3Ips = nodeIpOps.web3Ips;

  if (firstStart && (web3Ips.indexOf(curEthWeb3Ip) !== -1)) {
    await writeConfigToFile(fileName);
    currentOKWeb3IpIndex = web3Ips.indexOf(curEthWeb3Ip);
    firstStart = false;
  }

  let chain = getGlobalChain(chainType.toUpperCase());

  let updateWeb3Ip = async function(chainType) {
    try {
      let nextIp;
      let len = web3Ips.length;
      currentOKWeb3IpIndex = (currentOKWeb3IpIndex + 1) % len;
      nextIp = web3Ips[currentOKWeb3IpIndex];
      log.debug("nextOKWeb3IpIndex = %s nextIp = %s chainType = %s",
        currentOKWeb3IpIndex, nextIp, chainType);

      let update = await writeWeb3IpToFile(fileName, chainType, nextIp);
      if (update) {
        chainWeb3IpOpsDict[chainType].currentOKWeb3IpIndex = currentOKWeb3IpIndex;
      }
    } catch (err) {
      log.error(err);
    }
  }

  return new Promise(async (resolve, reject) => {
    try {
      chain.client.eth.getBlockNumber((err, result) => {
        if (err) {
          log.error("getBlockNumber " + err + " chainType " + chainType + " curEthWeb3Ip "+ curEthWeb3Ip);

          updateWeb3Ip(chainType);
          resolve();
        } else {
          log.debug("getBlockNumber,blockNumber %s chainType %s curEthWeb3Ip %s", result, chainType, curEthWeb3Ip);
          blockNumber = result;

          chain.client.eth.getBlock(blockNumber, (err, block) => {
            try {
              if (err) {
                log.error("getBlockByNumber " + err + " chainType " + chainType + " curEthWeb3Ip "+ curEthWeb3Ip);
                updateWeb3Ip();
                resolve();
              } else {
                if (block !== null) {
                  log.debug("getLatestBlockTime %s chainType %s curEthWeb3Ip %s", block.timestamp, chainType, curEthWeb3Ip);
                  blockTimeStamp = block.timestamp;

                  timeOutOrNot = false;
                  timeOutOrNot = checkTimeout(blockTimeStamp, timeOutOfLastBlock, chainType);
                } else {
                  timeOutOrNot = true;
                }
                log.info("timeOutOrNot %s chainType %s curEthWeb3Ip %s", timeOutOrNot, chainType, curEthWeb3Ip);
                if (timeOutOrNot) {
                  updateWeb3Ip();
                }
                resolve();
              }
            } catch (err) {
              log.error("getBlock Info " + err + " chainType " + chainType+ " curEthWeb3Ip "+ curEthWeb3Ip);
              reject(err);
            }
          });
        }
      });
    } catch (err) {
      log.error("getBlock Info " + err + " chainType " + chainType + " curEthWeb3Ip "+ curEthWeb3Ip);
      reject(err);
    }
  });
}

function writeWeb3IpToFile(filename, chainType, nextIp) {
  return new Promise(async (resolve, reject) => {
    fs.readFile(filename, (err, data) => {
      if (err) {
        log.error("writeWeb3IpToFile readFile ", err);
        resolve(false);
      }

      var config = data.toString();
      config = JSON.parse(config);

      var net;
      if (testnet) {
        net = "testnet";
      } else {
        net = "main";
      }

      if(nextIp === undefined) {
        resolve(true);
        return;
      }

      let curIp = config[net].crossTokens[chainType].CONF.nodeUrl;
      config[net].ethWeb3Url = nextIp;

      var str = JSON.stringify(config, null, 2);
      fs.writeFile(filename, str, (err) => {
        if (err) {
          log.error("writeWeb3IpToFile writeFile ", err);
          resolve(false);
        } else {
          log.info("Update done! curIp %s to nextIp %s", curIp, nextIp);
          resolve(true);
        }
      })
    })
  });
};

function writeConfigToFile(filename) {
  return new Promise(async (resolve, reject) => {
    fs.readFile(filename, (err, data) => {
      if (err) {
        log.error("writeConfigToFile readFile ", err);
        resolve(false);
      }

      var config = data.toString();
      config = JSON.parse(config);

      var net;
      if (testnet) {
        net = "testnet";
      } else {
        net = "main";
      }

      let url = 'http://' + process.env.RPCIP + ':' + process.env.RPCPORT;
      let isLeader = process.env.IS_LEADER === 'true' ? true : false;
      config[net].wanWeb3Url = url;
      config[net].mpcUrl = url;
      config[net].isLeader = isLeader;

      var str = JSON.stringify(config, null, 2);
      fs.writeFile(filename, str, (err) => {
        if (err) {
          log.error("writeConfigToFile writeFile ", err);
          resolve(false);
        } else {
          log.info("Update done! mpcUrl %s", url);
          resolve(true);
        }
      })
    })
  });
};

async function mainLoop() {
  while (1) {
    log.info("Watchdog loop begins...");
    try {
      await watchdog('ETH');
      await sleep(syncInterval);
    } catch (err) {
      log.error("Watchdog error " + err);
    }
  }
}

mainLoop();