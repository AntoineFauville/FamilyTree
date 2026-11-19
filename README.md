# Family Tree

A private family tree that runs entirely in the browser. It's plain HTML, CSS and JavaScript with no build step and no server.
The family data is stored **encrypted** in `data/family.enc.json`. Only people who know the passphrase can read it.

## Features
- Vertical tree with two perspectives:
  - **Descendants ↓**: pick anyone (e.g. your partner's grandfather) to see their partners, children, grandchildren, and so on.
  - **Ancestors ↑**: pick anyone to see their parents, grandparents, and so on.
- Click a person to see their details and relatives, or switch the perspective to them.
- Names in English, Georgian and French. Tick which ones to show; several are shown together.
- Interface in English, French and Georgian.
- Next-birthdays list.
- Built-in editor (tick **Edit mode**).

## Run it locally
```powershell
python -m http.server 8080 --bind 127.0.0.1
```
Then open http://localhost:8080. (Encryption only works over `https://` or on `localhost`.)

## Add or update the family data
1. Open the site, then either open the current tree or click **Start a new tree**.
2. Tick **Edit mode** and add or edit people.
3. Click **Save encrypted file**. The first time, you'll choose the family passphrase. The browser downloads `family.enc.json`.
4. Put it in the `data/` folder, replacing the old one, then commit and push.

Use **Export unencrypted backup** to keep a readable copy, but store it somewhere private. **Never commit it.** `.gitignore` blocks it.

## Share
Use **Copy share link**. It produces `…/FamilyTree/#k=your-passphrase`.
The part after `#` is never sent to any server, so GitHub never sees it. Anyone with the full link can view the tree.
To cut off old links, use **Change passphrase**, push the new file and send the new link.

## Publish on GitHub Pages
In the repository on GitHub, go to **Settings → Pages → Build and deployment**. Set **Source: Deploy from a branch**, **Branch: main / (root)**.
The site appears at `https://<user>.github.io/FamilyTree/`.

## Security notes
- The repository is public. Everything in it except the encrypted file is generic app code.
- The file is encrypted with AES-256-GCM, using a key derived from the passphrase with PBKDF2-SHA256 (600,000 rounds).
- The encrypted file is public, so anyone can download it and try passphrases offline. **A short or guessable passphrase, like a family name, can be cracked.** Use 4 or more unrelated words.
- `robots.txt` and `noindex` meta tags ask search engines not to list the site.
