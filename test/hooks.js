'use strict';

const Web3 = require('web3');
const ZeroClientProvider = require('../src/connection/zero_client_provider');
/**
 * @file contains hooks that are executed across the entire test suite.
 * The `before` hook is executed at the beginning of a test run. The `afterEach` hook is executed
 * after every test case.
 *
 * This means that the configuration file is automatically updated on disk after every test case. A
 * test only needs to update the configuration object with the updated values.
 */

const { CONFIG_FILE_PATH } = require('./constants');
const ChainConfig = require('../src/config/chain_config');
const shared = require('./shared');
const funder = require('./funder');

const setupProvider = (
  chainConfig,
  originAccount,
  auxiliaryAccount,
) => {
  const originAddresses = Object.keys(originAccount).map(a => originAccount[a].address);
  const auxiliaryAddresses = Object.keys(auxiliaryAccount).map(a => auxiliaryAccount[a].address);

  const originAccountAddressVsAccount = {};
  const auxiliaryAccountAddressVsAccount = {};


  Object.keys(originAccount).forEach(
    (a) => {
      originAccountAddressVsAccount[originAccount[a].address.toLowerCase()] = originAccount[a];
    },
  );
  Object.keys(auxiliaryAccount).forEach(
    (a) => {
      auxiliaryAccountAddressVsAccount[
        auxiliaryAccount[a].address.toLowerCase()
      ] = auxiliaryAccount[a];
    },
  );

  console.log('originAddresses  ', originAddresses);
  console.log('auxiliaryAddresses  ', auxiliaryAddresses);

  const originEngine = ZeroClientProvider({
    rpcUrl: chainConfig.originWeb3Provider,
    getAccounts: callback => callback(null, originAddresses),
    signTransaction: (tx, cb) => {
      const extractRawTx = (error, response) => {
        cb(error, response.rawTransaction);
      };
      console.log('tx.from  ', tx.from);
      console.log('originAccountAddressVsAccount[tx.from]  ', originAccountAddressVsAccount[tx.from]);
      originAccountAddressVsAccount[tx.from.toLowerCase()].signTransaction(tx, extractRawTx);
    },
  });

  // Network connectivity error.
  originEngine.on('error', (err) => {
    console.error(`Provider: ${err.stack}`);
  });

  const auxiliaryEngine = ZeroClientProvider({
    rpcUrl: chainConfig.auxiliaryWeb3Provider,
    getAccounts: callback => callback(null, auxiliaryAddresses),
    signTransaction: (tx, cb) => {
      const extractRawTx = (error, response) => {
        cb(error, response.rawTransaction);
      };
      console.log('tx.from  ', tx.from);
      console.log('auxiliaryAccountAddressVsAccount[tx.from]  ', auxiliaryAccountAddressVsAccount[tx.from]);
      auxiliaryAccountAddressVsAccount[tx.from.toLowerCase()].signTransaction(tx, extractRawTx);
    },
  });

  // Network connectivity error.
  auxiliaryEngine.on('error', (err) => {
    console.error(`Provider: ${err.stack}`);
  });

  const originWeb3 = new Web3();
  originWeb3.setProvider(originEngine);

  const auxiliaryWeb3 = new Web3();
  auxiliaryWeb3.setProvider(auxiliaryEngine);
  return { originWeb3, auxiliaryWeb3 };
};

/**
 * Sets up the connection to the ethereum nodes to be used by the tests.
 * It adds the connection and chain configuration to the `shared` module where the test cases can
 * access them.
 */
before(async () => {
  const chainConfig = new ChainConfig(CONFIG_FILE_PATH);
  shared.chainConfig = chainConfig;

  try {
    const web3 = new Web3();
    await funder.addOriginAccount('originDeployer', web3);
    await funder.addOriginAccount('originMasterKey', web3);
    await funder.addOriginAccount('originWorker', web3);

    await funder.addAuxiliaryAccount('auxiliaryDeployer', web3);
    await funder.addAuxiliaryAccount('auxiliaryMasterKey', web3);
    await funder.addAuxiliaryAccount('auxiliaryWorker', web3);

    console.log('shared.accounts.origin ', shared.accounts.origin);
    const { originWeb3, auxiliaryWeb3 } = setupProvider(
      chainConfig,
      shared.accounts.origin,
      shared.accounts.auxiliary,
    );

    // Origin account and auxiliary account keys are added to make it
    // connection backward compatible with agents.
    shared.connection = {
      originWeb3,
      auxiliaryWeb3,
      originAccount: shared.accounts.origin.originDeployer,
      auxiliaryAccount: shared.accounts.auxiliary.auxiliaryDeployer,
    };

    originWeb3.eth.getTransactionReceiptMined = funder.getTransactionReceiptMined;
    auxiliaryWeb3.eth.getTransactionReceiptMined = funder.getTransactionReceiptMined;

    const originFundRequests = Promise.all([
      funder.fundAccountFromMosaicFaucet(
        shared.accounts.origin.originDeployer.address,
        shared.accounts.origin.originDeployer.chainId,
      ),
    ]);

    const auxiliaryFundRequests = Promise.all([
      funder.fundAccountFromMosaicFaucet(
        shared.accounts.auxiliary.auxiliaryDeployer.address,
        shared.accounts.auxiliary.auxiliaryDeployer.chainId,
      ),
    ]);

    const ropstenFaucetFundRequest = Promise.all([
      funder.fundAccountFromRopstenFaucet(
        shared.accounts.origin.originDeployer.address,
      ),
    ]);
    const receipts = await funder.waitForFunding(
      originFundRequests,
      auxiliaryFundRequests,
      ropstenFaucetFundRequest,
      originWeb3,
      auxiliaryWeb3,
    );

    shared.faucetTransactions = await funder.faucetTransactionDetails(
      receipts.txHashes.originFaucetTXHashes,
      receipts.txHashes.auxiliaryFaucetTXHashes,
      receipts.txHashes.ropstenFaucetTXHashes,
      originWeb3,
      auxiliaryWeb3,
    );
  } catch (error) {
    console.log(error);
    console.error(`Failed in before each hook ${error}`);
  }
});

after(async () => {
  console.log('Refunding to faucet');
  await funder.refundERC20TokenToFaucet(
    shared.connection.originWeb3,
    shared.accounts.origin.originDeployer.address,
    shared.faucetTransactions.originTransactions,
  );
  await Promise.all(
    [
      funder.refundBaseTokenToFaucet(
        shared.connection.originWeb3,
        shared.accounts.origin.originDeployer.address,
        shared.faucetTransactions.ropstenTransactions.faucetAddress,
      ),
      funder.refundBaseTokenToFaucet(
        shared.connection.auxiliaryWeb3,
        shared.accounts.auxiliary.auxiliaryDeployer.address,
        shared.faucetTransactions.auxiliaryTransactions.faucetAddress,
      ),
    ],
  );
});
/**
 * Writes the current chain config object to disk, overwriting the previous chain configuration
 * file.e
 */
afterEach(() => {
  shared.chainConfig.write(CONFIG_FILE_PATH);
});
