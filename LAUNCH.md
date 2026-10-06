# Launch checklist (deadline: Oct 9, 12:00 HKT)

You sign every transaction yourself. Never share your seed phrase or private key with anyone, including me.

## 1. Put the site online
1. Create an empty **public** GitHub repo called `ona`. Tell Claude when it exists so the code can be pushed.
2. In the repo: Settings → Pages → Source: *Deploy from a branch* → `main` / root → Save.
3. The site will be at `https://mhiah.github.io/ona/`.

## 2. Get OKB on X Layer
You need about **0.02 OKB** on X Layer mainnet: about 0.0066 deploy fee, a few artworks at about 0.004 each, plus gas. Withdraw OKB from OKX straight to X Layer, or use OKX Wallet.

## 3. Launch the processor
1. Open the site in OKX Wallet's browser (or desktop with OKX Wallet or MetaMask).
2. Go to **How it works → Processor owner: launch a processor**.
3. Suggested terms (permanent once launched):
   - Name `Ọnà`, symbol `ONA`
   - Supply **1,000,000** transistors
   - Price **0.0001 OKB** per transistor. A typical artwork uses about 18 NAND, so you earn about 0.0018 OKB per piece. The buyer pays about 0.004 OKB in total including TapeOut fees (fees at the time of checking; the app shows live amounts).
4. Click **Launch processor** and approve in your wallet. Copy the processor address it shows.
5. Send the address to Claude. It goes into `config.js` as `PROCESSOR`, then gets pushed.

## 4. Tape out the first artworks
1. Open **Studio**, pick a preset (Sierpinski looks great), give it a title, and press **Mint & tape out**.
2. Approve the mint, then approve the tape-out. Make 2–3 pieces so the gallery isn't empty.
3. Open each piece, press **Verify on X Layer**, and take screenshots.

## 5. Demo and submit
1. Record a 60-second screen video: gallery → open a piece → verify → studio → mint → new piece appears.
2. Post on X using the text in SUBMISSION.md, with the video.
3. Fill the form at https://docs.google.com/forms/d/e/1FAIpQLSd7USjG6LUNNRxwFWY4YEuSY0V0xv8VZNCl6z_-lGSl96vWZA/viewform using SUBMISSION.md.
