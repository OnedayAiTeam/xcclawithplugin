"""
Hermes Clawith Longlink Platform Adapter

This adapter enables Hermes to communicate with Clawith platform users
via the Longlink WebSocket protocol.

## Quick Start

1. Copy `gateway/platforms/clawith.py` into your Hermes installation:
   ```bash
   cp hermes-adapter/gateway/platforms/clawith.py ~/.hermes/hermes-agent/gateway/platforms/
   ```

2. Add `CLAWITH = "clawith"` to the Platform enum in `~/.hermes/hermes-agent/gateway/config.py`:
   ```python
   class Platform(Enum):
       # ... existing platforms ...
       CLAWITH = "clawith"
   ```

3. Install dependencies:
   ```bash
   pip install websockets httpx
   ```

4. Configure in `~/.hermes/config.yaml`:
   ```yaml
   platforms:
     clawith:
       enabled: true
       extra:
         host: "172.17.144.1"
         api_key: "oc-your-api-key"
         longlink_port: 38438      # optional
         directory_port: 3008     # optional
         user_id: "agent0323"     # optional
   ```

5. Restart the Hermes gateway.

## Protocol

The adapter implements the Clawith Longlink WebSocket protocol:

- **Connection**: `ws://<host>:<port>/ws?apiKey=<key>&userId=agent0323`
- **Heartbeat**: Sends `{"type":"heartbeat"}` every 10 seconds
- **Ping/Pong**: Responds to server `ping` with `pong`
- **Inbound**: Receives `gateway.task` events for user messages
- **Outbound**: Sends `clawith.user_dm` for replies, `report` to close tasks
- **Directory**: HTTP API at `/api/gateway/directory` for user lookup

## Architecture

```
Clawith Platform          Hermes Gateway
┌──────────────┐          ┌──────────────┐
│   Web UI     │          │              │
│   Users      │──task──→ │ ClawithAdapter│
│              │←──user_dm│  (WebSocket)  │
│              │←──report │              │
└──────────────┘          └──────┬───────┘
                                 │
                          ┌──────▼───────┐
                          │  Hermes AI   │
                          │   Agent      │
                          └──────────────┘
```

## Features

- Auto-reconnection with exponential backoff
- Message deduplication
- Conversation tracking (user_id ↔ conversation_id mapping)
- Directory API integration for user search
- Heartbeat keepalive (10s interval)
- Ping/pong handling
