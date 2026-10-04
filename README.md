# Ọnà

*Ọnà is Yoruba for art and design.* Circuit art on X Layer.

**On-chain logic you can see.** Every circuit taped out on [TapeOut](https://tapeout.net) is a small program made of NAND gates and stored on X Layer. Ọnà runs that program for every possible input and paints the answers, one cell per input. The same logic always draws the same picture, so a piece can't be faked or changed.

Built for the [TapeOut Genesis Transistor Hackathon](https://ignix.bot/x_campaign) on X Layer.

## What it does

- **Gallery** – reads a TapeOut processor and all of its circuits straight from X Layer and renders each one as an artwork. Paste any processor address to view someone else's circuits as art too.
- **Verify** – asks the processor contract to evaluate sample inputs (`eval`, a free `eth_call`) and checks them against the picture.
- **Studio** – design a circuit by writing up to three bitwise rules over the cell's column (`x0…`) and row (`y0…`) bits. The compiler turns them into a NAND netlist, previews the artwork live and quotes the exact cost.
- **Mint & tape out** – the wallet buys exactly as many NAND transistors as the design uses from the Ọnà processor, then tapes the circuit out. The result is a circuit NFT whose artwork anyone can regenerate.
- **Share** – download a 1080×1080 PNG or post it to X with a link back to the piece.

## How the art is made

1. Read `circuitInfo`, `netlist` and `ownerOf` for the circuit from the processor.
2. Decode the netlist (NAND = `0x00 a b`, LATCH = `0x01 d`, 24-bit signal ids; the last `nOut` elements are the outputs).
3. Split the inputs into column bits and row bits (up to 128×128 cells) and simulate every combination locally.
4. Hash the netlist to pick the style (tiles, dots, weave, pixels) and the palette. Output bits choose the colour of each cell.
5. Circuits with latches carry their state from cell to cell in reading order, so memory shows up as patterns over time.

## Transistor economics

Each artwork burns one NAND transistor per gate. Studio designs use about 10–30 NAND. The buyer pays `NAND × price + mint protocol fee + tape-out fee + gas`. The `NAND × price` part goes to the processor creator. See [LAUNCH.md](LAUNCH.md) for the chosen supply and price.

## Run locally

It's a static site with no build step and no dependencies.

```bash
python3 -m http.server 8000   # then open http://localhost:8000
node test/netlist.test.mjs    # netlist decoder, simulator and compiler tests
```

Set `PROCESSOR` and `SITE_URL` in `config.js` after launching the processor.

## Safety notes

TapeOut's X Layer contracts are new and not independently audited. The app checks that the factory implementation matches the known version before any wallet action, shows every amount before signing, and verifies the taped-out netlist on chain afterwards. Minting and tape-out are separate transactions. If tape-out fails after minting, the transistors stay in the buyer's wallet.

## Credits

Contract selectors, event topics and the X Layer factory address follow the shipped TapeOut client as documented by [CircuitDesk](https://github.com/diveyreadytodive-star/circuitdesk-ignix-tapeout) (MIT). The netlist format matches [TapeSafe](https://github.com/kin684660-commits/TapeSafe) (MIT).

MIT License.
