# Memory nebula · 记忆星图

**English** | [中文](README.zh-CN.md)

Cross-device long-term memory for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It ships as two packages: a **main device** that produces memories and configuration, and a **server** that joins and follows. Memories live in your own **private** GitHub repository and travel over git; this public repository contains only the plugin and installers, never personal data.

- Fuzzy recall injected on demand — the whole store never enters the context;
- Four tiers: core / important / normal / faded; important memories never fade;
- Gradual compression and forgetting at 100 / 200 / 300 / 600 days by default (editable in the panel);
- Star-map visualization, memory manager, injection preview, cross-device sync;
- Portable settings (budgets, decay, sync rhythm) converge automatically across devices.

## Install the two packages

Main device (install first):

```powershell
New-Item -ItemType Directory C:\dsh\main -Force | Out-Null
gh release download v0.2.0 -R raging007/memory-nebula-kit -p 'memory-nebula-main-device.zip' -D C:\dsh --clobber
Expand-Archive C:\dsh\memory-nebula-main-device.zip C:\dsh\main -Force
gh repo create dsh-memory-data --private --add-readme
powershell -NoProfile -ExecutionPolicy Bypass -File C:\dsh\main\bootstrap.ps1 -Role main -DataRepo https://github.com/<your-account>/dsh-memory-data.git
```

Server (install later; `-DataRepo` is the private repository the main device created):

```powershell
New-Item -ItemType Directory C:\dsh\server -Force | Out-Null
gh release download v0.2.0 -R raging007/memory-nebula-kit -p 'memory-nebula-server.zip' -D C:\dsh --clobber
Expand-Archive C:\dsh\memory-nebula-server.zip C:\dsh\server -Force
powershell -NoProfile -ExecutionPolicy Bypass -File C:\dsh\server\bootstrap.ps1 -Role server -DataRepo https://github.com/<your-account>/dsh-memory-data.git
```

Each script prints a JSON line. When `ok:true`, hand the `pluginDir` to the agent in your DSH session:

> Install the local bundle at `C:\dsh\plugins\memory-nebula` with plugin_manager's install_bundle, then tell me whether fiberPhase is active.

Then follow the package's `INSTALL.md` to configure sync (one time). Without `gh`, download the zips from the Releases page and expand them manually; the rest is identical.

## How it works

```
main DSH ── plugin ── local memory store ──┐
                                          ├─ private data repo dsh-memory-data (git)
server DSH ─ plugin ── local memory store ─┘
```

- Every device keeps its memories in `DSH_HOME/memory-nebula/memories.json`;
- On sync each device writes its own snapshot into the data repo and runs `pull → merge → commit → push`;
- Merge is per record (`rev`), deletions travel as tombstones, and no always-on server is required;
- Portable settings travel through `config/desired.json`; the newer version wins and the receiver applies it without republishing, so devices converge instead of rewriting each other;
- `folder`, peer URLs, sync tokens, and the enable switches stay device-local and are never synced.

## Using it

After installing and configuring sync, refresh the page (Ctrl+R) and click **记忆星图** in the left rail:

| Tab | What it does |
| --- | --- |
| Star map | Nodes arranged by tier; core glows, faded dims; wheel to zoom, drag to pan, click for details |
| Memories | Search, filter by tier, add, edit, pin as core, forget |
| Devices | Sync folder, peer URL, git auto-sync, share package, sync config, sync now |
| Injection | Tune budgets and decay, preview exactly what the next turn will inject and roughly how many tokens |

The model gets five tools: `memory_save`, `memory_search`, `memory_get`, `memory_update`, `memory_forget`. You can simply say "remember that…", "answer with the conclusion first from now on", or "forget the note about X".

**Tiers and decay**: core (pinned) and important (importance ≥ 0.82, or promoted after repeated use) never decay; normal memories are compressed at 100 days, compressed again at 200, reduced to key points at 300, and purged after another 600. Retrieval, reads and injections refresh the "last used" clock.

Details: [docs/usage.md](docs/usage.md).

## Requirements

- DSH desktop **0.2.x** (Windows or macOS; examples use PowerShell);
- `git`; for private repositories `gh` logged in (`gh auth login` + `gh auth setup-git`);
- The main device and the server must be signed in to the **same DeepSeek account**;
- Keep the data repository **private** — it stores plaintext memories.

## Privacy

- This repository contains no one's memories, account IDs, tokens, or machine paths;
- Each user creates their own data repository and controls its access;
- The plugin never stores a GitHub token; git credentials stay in the system credential helper (`gh`);
- Uninstalling the plugin does not delete local memories; deleting the data repository is what removes them.

MIT License — see [LICENSE](LICENSE).
