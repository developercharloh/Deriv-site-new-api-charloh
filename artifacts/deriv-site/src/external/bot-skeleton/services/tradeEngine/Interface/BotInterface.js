import { observer as globalObserver } from '../../../utils/observer';
import { createDetails } from '../utils/helpers';

const getBotInterface = tradeEngine => {
    const getDetail = i => {
        // FAST can begin the next tick while the newly purchased contract is
        // still open. Result-dependent Blockly blocks must inspect the last
        // authoritative settlement, not that open contract (which has no
        // final profit/result yet).
        const settledContract = tradeEngine.lastSettledContract;
        if (settledContract) return createDetails(settledContract)[i];
        return undefined;
    };

    return {
        init: (...args) => tradeEngine.init(...args),
        start: (...args) => tradeEngine.start(...args),
        stop: (...args) => tradeEngine.stop(...args),
        purchase: (contract_type, prediction) => tradeEngine.purchase(contract_type, prediction),
        getAskPrice: contract_type => Number(getProposal(contract_type, tradeEngine).ask_price),
        getPayout: contract_type => Number(getProposal(contract_type, tradeEngine).payout),
        getPurchaseReference: () => tradeEngine.getPurchaseReference(),
        isSellAvailable: () => tradeEngine.isSellAtMarketAvailable(),
        sellAtMarket: () => tradeEngine.sellAtMarket(),
        getSellPrice: () => getSellPrice(tradeEngine),
        // Before the first settlement there is no loss to recover from, so
        // preserve the configured initial stake by treating the result as a
        // win for the initial after-purchase evaluation.
        isResult: result => (getDetail(10) ?? 'win') === result,
        isTradeAgain: result => globalObserver.emit('bot.trade_again', result),
        readDetails: i => getDetail(i - 1),
    };
};

const getProposal = (contract_type, tradeEngine) => {
    return tradeEngine.data.proposals.find(
        proposal =>
            proposal.contract_type === contract_type &&
            proposal.purchase_reference === tradeEngine.getPurchaseReference()
    );
};

const getSellPrice = tradeEngine => {
    return tradeEngine.getSellPrice();
};

export default getBotInterface;
