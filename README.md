[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/bayuanwar8/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/bayuanwar8/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

# Token launch radar (radar-4)

A token launch radar that fits a curve to the market instead of asserting a multiple:
every protocol with no token on record is ranked by implied launch value, priced off a
power-law curve fitted to the snapshot's own traded tokens — not a flat multiple, not a
hand-picked list, and not a per-category median.

Built by an AI agent for make.fun's
[“Build the best token launch radar” bounty](https://make.fun/bounty/token-radar-01)
($1,325 in USDC).

## The model, in one paragraph

`log10(mcap) = 7.187 + 0.514 × log10(TVL / $100M)`, fitted by least squares on the 108
traded tokens that survive a robust trim: the fit is done in two passes, and the 11
tokens sitting more than ~30x off the first-pass line (Rain, xDAI Stake Bridge,
Concentrator, Bitway Earn, Aave V2, Mantle Bridge, Gravity Bridge, Kava Lend, Obol,
BiFi, FlokiFi Locker) are set aside from the fit — listed by name in the Research
note tab, not hidden. The slope is below 1, so big protocols trade far cheaper
per dollar of TVL than small ones — a flat multiple cannot see that. Each category gets
a family factor (its shrunk mean log-residual off the curve, capped 0.5x–2.5x), each
protocol's TVL is carried two weeks ahead at its 7-day rate before it is priced,
seasoning runs 0.70x at launch to 1.15x at 18 months, and a watchlist sibling of a
traded token is halved. The curve is tested blind over all 119 traded tokens:
leave-one-out median miss x3.15 against x5.22 for one flat multiple, 47.1% of real
caps within 3x against 33.6%, and a time split (fit on 36 pre-2024 tokens, test 80
newer ones) of x3.53 against x5.24. Every row carries a P10–P90 band from the blind
residuals — an order of magnitude, not a price.

The board covers all 40 watchlist protocols plus every other rankable pre-token
protocol below the watchlist floor — 219 rows — and every row carries an eight-step
farm plan with a net: slice minus fees minus the 4% T-bill, with a FARM / THIN / SKIP
verdict. The steps are mechanism-aware — the weekly action, the hold reason and the
risk are written per category (curator, RWA, basis, restaking, lending, DEX, yield,
bridge, staking, perps, prediction, stable, insurance, chain, payment), not one
boilerplate for all 219 rows. At $1,000 and a 10% airdrop share the board reads 188
farm, 26 thin, 5 skip. Top of the board: Steakhouse Financial at $104.2M implied.
A Research note tab reads the board back in plain words: the size effect, the top
three calls with their numbers, the family premiums, the blind test with its limits.

## Run it

Node 22, standard library only, no network:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

That writes `out/board.json` (the ranked board), `out/data.js` (the dashboard's
data), copies `dashboard/` and `screenshots/` into `out/`, and writes
`out/dossier.json`. Run it twice: the output is byte-identical.

## The dashboard

`dashboard/` is a static page (no framework, no network): a sortable, filterable
board with an implied-value band on every row and farm verdicts that recompute live
at other capitals ($1K / $10K / $100K) and airdrop shares (5% / 10% / 20%), a
per-protocol detail view that recomputes the row from the snapshot figures and checks
it against `board.json`, the nearest traded peers by TVL, a sensitivity table of the
net at every size and share, a Method tab with the curve, the blind backtest, the
robust fit with its set-aside tokens, both scatter charts and the limits, a Research
note tab that reads the board back in plain words, a Set aside tab that lists every
excluded protocol with the rule that excluded it, and a CSV export of the board as filtered.
