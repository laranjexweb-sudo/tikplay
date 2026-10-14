# Monitor de Servidor — Contrato da API (backend)

Referência para o **agente de front-end** do painel Super Admin. Descreve os endpoints,
payloads, limiares, comportamento de incidentes/silêncios, fluxo do ticket SSE e regras de
interface. **Toda a UI (HTML/CSS/JS, modo tela cheia/wallboard) é responsabilidade do front.**

- **Implementação:** `node/routes/monitor.js` (registrado em `node/server.js`).
- **Núcleo/coleta:** `node/lib/monitor.js`, `node/lib/metrics.js`, `node/lib/monitor-sse.js`.
- **Persistência:** `node/db.js` (`monitor_incidents`, `monitor_silences`).
- **Base:** mesma origem do painel (ex.: `http://localhost:3100`).

## 1. Modelo de atualização (híbrido)

- **Polling REST** para métricas pesadas (cpu/ram/disco/sessões/latência/gráficos): **15s**
  (disco e séries: 30–60s).
- **SSE** (`/api/admin/monitor/events`) **somente** para eventos importantes: alerta novo,
  escalonamento, incidente aberto/resolvido e mudança de status de serviço.
- O front deve manter o polling mesmo com SSE ativo; se o SSE cair, o monitor continua
  funcionando. Perda de SSE **não** significa queda do sistema monitorado. Reconectar
  automaticamente (`retry: 5000` já é enviado pelo servidor).

Sequência recomendada ao abrir a página:
1. `GET /api/admin/monitor/snapshot`
2. `GET /api/admin/monitor/series?window=60&bucket=60`
3. `POST /api/admin/monitor/events-ticket` → abrir SSE com o ticket
4. Iniciar polling do snapshot a cada 15s

## 2. Autenticação

- REST: `Authorization: Bearer <jwt>` + papel **admin** (`requireAdmin`). `401` sem token,
  `403` autenticado sem papel.
- SSE: `EventSource` **não envia headers** → usa **ticket de uso único** (ver §6). O endpoint
  de eventos não aceita Bearer.

## 3. Endpoints REST (admin)

### `GET /api/admin/monitor/snapshot`
```json
{ "success": true, "snapshot": {
  "generated_at": "2026-10-14T02:48:00.000Z",
  "environment": "production",
  "overall": { "status": "healthy", "label": "Saudável" },
  "host": {
    "hostname": "vps-br-20025", "platform": "linux", "node_version": "v22.23.2",
    "uptime_s": 302400, "loadavg": [0.4,0.5,0.6], "cores": 4,
    "cpu_pct": 21,
    "ram": { "total": 0, "used": 0, "free": 0, "pct": 58 },
    "disk": { "total": 0, "used": 0, "free": 0, "pct": 62, "path": "..." },
    "sampled_at": 1760000000000
  },
  "nodes": [ { "id": "vps-br-20025", "role": "app", "status": "healthy",
               "cpu_pct": 21, "ram_pct": 58, "disk_pct": 62, "network": "unknown", "uptime_s": 302400 } ],
  "services": [ { "id": "api", "name": "API Principal", "status": "healthy", "metrics": {...}, "note": null } ],
  "websocket": { "clients_total": 302, "panels": 126, "overlays": 176, "events_per_min": 1248 },
  "database": { "status": "healthy", "size_bytes": 0, "wal_bytes": 0, "shm_bytes": 0,
                "read_latency_ms": 12, "rows": { "users": 0, "games": 0, "log_entries": 0 } },
  "platform": { "streamers_online": 126, "lives_connected": 84, "reconnecting": 0, "games_active": 53,
                "open_tickets": 7, "new_users_today": 19, "users_total": 0, "users_active": 0,
                "games_today": 0, "plans": { "free": 0, "pro_mensal": 0 } },
  "latency": { "window_min": 15, "count": 0, "avg": 182, "p50": 150, "p95": 410, "p99": 620 },
  "rates": { "window_min": 5, "requests": 0, "errors": 0, "ws_events": 0, "requests_per_min": 0, "errors_per_min": 0, "error_rate": 0.008 },
  "alerts": [ { "key": "host.ram_high", "severity": "warning", "title": "RAM alta", "detail": "86%", "source": "host" } ],
  "silenced_alerts": 0,
  "incidents": { "active": 1, "items": [ { "id": 3, "key": "...", "severity": "...", "status": "open", "first_seen": 0, "last_seen": 0, "ack_by": null, "ack_at": null, "resolved_at": null } ] },
  "degraded_sections": []
} }
```
- **`degraded_sections`**: seções que falharam ao coletar (ex.: `["database"]`). O snapshot
  **sempre responde** — falha de uma métrica não derruba o endpoint.
- **`alerts`** contém apenas alertas **visíveis** (silenciados são excluídos; `silenced_alerts`
  traz a contagem).
- `host.cpu_pct` pode ser `null` no primeiro ~1 min (precisa de 2 amostras); `loadavg` é
  `[0,0,0]` no Windows (produção é Linux).

