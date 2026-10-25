# Kanso plugins

The plugin directory for [Kanso](https://github.com/iamngoni/kanso), the
Markdown notes app. Settings › Plugins › Browse lists what is published
here, and Kanso installs a plugin only when this directory's signed index
lists its exact bytes.

How plugins work, what they can and can't reach, and the API are in Kanso's
[docs/PLUGINS.md](https://github.com/iamngoni/kanso/blob/master/docs/PLUGINS.md).

## What is here

| Path | What it is |
|---|---|
| `plugins/<id>/source/` | The plugin as its author wrote it: `manifest.json` and its files, at the version being published |
| `plugins/<id>/author-signature.txt` | The author's signature over the packed bundle's SHA-256, from `kanso-plugin sign` |
| `revocations.json` | Versions withdrawn from every Kanso: `[{ "id", "versions", "reason" }]` |
| `directory/` | What Kanso fetches, published by CI: `index.json`, `index.json.sig` and `bundles/<id>/<version>.kansoplugin` |
| `kanso-commit.txt` | The Kanso commit whose `kanso-plugin` builds and checks the directory |

Kanso fetches only from
`raw.githubusercontent.com/iamngoni/kanso-plugins/`, over HTTPS, and
checks `index.json.sig` against the directory key compiled into it before it
reads the index.

## Publishing a plugin

1. Make a signing key once, and keep its secret to yourself:
   `kanso-plugin keygen --secret-out author.key`. Put the printed
   `ed25519:` key in your manifest's `publisher.key`.
2. Pack and sign the folder:
   ```
   kanso-plugin pack my-plugin -o my-plugin.kansoplugin
   KANSO_PLUGIN_AUTHOR_KEY="$(cat author.key)" kanso-plugin sign my-plugin.kansoplugin > author-signature.txt
   ```
3. Open a pull request that adds `plugins/<id>/source/` (the folder) and
   `plugins/<id>/author-signature.txt`. CI packs it the same way and checks
   everything Kanso would.

Once a version is published it never changes: a fix is a new version,
signed with the same key. A different key is refused here; in Kanso it
would show in red as a key change.

## How the directory is published

`Validate plugins` runs on every push and pull request. It builds the
pinned `kanso-plugin` and runs `build-directory`: each plugin is packed
deterministically, its manifest is held to Kanso's rules, and its author's
signature is checked. A published version can't change, and a new one must
be newer.

After a push to main, `Publish the directory` builds the next `directory/`
from main's published one with nothing secret around. It then signs
`index.json` in the protected `directory` environment, which needs a
reviewer and holds the directory key as `KANSO_PLUGIN_REGISTRY_KEY`, and
checks the result with `verify-directory`. A separate job commits it. Each
publication raises the index's serial, and Kanso refuses an index older
than one it has seen.

To withdraw a version, add it to `revocations.json`. Kanso turns it off at
its next check.
