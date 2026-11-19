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
3. Click **Access keys** and add one key per family side, e.g. name "Beridze side", key "beridze". Keys need at least 5 characters, and capital letters don't matter.
4. Click **Save encrypted file**. The browser downloads `family.enc.json`.
5. Put it in the `data/` folder, replacing the old one, then commit and push.

Use **Export unencrypted backup** to keep a readable copy, but store it somewhere private. **Never commit it.** `.gitignore` blocks it.

## Share
Each key has its own link, for example `…/FamilyTree/#k=beridze`. Copy it from **Access keys**, or use **Copy share link** for the key you opened the tree with.
Opening the link shows the tree directly, with no typing. The part after `#` is never sent to any server, so GitHub never sees it.
You can also type a key on the start screen.

To cut off one family side, remove its key in **Access keys**, save, and push the new file.
Old versions of the file stay in the git history, so a removed key can still open those old versions.

## Publish on GitHub Pages
In the repository on GitHub, go to **Settings → Pages → Build and deployment**. Set **Source: Deploy from a branch**, **Branch: main / (root)**.
The site appears at `https://<user>.github.io/FamilyTree/`.

## Security notes
- The repository is public. Everything in it except the encrypted file is generic app code.
- The tree is encrypted once with a random AES-256-GCM key. That key is locked separately with each access key, using PBKDF2-SHA256 (600,000 rounds).
- Key names ("Beridze side") are stored inside the encrypted data, so the public file doesn't reveal them.
- **Short keys, like family names, only keep out strangers who stumble on the repository.** Anyone who knows the family, or who downloads the file and tries common names, can open it. Use longer keys if that matters more than convenience.
- `robots.txt` and `noindex` meta tags ask search engines not to list the site.