### `GET /api/admin/monitor/series?window=60&bucket=60`
- `window` em minutos (1–180), `bucket` em segundos (60–3600). Default `60/60`.
- **Buckets vazios voltam como zero de forma previsível**, mesmo sem 1h de histórico.
```json
{ "success": true, "window_min": 60, "bucket_sec": 60,
  "points": [ { "t": 1760000000000, "bucket_sec": 60, "cpu": 21, "ram": 58, "disk": 62,
                "requests": 100, "errors": 0, "ws_events": 1248, "latency_avg": 182, "latency_p95": 410 } ] }
```
> `cpu/ram/disk` usam a última amostra do bucket (podem ser `null`). `latency_*` são `null`
> quando não há requisições no bucket.

### `GET /api/admin/monitor/widget`
Resumo para o widget do dashboard:
```json
{ "success": true, "overall": { "status": "healthy", "label": "Saudável" },
  "services": { "total": 7, "ok": 7, "issues": 0, "by_status": { "healthy": 7, "warning": 0, "degraded": 0, "down": 0, "unknown": 0 } },
  "latency": { "avg_ms": 182, "p95_ms": 410, "window_min": 15 },
  "errors_5min": 14, "error_rate": 0.008, "streamers_online": 126, "sessions": 418,
  "cpu_pct": 21, "ram_pct": 58, "disk_pct": 62, "db_status": "healthy" }
```

### `GET /api/admin/monitor/thresholds`
```json
{ "success": true, "error_rate_window_min": 5,
  "thresholds": { "cpu_pct": {"warn":85,"crit":95}, "ram_pct": {"warn":85,"crit":95},
                  "disk_pct": {"warn":80,"crit":90}, "api_p95_ms": {"warn":400,"crit":800},
                  "error_rate": {"warn":0.01,"crit":0.05}, "db_read_ms": {"warn":100,"crit":500} } }
```

### `GET /api/admin/monitor/incidents?status=open|all|open|acknowledged|resolved&limit=`
`{ success, items: [incidente], active }` — use `status=open` para "abertos + reconhecidos".

### `POST /api/admin/monitor/incidents/:id/ack`
`{ success, incident }` (`status: "acknowledged"`, grava `ack_by`/`ack_at`). `404` se não
existir ou já estiver reconhecido/resolvido.

### `POST /api/admin/monitor/incidents/:id/resolve`
`{ success, incident }` (`status: "resolved"`, grava `resolved_at`). `404` se não existir/já resolvido.

### `GET /api/admin/monitor/silences?all=1`
`{ success, silences: [ { key, until, created_by, created_at } ] }` (por padrão só ativos).

### `POST /api/admin/monitor/silences`
Body `{ "key": "host.ram_high", "minutes": 30 }` (1–10080). Resposta `201 { success, silence }`.

### `DELETE /api/admin/monitor/silences/:key`
`{ success: true }` ou `404`.

## 4. Enums e status

- `overall.status` / `service.status`: `healthy | attention | degraded | down | unknown`.
- **Rótulos**: healthy=Saudável · attention=Atenção · degraded=Degradação · down=Indisponível ·
  unknown=Indeterminado.
- **Incidente** `severity`: `warning | critical`; `status`: `open | acknowledged | resolved`.
- Cores sugeridas: verde=healthy · amarelo=attention/warning · laranja=degraded ·
  vermelho=critical/down · cinza=unknown.

## 5. Comportamento de incidentes e silêncios

- **Sem duplicatas**: no máximo **um** incidente ativo (`open`/`acknowledged`) por `key`. Se a
  condição persistir, o incidente existente é **atualizado** (`last_seen`, `detail`,
  `severity`) — nunca cria outro.
- **Resolução automática**: quando a condição desaparece, o motor resolve o incidente, **mesmo
  que esteja `acknowledged`** (reconhecer = marcar como lido, não trava a resolução).
- **Escalonamento**: mudança de `warning → critical` emite novo evento de alerta.
- **Silêncio**: suprime **novo alerta/evento visível**; o incidente continua sendo registrado
  (histórico) e aparece em `/incidents`. Silêncios **não apagam** histórico já persistido e
  expiram sozinhos (`until`).
- **Ciclo do motor**: ~20s. Eventos SSE por transição: `incident` (opened/resolved) e `alert`
  (novo/escalado).

## 6. Fluxo do ticket SSE (single-use)

1. Front (com Bearer) chama `POST /api/admin/monitor/events-ticket` → `{ ticket, expires_in_ms: 60000 }`.
2. Front abre `new EventSource('/api/admin/monitor/events?ticket=<ticket>')`.
3. O servidor valida (curto prazo), **invalida o ticket na primeira conexão** (uso único) e
   inicia o stream. Reuso → `401`.
4. Se o stream cair, o front obtém **novo ticket** e reconecta; o polling segue normal.

