// ─── Even/Odd Bot XML Generator ───────────────────────────────────────────────
// Produces a Deriv Bot-compatible Blockly XML pre-filled with signal parameters.
// Import the downloaded file directly into Deriv Bot Builder to run.

export interface EvenOddBotParams {
    symbol:     string;   // e.g. '1HZ50V'
    direction:  'EVEN' | 'ODD';
    entryDigit: number;   // 0–9
    stake:      number;   // e.g. 0.5
    takeProfit: number;   // $ e.g. 10
    stopLoss:   number;   // $ e.g. 30
    martingale: number;   // multiplier e.g. 2
    duration?:  number;   // contract length in ticks (1–10), default 1
}

export function generateEvenOddXml(p: EvenOddBotParams): string {
    const contract = p.direction === 'EVEN' ? 'DIGITEVEN' : 'DIGITODD';
    const ticks    = Math.max(1, Math.min(10, Math.round(p.duration ?? 1)));

    return `<xml xmlns="https://developers.google.com/blockly/xml" is_dbot="true" collection="false">
  <variables>
    <variable id="stake_id">stake</variable>
    <variable id="initial_stake_id">initial_stake</variable>
    <variable id="total_lost_id">total_lost</variable>
    <variable id="martingale_factor_id">martingale_factor</variable>
    <variable id="loop_stop_id">loop_stop</variable>
    <variable id="duration_id">duration</variable>
    <variable id="take_profit_id">take_profit</variable>
    <variable id="consecutive_losses_id">consecutive_losses</variable>
    <variable id="stop_loss_id">stop_loss</variable>
    <variable id="entry_point_id">entry_point</variable>
  </variables>
  <block type="trade_definition" id="trade_def_main" deletable="false" x="0" y="110">
    <statement name="TRADE_OPTIONS">
      <block type="trade_definition_market" id="market_cfg" deletable="false" movable="false">
        <field name="MARKET_LIST">synthetic_index</field>
        <field name="SUBMARKET_LIST">random_index</field>
        <field name="SYMBOL_LIST">${p.symbol}</field>
        <field name="ALTERNATE_MARKETS">FALSE</field>
        <field name="ALTERNATE_MODE">EVERY_X_RUNS</field>
        <field name="ALTERNATE_EVERY">1</field>
        <next>
          <block type="trade_definition_tradetype" id="tradetype_cfg" deletable="false" movable="false">
            <field name="TRADETYPECAT_LIST">digits</field>
            <field name="TRADETYPE_LIST">evenodd</field>
            <next>
              <block type="trade_definition_contracttype" id="contract_cfg" deletable="false" movable="false">
                <field name="TYPE_LIST">both</field>
                <next>
                  <block type="trade_definition_candleinterval" id="candle_cfg" deletable="false" movable="false">
                    <field name="CANDLEINTERVAL_LIST">60</field>
                    <next>
                      <block type="trade_definition_restartbuysell" id="restart_cfg" deletable="false" movable="false">
                        <field name="TIME_MACHINE_ENABLED">FALSE</field>
                        <field name="VH_ENABLED">FALSE</field>
                        <next>
                          <block type="trade_definition_restartonerror" id="error_cfg" deletable="false" movable="false">
                            <field name="RESTARTONERROR">TRUE</field>
                          </block>
                        </next>
                      </block>
                    </next>
                  </block>
                </next>
              </block>
            </next>
          </block>
        </next>
      </block>
    </statement>
    <statement name="INITIALIZATION">
      <block type="variables_set" id="set_stake_init">
        <field name="VAR" id="stake_id">stake</field>
        <value name="VALUE">
          <block type="math_number" id="stake_val">
            <field name="NUM">${p.stake}</field>
          </block>
        </value>
        <next>
          <block type="variables_set" id="set_initial_stake">
            <field name="VAR" id="initial_stake_id">initial_stake</field>
            <value name="VALUE">
              <block type="variables_get" id="get_stake_copy">
                <field name="VAR" id="stake_id">stake</field>
              </block>
            </value>
            <next>
              <block type="variables_set" id="set_mart_factor">
                <field name="VAR" id="martingale_factor_id">martingale_factor</field>
                <value name="VALUE">
                  <block type="math_number" id="mart_val">
                    <field name="NUM">${p.martingale}</field>
                  </block>
                </value>
                <next>
                  <block type="variables_set" id="set_tp">
                    <field name="VAR" id="take_profit_id">take_profit</field>
                    <value name="VALUE">
                      <block type="math_number" id="tp_val">
                        <field name="NUM">${p.takeProfit}</field>
                      </block>
                    </value>
                    <next>
                      <block type="variables_set" id="set_sl">
                        <field name="VAR" id="stop_loss_id">stop_loss</field>
                        <value name="VALUE">
                          <block type="math_number" id="sl_val">
                            <field name="NUM">${p.stopLoss}</field>
                          </block>
                        </value>
                        <next>
                          <block type="variables_set" id="set_duration">
                            <field name="VAR" id="duration_id">duration</field>
                            <value name="VALUE">
                              <block type="math_number" id="dur_val">
                                <field name="NUM">${ticks}</field>
                              </block>
                            </value>
                            <next>
                              <block type="variables_set" id="set_total_lost">
                                <field name="VAR" id="total_lost_id">total_lost</field>
                                <value name="VALUE">
                                  <block type="math_number" id="tl_val">
                                    <field name="NUM">0</field>
                                  </block>
                                </value>
                                <next>
                                  <block type="variables_set" id="set_consecutive_losses">
                                    <field name="VAR" id="consecutive_losses_id">consecutive_losses</field>
                                    <value name="VALUE">
                                      <block type="math_number" id="cl_val">
                                        <field name="NUM">0</field>
                                      </block>
                                    </value>
                                    <next>
                                      <block type="variables_set" id="set_entry_point">
                                        <field name="VAR" id="entry_point_id">entry_point</field>
                                        <value name="VALUE">
                                          <block type="math_number" id="ep_val">
                                            <field name="NUM">${p.entryDigit}</field>
                                          </block>
                                        </value>
                                        <next>
                                          <block type="variables_set" id="set_loop_stop">
                                            <field name="VAR" id="loop_stop_id">loop_stop</field>
                                            <value name="VALUE">
                                              <block type="logic_boolean" id="ls_false">
                                                <field name="BOOL">FALSE</field>
                                              </block>
                                            </value>
                                            <next>
                                              <block type="notify" id="init_notify" collapsed="true">
                                                <field name="NOTIFICATION_TYPE">success</field>
                                                <field name="NOTIFICATION_SOUND">silent</field>
                                                <value name="MESSAGE">
                                                  <shadow type="text" id="init_shadow">
                                                    <field name="TEXT">Bot Started — ${p.direction} on ${p.symbol}, entry digit ${p.entryDigit} 🤝</field>
                                                  </shadow>
                                                </value>
                                              </block>
                                            </next>
                                          </block>
                                        </next>
                                      </block>
                                    </next>
                                  </block>
                                </next>
                              </block>
                            </next>
                          </block>
                        </next>
                      </block>
                    </next>
                  </block>
                </next>
              </block>
            </next>
          </block>
        </next>
      </block>
    </statement>
    <statement name="SUBMARKET">
      <block type="controls_whileUntil" id="entry_loop" collapsed="true">
        <field name="MODE">UNTIL</field>
        <value name="BOOL">
          <block type="logic_compare" id="check_loop_stop">
            <field name="OP">EQ</field>
            <value name="A">
              <block type="variables_get" id="get_loop_stop">
                <field name="VAR" id="loop_stop_id">loop_stop</field>
              </block>
            </value>
            <value name="B">
              <block type="logic_boolean" id="bool_true">
                <field name="BOOL">TRUE</field>
              </block>
            </value>
          </block>
        </value>
        <statement name="DO">
          <block type="timeout" id="entry_timeout">
            <statement name="TIMEOUTSTACK">
              <block type="controls_if" id="check_entry">
                <value name="IF0">
                  <block type="logic_compare" id="digit_eq_entry">
                    <field name="OP">EQ</field>
                    <value name="A">
                      <block type="last_digit" id="entry_last_digit"></block>
                    </value>
                    <value name="B">
                      <block type="variables_get" id="get_entry_point">
                        <field name="VAR" id="entry_point_id">entry_point</field>
                      </block>
                    </value>
                  </block>
                </value>
                <statement name="DO0">
                  <block type="variables_set" id="set_loop_stop_true">
                    <field name="VAR" id="loop_stop_id">loop_stop</field>
                    <value name="VALUE">
                      <block type="logic_boolean" id="stop_true">
                        <field name="BOOL">TRUE</field>
                      </block>
                    </value>
                    <next>
                      <block type="notify" id="entry_found_notify">
                        <field name="NOTIFICATION_TYPE">success</field>
                        <field name="NOTIFICATION_SOUND">silent</field>
                        <value name="MESSAGE">
                          <shadow type="text" id="entry_found_shadow">
                            <field name="TEXT">Entry digit ${p.entryDigit} found — placing ${p.direction} trade ✅</field>
                          </shadow>
                        </value>
                      </block>
                    </next>
                  </block>
                </statement>
                <next>
                  <block type="controls_if" id="scan_notify_check">
                    <value name="IF0">
                      <block type="logic_negate" id="not_loop_stop">
                        <value name="BOOL">
                          <block type="variables_get" id="get_ls_check">
                            <field name="VAR" id="loop_stop_id">loop_stop</field>
                          </block>
                        </value>
                      </block>
                    </value>
                    <statement name="DO0">
                      <block type="notify" id="scanning_notify">
                        <field name="NOTIFICATION_TYPE">info</field>
                        <field name="NOTIFICATION_SOUND">silent</field>
                        <value name="MESSAGE">
                          <shadow type="text" id="scan_shadow">
                            <field name="TEXT">Scanning for digit ${p.entryDigit} on ${p.symbol} 📈📉</field>
                          </shadow>
                        </value>
                      </block>
                    </statement>
                  </block>
                </next>
              </block>
            </statement>
            <value name="SECONDS">
              <block type="math_number" id="timeout_seconds">
                <field name="NUM">1</field>
              </block>
            </value>
          </block>
        </statement>
        <next>
          <block type="trade_definition_tradeoptions" id="tradeoptions_main">
            <mutation xmlns="http://www.w3.org/1999/xhtml" has_first_barrier="false" has_second_barrier="false" has_prediction="false"></mutation>
            <field name="DURATIONTYPE_LIST">t</field>
            <field name="TRADE_EACH_TICK">FALSE</field>
            <value name="DURATION">
              <shadow type="math_number_positive" id="dur_shadow">
                <field name="NUM">${ticks}</field>
              </shadow>
              <block type="variables_get" id="get_duration">
                <field name="VAR" id="duration_id">duration</field>
              </block>
            </value>
            <value name="AMOUNT">
              <shadow type="math_number" id="amt_shadow">
                <field name="NUM">${p.stake}</field>
              </shadow>
              <block type="variables_get" id="get_stake_amt">
                <field name="VAR" id="stake_id">stake</field>
              </block>
            </value>
          </block>
        </next>
      </block>
    </statement>
  </block>
  <block type="after_purchase" id="after_purchase_main" x="875" y="110">
    <statement name="AFTERPURCHASE_STACK">
      <block type="controls_if" id="check_win_loss" collapsed="true">
        <mutation xmlns="http://www.w3.org/1999/xhtml" else="1"></mutation>
        <value name="IF0">
          <block type="contract_check_result" id="check_win">
            <field name="CHECK_RESULT">win</field>
          </block>
        </value>
        <statement name="DO0">
          <block type="variables_set" id="reset_stake_win">
            <field name="VAR" id="stake_id">stake</field>
            <value name="VALUE">
              <block type="variables_get" id="get_init_stake_win">
                <field name="VAR" id="initial_stake_id">initial_stake</field>
              </block>
            </value>
            <next>
              <block type="variables_set" id="reset_total_lost">
                <field name="VAR" id="total_lost_id">total_lost</field>
                <value name="VALUE">
                  <block type="math_number" id="tl_zero">
                    <field name="NUM">0</field>
                  </block>
                </value>
                <next>
                  <block type="variables_set" id="reset_consec_losses">
                    <field name="VAR" id="consecutive_losses_id">consecutive_losses</field>
                    <value name="VALUE">
                      <block type="math_number" id="cl_zero">
                        <field name="NUM">0</field>
                      </block>
                    </value>
                    <next>
                      <block type="notify" id="win_notify">
                        <field name="NOTIFICATION_TYPE">success</field>
                        <field name="NOTIFICATION_SOUND">silent</field>
                        <value name="MESSAGE">
                          <shadow type="text" id="win_shadow">
                            <field name="TEXT">Win ✅ — stake reset to $${p.stake}</field>
                          </shadow>
                        </value>
                      </block>
                    </next>
                  </block>
                </next>
              </block>
            </next>
          </block>
        </statement>
        <statement name="ELSE">
          <block type="math_change" id="add_to_total_lost">
            <field name="VAR" id="total_lost_id">total_lost</field>
            <value name="DELTA">
              <shadow type="math_number" id="delta_stake">
                <field name="NUM">1</field>
              </shadow>
              <block type="variables_get" id="get_stake_loss">
                <field name="VAR" id="stake_id">stake</field>
              </block>
            </value>
            <next>
              <block type="variables_set" id="calc_new_stake">
                <field name="VAR" id="stake_id">stake</field>
                <value name="VALUE">
                  <block type="math_arithmetic" id="mart_calc">
                    <field name="OP">MULTIPLY</field>
                    <value name="A">
                      <block type="variables_get" id="get_tl_mart">
                        <field name="VAR" id="total_lost_id">total_lost</field>
                      </block>
                    </value>
                    <value name="B">
                      <block type="variables_get" id="get_mart_factor">
                        <field name="VAR" id="martingale_factor_id">martingale_factor</field>
                      </block>
                    </value>
                  </block>
                </value>
                <next>
                  <block type="math_change" id="inc_consec_losses">
                    <field name="VAR" id="consecutive_losses_id">consecutive_losses</field>
                    <value name="DELTA">
                      <shadow type="math_number" id="inc_1">
                        <field name="NUM">1</field>
                      </shadow>
                    </value>
                    <next>
                      <block type="notify" id="loss_notify">
                        <field name="NOTIFICATION_TYPE">error</field>
                        <field name="NOTIFICATION_SOUND">silent</field>
                        <value name="MESSAGE">
                          <shadow type="text" id="loss_shadow">
                            <field name="TEXT">Loss ❌ — martingale ×${p.martingale} applied</field>
                          </shadow>
                        </value>
                      </block>
                    </next>
                  </block>
                </next>
              </block>
            </next>
          </block>
        </statement>
        <next>
          <block type="controls_if" id="tp_sl_check" collapsed="true">
            <mutation xmlns="http://www.w3.org/1999/xhtml" elseif="1" else="1"></mutation>
            <value name="IF0">
              <block type="logic_compare" id="check_tp">
                <field name="OP">GTE</field>
                <value name="A">
                  <block type="total_profit" id="tp_profit"></block>
                </value>
                <value name="B">
                  <block type="variables_get" id="get_tp_val">
                    <field name="VAR" id="take_profit_id">take_profit</field>
                  </block>
                </value>
              </block>
            </value>
            <statement name="DO0">
              <block type="notify" id="tp_notify">
                <field name="NOTIFICATION_TYPE">success</field>
                <field name="NOTIFICATION_SOUND">earned-money</field>
                <value name="MESSAGE">
                  <shadow type="text" id="tp_shadow">
                    <field name="TEXT">Take profit $${p.takeProfit} reached 🎯 — bot stopped</field>
                  </shadow>
                </value>
                <next>
                  <block type="tp_block" id="tp_stop_block"></block>
                </next>
              </block>
            </statement>
            <value name="IF1">
              <block type="logic_compare" id="check_sl">
                <field name="OP">LTE</field>
                <value name="A">
                  <block type="total_profit" id="sl_profit"></block>
                </value>
                <value name="B">
                  <block type="math_single" id="neg_sl">
                    <field name="OP">NEG</field>
                    <value name="NUM">
                      <shadow type="math_number" id="sl_shadow_num">
                        <field name="NUM">${p.stopLoss}</field>
                      </shadow>
                      <block type="variables_get" id="get_sl_val">
                        <field name="VAR" id="stop_loss_id">stop_loss</field>
                      </block>
                    </value>
                  </block>
                </value>
              </block>
            </value>
            <statement name="DO1">
              <block type="notify" id="sl_notify">
                <field name="NOTIFICATION_TYPE">error</field>
                <field name="NOTIFICATION_SOUND">error</field>
                <value name="MESSAGE">
                  <shadow type="text" id="sl_shadow">
                    <field name="TEXT">Stop loss $${p.stopLoss} hit 🛑 — bot stopped</field>
                  </shadow>
                </value>
                <next>
                  <block type="sl_block" id="sl_stop_block"></block>
                </next>
              </block>
            </statement>
            <statement name="ELSE">
              <block type="notify" id="continue_notify">
                <field name="NOTIFICATION_TYPE">info</field>
                <field name="NOTIFICATION_SOUND">silent</field>
                <value name="MESSAGE">
                  <shadow type="text" id="cont_shadow">
                    <field name="TEXT">Continuing — scanning for digit ${p.entryDigit} 🔄</field>
                  </shadow>
                </value>
                <next>
                  <block type="trade_again" id="restart_trading"></block>
                </next>
              </block>
            </statement>
          </block>
        </next>
      </block>
    </statement>
  </block>
  <block type="before_purchase" id="before_purchase_main" collapsed="true" deletable="false" x="0" y="1424">
    <statement name="BEFOREPURCHASE_STACK">
      <block type="notify" id="trade_notify">
        <field name="NOTIFICATION_TYPE">info</field>
        <field name="NOTIFICATION_SOUND">silent</field>
        <value name="MESSAGE">
          <shadow type="text" id="trade_shadow">
            <field name="TEXT">Placing ${p.direction} trade on ${p.symbol} 📊</field>
          </shadow>
        </value>
        <next>
          <block type="mon_purchase" id="execute_purchase">
            <field name="PURCHASE_LIST">${contract}</field>
            <field name="MULTIPLE_CONTRACTS">FALSE</field>
            <field name="CONTRACT_QUANTITY">1</field>
          </block>
        </next>
      </block>
    </statement>
  </block>
</xml>`;
}

