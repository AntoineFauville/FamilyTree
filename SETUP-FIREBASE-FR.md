# Firebase : la suite de la configuration (console en français)

Déjà fait : le projet, l'app web, la connexion Google et le domaine `antoinefauville.github.io`.

## A. Connexion par lien e-mail (sans mot de passe), facultative
Utile pour les éditeurs qui n'ont pas de compte Google. Sinon, passez directement à **B**.

1. Dans le menu de gauche, **Authentication**.
2. Onglet **Méthode de connexion**.
3. Bouton **Ajouter un fournisseur** (sous la liste, où **Google** apparaît déjà).
4. Dans « Fournisseurs natifs », cliquez sur **Adresse e-mail/Mot de passe**.
5. Activez **les deux** interrupteurs :
   - **Adresse e-mail/Mot de passe**
   - **Lien envoyé par e-mail (connexion sans mot de passe)**
6. **Enregistrer**.

## B. La base de données (obligatoire)
1. Dans le menu de gauche, ouvrez **Créer** (ou **Compilation** / **Build**), puis **Firestore Database**.
2. Cliquez sur **Créer une base de données**.
3. Si on vous demande l'édition, gardez **Standard**. L'ID de la base reste **(default)**.
4. **Emplacement** : une région en Europe, par ex. **eur3 (Europe)** ou **europe-west1**. Elle ne peut plus être changée ensuite.
5. Choisissez **Démarrer en mode production**, puis **Créer**.

## C. Les règles de sécurité (obligatoire)
1. Dans Firestore Database, onglet **Règles**.
2. Effacez tout le texte, puis collez tout le contenu du fichier [`firestore.rules`](firestore.rules).
3. Cliquez sur **Publier**.

## D. Vous comme premier admin (obligatoire)
1. Dans Firestore Database, onglet **Données**.
2. **+ Commencer une collection**.
3. **ID de la collection** : `editors`, puis **Suivant**.
4. **ID du document** : votre adresse Google **en minuscules**, celle avec laquelle vous vous connecterez.
5. Ajoutez un champ :
   - **Champ** : `admin`
   - **Type** : `boolean`
   - **Valeur** : `true`
6. **Enregistrer**.

Ensuite, dites à Claude que c'est fait : il vérifie que tout répond correctement.
