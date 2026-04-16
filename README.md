# Hermes ↔ Clawith Integration

Enable [Hermes Agent](https://github.com/hermes-agent/hermes) to communicate with [Clawith](https://github.com/dataelement/Clawith) users via the **Longlink WebSocket** protocol.

Once configured, Hermes appears as an agent in Clawith. Clawith web users can chat with Hermes in real-time — messages flow through a persistent WebSocket connection.

## Architecture

```
Clawith Web UI                    Hermes Gateway
┌──────────────┐                  ┌──────────────────────┐
│   Users      │── gateway.task → │  ClawithAdapter      │
│   (browser)  │←── user_dm  ←── │  (WebSocket client)   │
│              │←── report   ←── │                       │
└──────────────┘                  │  ↕ AI Agent Loop     │
                                  │  (Qwen / Claude / …) │
                                  └──────────────────────┘
```

## Quick Start

### 1. Install Dependencies

```bash
cd ~/.hermes/hermes-agent
source venv/bin/activate
pip install websockets httpx
```

### 2. Copy the Adapter

```bash
cp gateway/platforms/clawith.py ~/.hermes/hermes-agent/gateway/platforms/clawith.py
```

### 3. Register Clawith as a Platform

Add `CLAWITH = "clawith"` to the `Platform` enum in `~/.hermes/hermes-agent/gateway/config.py`:

```python
class Platform(Enum):
    # ... existing platforms ...
    CLAWITH = "clawith"
```

### 4. Register in Platform Metadata

Add Clawith to the shared platform registry in `~/.hermes/hermes-agent/hermes_cli/platforms.py`:

```python
PLATFORMS: OrderedDict[str, PlatformInfo] = OrderedDict([
    # ... existing platforms ...
    ("clawith", PlatformInfo(label="🐾 Clawith", default_toolset="hermes-cli")),
])
```

> **Why this is needed:** Hermes uses this registry to resolve default toolsets and platform labels. Without it, you'll get `KeyError: 'clawith'` when processing messages.

### 5. Configure `config.yaml`

Add to `~/.hermes/config.yaml`:

```yaml
platforms:
  clawith:
    enabled: true
    extra:
      host: "172.17.144.1"         # Clawith server IP
      api_key: "oc-your-key-here"  # OpenClaw gateway key
      longlink_port: 38438         # WebSocket port (default: 38438)
      directory_port: 3008         # HTTP API port (default: 3008)
      user_id: "agent0323"         # Logical agent ID
```

Add toolset mapping:

```yaml
platform_toolsets:
  clawith:
  - hermes-cli
```

### 6. Restart & Verify

```bash
hermes gateway restart
cat ~/.hermes/gateway_state.json | python3 -m json.tool
```

You should see `"clawith": { "state": "connected" }`.

### 7. Chat!

Open Clawith web UI, find the Hermes agent, and send a message.

## Protocol Details

Implements the **Clawith Longlink WebSocket** protocol (`ws://<host>:<port>/ws?apiKey=<key>&userId=<id>`).

### Message Flow
1. Clawith user sends message → Hermes receives `gateway.task`
2. Hermes processes with AI → sends `clawith.user_dm` + `report`
3. Clawith delivers reply to user

### Heartbeat
Sends `{"type":"heartbeat"}` every **10 seconds**. Missing heartbeat → Clawith marks agent offline.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `"offline or unreachable"` | Check logs: `grep clawith ~/.hermes/logs/agent.log`. Verify `pip install websockets httpx` |
| `KeyError: 'clawith'` | Complete Step 3 & 4 (`config.py` + `platforms.py`) |
| `AttributeError: 'closed'` | Fixed in this version. Uses `ws.state == State.OPEN` (websockets 16 compatible) |

## Patches

Apply these to your Hermes installation if you prefer `patch` over manual edits:

```bash
cd ~/.hermes/hermes-agent
patch -p1 < /path/to/patches/01_platform_enum.patch
patch -p1 < /path/to/patches/02_run_gateway.patch
patch -p1 < /path/to/patches/03_platforms_metadata.patch
```

MIT License.