// ─── Matches / Differs Bot XML Generator ──────────────────────────────────────

export interface MatchesDiffersBotParams {
    symbol:          string;           // e.g. '1HZ75V'
    contract:        'DIGITMATCH' | 'DIGITDIFF';
    prediction:      number;           // 0–9 digit to match or differ
    stake:           number;
    takeProfit:      number;
    martingale:      number;           // multiplier per loss
    martingaleLevel: number;           // max consecutive losses before stopping
    duration?:       number;           // contract length in ticks (1–10), default 1
}

export function generateMatchesDiffersXml(p: MatchesDiffersBotParams): string {
    const dirLabel = p.contract === 'DIGITMATCH' ? 'MATCHES' : 'DIFFERS';
    const ticks    = Math.max(1, Math.min(10, Math.round(p.duration ?? 1)));

    return `<xml xmlns="https://developers.google.com/blockly/xml" is_dbot="true" collection="false">
  <variables>
    <variable id="md_pred_var">Prediction</variable>
    <variable id="md_stake_var">Stake</variable>
    <variable id="md_init_stake_var">InitialStake</variable>
    <variable id="md_tp_var">TakeProfit</variable>
    <variable id="md_loss_ctr_var">lossCounter</variable>
    <variable id="md_mart_lvl_var">MartingaleLevel</variable>
    <variable id="md_mart_var">Martingale</variable>
  </variables>
  <block type="trade_definition" id="md_trade_def" deletable="false" x="0" y="60">
    <statement name="TRADE_OPTIONS">
      <block type="trade_definition_market" id="md_market" deletable="false" movable="false">
        <field name="MARKET_LIST">synthetic_index</field>
        <field name="SUBMARKET_LIST">random_index</field>
        <field name="SYMBOL_LIST">${p.symbol}</field>
        <next>
          <block type="trade_definition_tradetype" id="md_tradetype" deletable="false" movable="false">
            <field name="TRADETYPECAT_LIST">digits</field>
            <field name="TRADETYPE_LIST">matchesdiffers</field>
            <next>
              <block type="trade_definition_contracttype" id="md_contracttype" deletable="false" movable="false">
                <field name="TYPE_LIST">${p.contract}</field>
                <next>
                  <block type="trade_definition_candleinterval" id="md_candle" deletable="false" movable="false">
                    <field name="CANDLEINTERVAL_LIST">60</field>
                    <next>
                      <block type="trade_definition_restartbuysell" id="md_restart" deletable="false" movable="false">
                        <field name="TIME_MACHINE_ENABLED">FALSE</field>
                        <next>
                          <block type="trade_definition_restartonerror" id="md_errorretry" deletable="false" movable="false">
                            <field name="RESTARTONERROR">TRUE</field>
                          </block>
                        </next>
                      </block>
                    </next>
                  </block>
                </next>
              </block>
            </next>
          </block>
        </next>
      </block>
    </statement>
    <statement name="INITIALIZATION">
      <block type="variables_set" id="md_set_pred">
        <field name="VAR" id="md_pred_var">Prediction</field>
        <value name="VALUE">
          <block type="math_number" id="md_pred_num">
            <field name="NUM">${p.prediction}</field>
          </block>
        </value>
        <next>
          <block type="variables_set" id="md_set_stake">
            <field name="VAR" id="md_stake_var">Stake</field>
            <value name="VALUE">
              <block type="math_number" id="md_stake_num">
                <field name="NUM">${p.stake}</field>
              </block>
            </value>
            <next>
              <block type="variables_set" id="md_set_init_stake">
                <field name="VAR" id="md_init_stake_var">InitialStake</field>
                <value name="VALUE">
                  <block type="math_number" id="md_init_stake_num">
                    <field name="NUM">${p.stake}</field>
                  </block>
                </value>
                <next>
                  <block type="variables_set" id="md_set_tp">
                    <field name="VAR" id="md_tp_var">TakeProfit</field>
                    <value name="VALUE">
                      <block type="math_number" id="md_tp_num">
                        <field name="NUM">${p.takeProfit}</field>
                      </block>
                    </value>
                    <next>
                      <block type="variables_set" id="md_set_mart_lvl">
                        <field name="VAR" id="md_mart_lvl_var">MartingaleLevel</field>
                        <value name="VALUE">
                          <block type="math_number" id="md_mart_lvl_num">
                            <field name="NUM">${p.martingaleLevel}</field>
                          </block>
                        </value>
                        <next>
                          <block type="variables_set" id="md_set_mart">
                            <field name="VAR" id="md_mart_var">Martingale</field>
                            <value name="VALUE">
                              <block type="math_number" id="md_mart_num">
                                <field name="NUM">${p.martingale}</field>
                              </block>
                            </value>
                            <next>
                              <block type="variables_set" id="md_set_loss_ctr">
                                <field name="VAR" id="md_loss_ctr_var">lossCounter</field>
                                <value name="VALUE">
                                  <block type="math_number" id="md_loss_ctr_num">
                                    <field name="NUM">1</field>
                                  </block>
                                </value>
                                <next>
                                  <block type="notify" id="md_init_notify" collapsed="true">
                                    <field name="NOTIFICATION_TYPE">success</field>
                                    <field name="NOTIFICATION_SOUND">silent</field>
                                    <value name="MESSAGE">
                                      <shadow type="text" id="md_init_shadow">
                                        <field name="TEXT">Bot Started — ${dirLabel} ${p.prediction} on ${p.symbol} 🤝</field>
                                      </shadow>
                                    </value>
                                  </block>
                                </next>
                              </block>
                            </next>
                          </block>
                        </next>
                      </block>
                    </next>
                  </block>
                </next>
              </block>
            </next>
          </block>
        </next>
      </block>
    </statement>
    <statement name="SUBMARKET">
      <block type="trade_definition_tradeoptions" id="md_tradeoptions">
        <mutation xmlns="http://www.w3.org/1999/xhtml" has_first_barrier="false" has_second_barrier="false" has_prediction="true"></mutation>
        <field name="DURATIONTYPE_LIST">t</field>
        <value name="DURATION">
          <shadow type="math_number_positive" id="md_dur_shadow">
            <field name="NUM">${ticks}</field>
          </shadow>
        </value>
        <value name="AMOUNT">
          <shadow type="math_number_positive" id="md_amt_shadow">
            <field name="NUM">${p.stake}</field>
          </shadow>
          <block type="variables_get" id="md_get_stake_amt">
            <field name="VAR" id="md_stake_var">Stake</field>
          </block>
        </value>
        <value name="PREDICTION">
          <shadow type="math_number_positive" id="md_pred_shadow">
            <field name="NUM">${p.prediction}</field>
          </shadow>
          <block type="variables_get" id="md_get_pred_val">
            <field name="VAR" id="md_pred_var">Prediction</field>
          </block>
        </value>
      </block>
    </statement>
  </block>
  <block type="after_purchase" id="md_after_purchase" x="886" y="60">
    <statement name="AFTERPURCHASE_STACK">
      <block type="controls_if" id="md_tp_check" collapsed="true">
        <mutation xmlns="http://www.w3.org/1999/xhtml" else="1"></mutation>
        <value name="IF0">
          <block type="logic_compare" id="md_tp_compare">
            <field name="OP">GTE</field>
            <value name="A">
              <block type="total_profit" id="md_tp_profit"></block>
            </value>
            <value name="B">
              <block type="variables_get" id="md_get_tp_val">
                <field name="VAR" id="md_tp_var">TakeProfit</field>
              </block>
            </value>
          </block>
        </value>
        <statement name="DO0">
          <block type="notify" id="md_tp_notify">
            <field name="NOTIFICATION_TYPE">success</field>
            <field name="NOTIFICATION_SOUND">earned-money</field>
            <value name="MESSAGE">
              <shadow type="text" id="md_tp_shadow">
                <field name="TEXT">Take profit $${p.takeProfit} reached 🎯 — bot stopped</field>
              </shadow>
            </value>
          </block>
        </statement>
        <statement name="ELSE">
          <block type="controls_if" id="md_win_check">
            <mutation xmlns="http://www.w3.org/1999/xhtml" else="1"></mutation>
            <value name="IF0">
              <block type="contract_check_result" id="md_check_win">
                <field name="CHECK_RESULT">win</field>
              </block>
            </value>
            <statement name="DO0">
              <block type="variables_set" id="md_reset_stake_win">
                <field name="VAR" id="md_stake_var">Stake</field>
                <value name="VALUE">
                  <block type="variables_get" id="md_get_init_stake_win">
                    <field name="VAR" id="md_init_stake_var">InitialStake</field>
                  </block>
                </value>
                <next>
                  <block type="variables_set" id="md_reset_loss_ctr">
                    <field name="VAR" id="md_loss_ctr_var">lossCounter</field>
                    <value name="VALUE">
                      <block type="math_number" id="md_loss_ctr_one">
                        <field name="NUM">1</field>
                      </block>
                    </value>
                    <next>
                      <block type="notify" id="md_win_notify">
                        <field name="NOTIFICATION_TYPE">success</field>
                        <field name="NOTIFICATION_SOUND">silent</field>
                        <value name="MESSAGE">
                          <shadow type="text" id="md_win_shadow">
                            <field name="TEXT">Win ✅ — stake reset to $${p.stake}</field>
                          </shadow>
                        </value>
                      </block>
                    </next>
                  </block>
                </next>
              </block>
            </statement>
            <statement name="ELSE">
              <block type="variables_set" id="md_mart_stake">
                <field name="VAR" id="md_stake_var">Stake</field>
                <value name="VALUE">
                  <block type="math_arithmetic" id="md_mart_calc">
                    <field name="OP">MULTIPLY</field>
                    <value name="A">
                      <shadow type="math_number" id="md_mart_a_shadow">
                        <field name="NUM">1</field>
                      </shadow>
                      <block type="variables_get" id="md_get_stake_loss">
                        <field name="VAR" id="md_stake_var">Stake</field>
                      </block>
                    </value>
                    <value name="B">
                      <shadow type="math_number" id="md_mart_b_shadow">
                        <field name="NUM">1</field>
                      </shadow>
                      <block type="variables_get" id="md_get_mart_val">
                        <field name="VAR" id="md_mart_var">Martingale</field>
                      </block>
                    </value>
                  </block>
                </value>
                <next>
                  <block type="math_change" id="md_inc_loss_ctr">
                    <field name="VAR" id="md_loss_ctr_var">lossCounter</field>
                    <value name="DELTA">
                      <shadow type="math_number" id="md_inc_shadow">
                        <field name="NUM">1</field>
                      </shadow>
                    </value>
                    <next>
                      <block type="notify" id="md_loss_notify">
                        <field name="NOTIFICATION_TYPE">error</field>
                        <field name="NOTIFICATION_SOUND">silent</field>
                        <value name="MESSAGE">
                          <shadow type="text" id="md_loss_shadow">
                            <field name="TEXT">Loss ❌ — martingale ×${p.martingale} applied</field>
                          </shadow>
                        </value>
                      </block>
                    </next>
                  </block>
                </next>
              </block>
            </statement>
            <next>
              <block type="controls_if" id="md_loss_ctr_check">
                <mutation xmlns="http://www.w3.org/1999/xhtml" else="1"></mutation>
                <value name="IF0">
                  <block type="logic_compare" id="md_loss_ctr_compare">
                    <field name="OP">LTE</field>
                    <value name="A">
                      <block type="variables_get" id="md_get_loss_ctr">
                        <field name="VAR" id="md_loss_ctr_var">lossCounter</field>
                      </block>
                    </value>
                    <value name="B">
                      <block type="variables_get" id="md_get_mart_lvl">
                        <field name="VAR" id="md_mart_lvl_var">MartingaleLevel</field>
                      </block>
                    </value>
                  </block>
                </value>
                <statement name="DO0">
                  <block type="trade_again" id="md_trade_again"></block>
                </statement>
                <statement name="ELSE">
                  <block type="notify" id="md_sl_notify">
                    <field name="NOTIFICATION_TYPE">error</field>
                    <field name="NOTIFICATION_SOUND">error</field>
                    <value name="MESSAGE">
                      <shadow type="text" id="md_sl_shadow">
                        <field name="TEXT">Max losses reached 🛑 — bot stopped</field>
                      </shadow>
                    </value>
                  </block>
                </statement>
              </block>
            </next>
          </block>
        </statement>
      </block>
    </statement>
  </block>
  <block type="before_purchase" id="md_before_purchase" deletable="false" x="0" y="976">
    <statement name="BEFOREPURCHASE_STACK">
      <block type="purchase" id="md_purchase">
        <field name="PURCHASE_LIST">${p.contract}</field>
      </block>
    </statement>
  </block>
</xml>`;
}

export function downloadBotXml(params: EvenOddBotParams): void {
    const xml      = generateEvenOddXml(params);
    const blob     = new Blob([xml], { type: 'application/xml' });
    const url      = URL.createObjectURL(blob);
    const a        = document.createElement('a');
    const sym      = params.symbol.toLowerCase().replace('_', '');
    const dir      = params.direction.toLowerCase();
    a.href         = url;
    a.download     = `signal-${dir}-${sym}-digit${params.entryDigit}.xml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
