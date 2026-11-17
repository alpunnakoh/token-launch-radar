# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/alpunnakoh/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/alpunnakoh/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Launch Radar — ranks 226 pre-token DeFi protocols by the implied value of a future token launch, from a sealed DefiLlama snapshot, with a concrete farm plan for each one. The value model (radar-3) fits a comps curve — log10(market cap) on log10(TVL) over 118 live-token protocols, one per ticker — times a shrunk category factor, and it is tested blind: on a blind split it predicts held-out tokens with a median error of 2.91x, against 4.94x for a flat multiple. Every farm plan is netted to the dollar, with a farm / thin / skip verdict from implied value per dollar farmed. Every number on the board follows from the data, not from a hardcoded list of names.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=dwv3hwwm&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