```js
// front
const { ticket } = await (await fetch('/api/admin/monitor/events-ticket',
  { method: 'POST', headers: { Authorization: 'Bearer ' + token } })).json();
const es = new EventSource(`/api/admin/monitor/events?ticket=${encodeURIComponent(ticket)}`);
es.addEventListener('alert', (ev) => { const d = JSON.parse(ev.data); /* ... */ });
es.addEventListener('incident', (ev) => { /* ... */ });
es.addEventListener('service_status', (ev) => { /* ... */ });
es.onerror = () => { /* mostrar "tempo real desconectado"; tentar novo ticket */ };
```

### Eventos SSE
```
event: hello
data: {"connected_at":1760000000000,"admin_id":1}

event: alert
data: {"level":"critical","key":"api.latency_high","title":"Latência da API alta","detail":"p95 900ms","source":"api","since":1760000000000}

event: incident
data: {"action":"opened","incident":{...}}   // action: opened | resolved

event: service_status
data: {"service":"daemon","name":"Daemon Python","status":"down","previous":"healthy"}
```
Heartbeat: `: ping <ts>` a cada 25s. Headers enviados: `Content-Type: text/event-stream`,
`Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no`.

## 7. Limiares efetivos (fase 1)

| Métrica | Aviso | Crítico | Fonte |
|---|---:|---:|---|
| CPU | 85% | 95% | host |
| RAM | 85% | 95% | host |
| Disco | 80% | 90% | host |
| Latência API (p95) | 400ms | 800ms | api |
| Taxa de erro (5 min) | 1% | 5% | api (respostas 5xx) |
| Leitura DB | 100ms | 500ms | db |
| Daemon Python ausente | — | imediato | daemon |
| Banco indisponível | — | imediato | db |

`error_rate = erros(5xx) / requisições` na janela de **5 min**.
Percentis `p50/p95/p99` são calculados na janela **documentada de 15 min** (configurável em
`metrics.getLatency(windowMin)`).

## 8. Notas de medição (importante para interpretar)

- **1 nó**: a VPS sob PM2 (`role: "app"`). Multi-nó é fase futura.
- **"Conexões" do SQLite**: o driver é **uma única conexão** síncrona; reportamos latência de
  leitura + tamanhos + linhas, não "nº de conexões".
- **`events_per_min` de WS**: entregas de mensagens por cliente na janela de 5 min.
- **Rede**: `network: "unknown"` nesta fase (sem `/proc/net/dev`).
- **Fila/Jobs, licenças/trials**: não existem como serviço; "Conexão TikTok" é um agregado das
  lives e planos vêm de `users.plan`.
- **`process_errors`**: incrementado por linhas de stderr do daemon Python.

## 9. Pontos que o agente de front precisa respeitar

1. **Não** crie endpoints próprios; use os acima.
2. Mantenha **polling + SSE**; nunca dependa só do SSE. Ao cair, exiba discretamente
   "tempo real desconectado" e reconecte com novo ticket.
3. **Ticket** é de uso único e 60s; sempre busque um novo para cada `EventSource`.
4. Nunca coloque o JWT na URL; use Bearer nas rotas REST e o ticket para o SSE.
5. Renderize os **enums/limiares** a partir de `GET /api/admin/monitor/thresholds`.
6. Trate `null` (cpu no 1º minuto, buckets sem amostra) e `degraded_sections` na UI.
7. Timestamps são **epoch ms** (incidentes) e **ISO** (`generated_at`).
8. **Rotas amigáveis** (`/superadmin/monitor`) **não** foram adicionadas em `FRIENDLY_PAGES`
   (é edição de `server.js`, do backend). Enquanto o HTML não existir, use o caminho do arquivo
   estático; peça ao backend para registrar a rota amigável quando a página existir.

## 10. Como validar manualmente

```powershell
# em jogo-contexto/node
npm install
npm start        # http://localhost:3100
```

1. `node tests/monitor.test.js` → 49 verificações (funções puras, métricas, persistência, snapshot).
2. Logado como admin: `GET /api/admin/monitor/snapshot` (200), `/series`, `/widget`, `/thresholds`.
3. `POST /api/admin/monitor/events-ticket` → abrir `EventSource` com o ticket; reabrir com o
   mesmo ticket → 401.
4. Provocar uma condição (ex.: muitas respostas 5xx) e aguardar o motor (~20s): incidente
   aparece em `/incidents` e evento SSE `alert`/`incident`.
5. `POST .../incidents/:id/ack` e depois deixar a condição sumir → resolve automaticamente.
6. `POST /api/admin/monitor/silences {key, minutes}` → alerta deixa de aparecer em `alerts`
   (mas o incidente segue no histórico).

Teste automatizado de integração (roteiro de referência): 28 verificações cobrindo auth,
snapshot/series/widget/thresholds, incidentes, silêncios, ticket single-use, headers SSE e
transições do motor.

## 11. Dependências

Nenhuma nova dependência: usa `os`, `fs` (statfs), `http`/`crypto` nativos + `express` já
presente. `package.json` **não** foi alterado.
