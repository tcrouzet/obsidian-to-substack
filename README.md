# To Substack

Publish Obsidian notes on Substack.

Version initiale : `0.0.1`. Le plugin dispose de sa structure de développement et de publication ; l'envoi vers Substack reste à développer.

## Développement

Prérequis : Node.js `26.12.0` et npm, comme dans le workflow de publication.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm run lint
npm run build
```

`npm run dev` reconstruit automatiquement `main.js` pendant le développement. Le code source se trouve dans `plugin/`, les scripts dans `scripts/`. Obsidian charge `main.js`, `manifest.json` et `styles.css` depuis ce dossier de plugin.

## Publication

Depuis la branche `main`, avec GitHub CLI (`gh`) authentifié et `jq` installé :

```sh
bash release.sh
```

Le script vérifie le plugin, commite et pousse les changements, puis crée et pousse le tag. La première publication utilise `0.0.1` ; les suivantes incrémentent le patch. Cette commande publie sur GitHub ; son exécution contre GitHub n'a pas été vérifiée.

Le workflow `.github/workflows/release.yml` construit les fichiers du tag, atteste leur provenance et publie `main.js`, `manifest.json` et `styles.css` dans une release GitHub. `manifest.json`, `package.json`, `package-lock.json` et `versions.json` restent synchronisés.

`git.sh` est le raccourci de synchronisation du modèle : il commite tous les changements et les pousse sur `main`, sans créer de release. Son exécution contre GitHub n'a pas été vérifiée.
