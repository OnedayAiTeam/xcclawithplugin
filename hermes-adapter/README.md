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
cp hermes-adapter/gateway/platforms/clawith.py \
   ~/.hermes/hermes-agent/gateway/platforms/clawith.py
```

### 3. Register Clawith as a Platform

Add `CLAWITH = "clawith"` to the `Platform` enum in `gateway/config.py`:

```python
# ~/.hermes/hermes-agent/gateway/config.py
class Platform(Enum):
    # ... existing platforms ...
    CLAWITH = "clawith"
```

### 4. Register in Platform Metadata

Add Clawith to the shared platform registry in `hermes_cli/platforms.py`:

```python
# ~/.hermes/hermes-agent/hermes_cli/platforms.py
PLATFORMS: OrderedDict[str, PlatformInfo] = OrderedDict([
    # ... existing platforms ...
    ("clawith", PlatformInfo(label="🐾 Clawith", default_toolset="hermes-cli")),
])
```

> **Why this is needed:** Hermes uses this registry to resolve default toolsets and platform labels for all channels. Without it, you'll get a `KeyError: 'clawith'` when the agent processes a message.

### 5. Configure `config.yaml`

Add the Clawith platform config to `~/.hermes/config.yaml`:

```yaml
platforms:
  clawith:
    enabled: true
    extra:
      host: "172.17.144.1"         # Clawith server IP or hostname
      api_key: "oc-your-key-here"  # Your OpenClaw gateway key (oc-... prefix)
      longlink_port: 38438         # WebSocket port (default: 38438)
      directory_port: 3008         # HTTP API port (default: 3008)
      user_id: "agent0323"         # Logical agent ID (default: agent0323)
```

Also add the toolset mapping (so Hermes knows which tools to expose):

```yaml
platform_toolsets:
  clawith:
  - hermes-cli
```

### 6. Restart the Gateway

```bash
hermes gateway restart
```

Check the connection:

```bash
cat ~/.hermes/gateway_state.json | python3 -m json.tool
```

You should see:
```json
{
    "platforms": {
        "dingtalk": { "state": "connected" },
        "clawith": { "state": "connected" }
    }
}
```

### 7. Chat!

Open Clawith web UI, find the Hermes agent, and send a message. Hermes will receive and reply in real-time.

## Protocol Details

This adapter implements the **Clawith Longlink WebSocket** protocol (same protocol used by the `xcclawithplugin` for OpenClaw).

### Connection

```
ws://<host>:<longlink_port>/ws?apiKey=<key>&userId=<user_id>
```

### Inbound Frames (Clawith → Hermes)

| Type | Description |
|------|-------------|
| `session.ready` | Handshake confirmation |
| `event` + `source: gateway.task` | Incoming user message (requires `report`) |
| `event` + `source: clawith.user_dm_ok` | Outbound message delivery confirmed |
| `event` + `source: clawith.user_dm_failed` | Outbound message delivery failed |
| `ping` | Server ping — reply with `pong` |
| `heartbeat` | Server heartbeat |

### Outbound Frames (Hermes → Clawith)

| Type | Description |
|------|-------------|
| `clawith.user_dm` | Send message to a Clawith user |
| `report` | Close a `gateway.task` (mark as processed) |
| `heartbeat` | Client keepalive (every 10s) |
| `pong` | Reply to server `ping` |

### Heartbeat

The adapter sends a `{"type":"heartbeat"}` frame every **10 seconds**. If no heartbeat is received, Clawith marks the agent as **offline**.

### Message Flow

```
1. Clawith user sends "Hello"
2. Hermes receives: {"type":"event", "id":"<uuid>", "payload":{"source":"gateway.task", "message":{...}}}
3. Hermes processes the message with AI
4. Hermes sends: {"type":"clawith.user_dm", "target_user_id":"<uid>", "content":"AI reply", "conversation_id":"<cid>"}
5. Hermes sends: {"type":"report", "message_id":"<uuid>", "result":"AI reply"}
6. Clawith delivers the reply to the user's browser
```

## Troubleshooting

### "offline or unreachable" in Clawith

1. Check gateway status:
   ```bash
   cat ~/.hermes/gateway_state.json | python3 -m json.tool
   ```
2. Check logs:
   ```bash
   grep -i clawith ~/.hermes/logs/agent.log | tail -20
   ```
3. Verify WebSocket connectivity:
   ```bash
   python3 -c "
   import asyncio, websockets
   async def test():
       url = 'ws://HOST:38438/ws?apiKey=KEY&userId=agent0323'
       async with websockets.connect(url) as ws:
           msg = await ws.recv()
           print(msg)
   asyncio.run(test())
   "
   ```
4. Ensure `websockets >= 14` is installed (v16 confirmed working).

### `KeyError: 'clawith'`

Missing platform registration. Make sure you completed **Step 3** and **Step 4** above — both `gateway/config.py` AND `hermes_cli/platforms.py` need the `clawith` entry.

### Heartbeat errors (`'ClientConnection' object has no attribute 'closed'`)

The adapter is compatible with **websockets 14–16**. The `_is_ws_open()` helper uses `ws.state == State.OPEN` (websockets 16+) with fallback to `ws.closed` for older versions.

## License

MIT
