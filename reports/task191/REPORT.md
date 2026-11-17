# Live MACD verification — read-only

## Outcome

**Live data and alert gate verified in an isolated scanner component test; the
production signed-in route remains blocked by login.**

Public Deriv candle history and updates succeeded on all eight requested markets.
The actual `MatchesSignalBoard` component, using its real subscription adapter,
rendered all eight live charts from the public feed and each chart changed as
more live OHLC updates arrived. Separate gate checks included an all-eight-card
positive MACD fixture. The signed-in app route still cannot be verified here.

## Actual browser result

The local preview at `/#ai_signals` displayed the logged-out landing page after
dismissing startup/social overlays. The layout requires a logged-in client before
rendering the scanner. No broker authorization, fake session, or authentication
bypass was attempted. The browser found zero mounted scanner elements.

Screenshot: `01-ai-signals-login-gate.png` (local evidence, excluded from Git).

## Actual public-feed capture

Captured **2026-11-17 05:21:40–05:23:00 UTC**, using the site's public endpoint:
`wss://api.derivws.com/trading/v1/options/ws/public`.

This was a separate read-only connection, **not** the signed-in site's shared
connection and **not** evidence of card rendering. Eight requests were sent:
`ticks_history`, `style: candles`, `granularity: 60`, `count: 120`,
`end: latest`, `subscribe: 1`.

| Symbol | One-minute history candles | Live OHLC frames | Candle starts observed | Saw 00:03 / 00:02 / 00:01 | Feed errors |
|---|---:|---:|---:|---|---:|
| 1HZ10V | 120 | 80 | 3 | Yes | 0 |
| 1HZ15V | 120 | 79 | 2 | Yes | 0 |
| 1HZ25V | 120 | 79 | 2 | Yes | 0 |
| 1HZ30V | 120 | 79 | 2 | Yes | 0 |
| 1HZ50V | 120 | 79 | 2 | Yes | 0 |
| 1HZ75V | 120 | 79 | 2 | Yes | 0 |
| 1HZ90V | 120 | 79 | 2 | Yes | 0 |
| 1HZ100V | 120 | 80 | 3 | Yes | 0 |

Total: **960 history candles and 634 live OHLC frames**. All markets crossed a
minute boundary; countdowns calculated from `open_time + 60 - epoch` covered
60 through 1. No market-specific public-feed failures occurred. The collector
finished its 80-second duration and closed its own socket.

No authorize, proposal, buy, sell, or other trading requests were sent. No trades
were placed.

## Isolated scanner component with real public feed

Mounted the production `MatchesSignalBoard` React component in its existing
jsdom test environment with a read-only adapter to the live public endpoint.
This exercises the actual candle subscription adapter and UI without changing
the production auth gate or requiring broker authorization.

- Confirmed exactly eight one-minute candle subscription requests, one per
  requested index.
- Confirmed all eight market cards displayed their real MACD charts, reached
  **Live**, and rendered candlesticks from returned history.
- Confirmed subsequent real OHLC updates arrived for every symbol and changed
  each corresponding rendered chart.
- No `TRADE NOW` alert appeared; no natural MACD setup was present during the
  short component run.
- Requests were read-only candle subscriptions plus scoped subscription cleanup;
  no authorize, proposal, buy, or sell requests were sent.

This test uses a separate public connection, not the authenticated site's shared
Deriv connection. It validates actual card rendering and live chart updates, but
does not establish that the signed-in route wires the feed correctly.

The separate legacy `ws.derivws.com/websockets/v3?app_id=1` endpoint returned HTTP
520 on two sandbox handshake attempts. This is not a failure of an individual
market or of the scanner's shared live-feed endpoint. Historical replay uses that
legacy endpoint and was not part of the live scanner verification.

## Automated alert-gate evidence

Command:

```sh
pnpm --filter @workspace/deriv-site exec jest \
  src/pages/ai-signals/__tests__/matches-signal-board.test.tsx \
  src/pages/ai-signals/__tests__/matches-signal-strategy.test.ts \
  src/pages/ai-signals/__tests__/matches-candle-feed.test.ts \
  --runInBand --coverage=false
```

The separate real-feed component check is intentionally opt-in, so the regular
unit suite does not depend on a public network connection:

```sh
MATCHES_LIVE_FEED=1 pnpm --filter @workspace/deriv-site exec jest \
  src/pages/ai-signals/__tests__/matches-signal-public-feed.live.test.tsx \
  src/pages/ai-signals/__tests__/matches-signal-board.test.tsx \
  src/pages/ai-signals/__tests__/matches-signal-strategy.test.ts \
  src/pages/ai-signals/__tests__/matches-candle-feed.test.ts \
  --runInBand --coverage=false
```

Result: **4 suites passed; 21 tests passed**, with the opt-in public-feed
component run enabled.

Added a deterministic component check exercising the actual MACD calculation,
feed adapter, and eight market cards:

- Qualifying MACD history alone cannot trigger alerts.
- Fresh live updates at 00:03 cannot trigger alerts.
- Fresh live updates at 00:02 show all eight alert groups, each for digits 6–9.
- Missing updates transition all eight cards to waiting for live data.
- Fresh updates at 00:01 do not trigger alerts.
- Paused cards do not trigger alerts.
- Scanner requests consist only of candle subscriptions and scoped cleanup.

The controlled gate fixture, actual public-feed component, raw feed capture,
and actual signed-in route are separate forms of evidence and must not be
conflated.

## Remaining limitation

An available signed-in test session is still needed to confirm that the app's
authenticated route attaches the site's shared Deriv connection to all eight
cards. No individual market feed failures were observed on the public endpoint.

Raw capture, analysis, screenshot, and temporary collector scripts are retained
locally beside this report, excluded from Git and deployments.
