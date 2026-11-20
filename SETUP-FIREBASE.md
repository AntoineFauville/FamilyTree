# Online editing with Firebase: one-time setup

With this, editors sign in on the website and press **Save**, and the change is live for everyone.
There are no files to download and no `publish.cmd`.
The family tree stays **encrypted**: Firebase (Google) only stores unreadable text.

The setup takes about 15 minutes, using a Google account.

## 1. Create the project
1. Go to https://console.firebase.google.com and sign in with your Google account.
2. Click **Create a project** (or **Add project**) and name it, e.g. `family-tree`.
3. Turn **Google Analytics off**; it isn't needed. Then click **Create project**.

## 2. Register the website
1. On the project's home page, click the **Web** icon `</>` ("Add app").
2. Nickname: `Family tree website`. Leave "Firebase Hosting" **unticked**, then click **Register app**.
3. Firebase shows a block of code with `const firebaseConfig = { apiKey: ..., authDomain: ..., projectId: ..., ... }`.
   **Copy that block and send it to Claude.** These values aren't secret; they're your project's public address.

## 3. Sign-in
1. In the left menu, open **Build → Authentication** and click **Get started**.
2. **Sign-in method** tab:
   - **Google:** enable it, choose your email as the support email, and **Save**.
   - **Email/Password:** enable it, also enable **Email link (passwordless sign-in)**, and **Save**.
3. **Settings** tab → **Authorized domains** → **Add domain** → `antoinefauville.github.io`.

## 4. Database
1. In the left menu, open **Build → Firestore Database** and click **Create database**.
2. Location: one in Europe, e.g. `eur3 (europe)` or `europe-west1`. This can't be changed later.
3. Choose **Start in production mode**, then **Create**.
4. Open the **Rules** tab, replace everything with the contents of [`firestore.rules`](firestore.rules), and click **Publish**.

## 5. You as the first admin
1. In Firestore, open the **Data** tab and click **Start collection**. Collection ID: `editors`.
2. Document ID: **your email address, in lowercase**, i.e. the Google account you'll sign in with.
3. Add a field: name `admin`, type **boolean**, value **true**. Click **Save**.

After that, you add and remove other editors from inside the app.

## So it outlives you
- In Firebase: **Project settings → Users and permissions → Add member**, give one or two trusted people the **Owner** role.
- In GitHub: **repository Settings → Collaborators**, add the same people.
- In the app, make at least two people **admin** in the editors list.

## Limits of the free plan (Spark)
- Free, and the project isn't paused when nobody uses it.
- Sign-in by **email link**: about 5 emails per day for the whole project. That's enough, because people stay signed in.
  **Google sign-in** has no such limit.
