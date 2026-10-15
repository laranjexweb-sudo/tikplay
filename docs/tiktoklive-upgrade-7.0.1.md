# Upgrade TikTokLive 6.6.6 → 7.0.1 (backend) — com regressão

Data: 13/10/2026 · Escopo: dependência usada pelo daemon Python (`python/tiktoklive_handler.py`,
`python/sync_gifts.py`) no motor **TikTokLive**. Nenhum código de aplicação foi alterado nesta
etapa (apenas ajuste de um shim de teste, ver abaixo).

## Versões

| Pacote | Antes | Depois |
|---|---|---|
| TikTokLive | 6.6.6 | **7.0.1** |
| TikTokLiveProto | 0.2.0 | **0.2.2** |
| betterproto2 | 0.9.1 | 0.9.1 (inalterado) |
| protobuf | 7.35.1 | 7.35.1 (inalterado) |
| httpx / websockets | 0.28.1 / 16.1.1 | inalterados |

Impacto limitado a 2 pacotes (o `--dry-run` confirmou que o resto já satisfazia as versões).

## Rollback
```powershell
python -m pip install "TikTokLive==6.6.6" "TikTokLiveProto==0.2.0"
```

## Análise de compatibilidade
- **Eventos:** 77 no 7.0.1 vs 76 no 6.6.6. **Nenhuma remoção.** Adicionado só
  `LinkMicBattleItemCardEvent` (PK/link-mic).
- **Imports do projeto seguem válidos:** `from TikTokLive import TikTokLiveClient`,
  `from TikTokLive.client.errors import UserOfflineError`, `from TikTokLive.events import (...)`,
  e `from TikTokLiveProto.v3.webcast.im import BarrageMessageBarrageType` (usado pelo trabalho
  de níveis por badge).
- **`ExtendedUser` (helpers de nível) presentes:** `gifter_level`, `member_level`, `member_rank`,
  `is_moderator`, `is_top_gifter`, `is_friend`.
- **Galeria de presentes:** `TikTokWebClient().fetch_gift_list()` funciona (665 gifts normalizados);
  a rota é atributo de instância (não de classe).
- **`TikTokLiveClient.start(**kwargs)` inalterado:** `process_connect_events`, `fetch_gift_info`,
  `fetch_room_info`, `fetch_live_check`, `room_id`. `gift_info` disponível.

## Plano de teste de regressão (executado)
1. **Imports + schema:** `tiktoklive_handler`, `sync_gifts`, `BarrageMessageBarrageType`, contagem
   de eventos. → OK
2. **Suíte Python** (`unittest discover -s tests`): 45 testes. → **OK**
   - `test_tap_meta.py`: 26/26.
   - `test_gifts_upsert.py`: OK.
   - `test_tiktoklive_levels.py` (níveis por badge): OK.
3. **Pipeline do catálogo (sem escrever derivados):** `sync_gifts.fetch_gift_info()` → 665 gifts
   normalizados. → OK
4. **Daemon + servidor:** reinício com 7.0.1; boot limpo (sem erro), daemon conectado. → OK
5. **Suíte Node** (rotas/DB): `interactions-reports` 63/63, `admin-activity` 55/55,
   `likes-overlay-layout` PASS, `gifts-sync` 15/15. → OK

## Ajuste de teste (shim)
`python/tests/test_corda_service.py` extrai métodos do `GameSession` por AST. Passou a receber
stubs para `_ensure_room`, `_track_levels`, `_emit_interaction` (dependências adicionadas ao fluxo
de interação que o teste de fiação da Corda não cobre). Sem isso, 5 testes quebravam por
`AttributeError` (independente do upgrade, já ocorria antes).

## Observações
- A biblioteca é reverse-engineering (não "production-ready"); eventos variam por região/tipo de
  live. O motor **TikTools** não é afetado por este upgrade.
- Manter o par `TikTokLive`/`TikTokLiveProto` sempre junto nas versões documentadas, pois o schema
  v3 vem do `TikTokLiveProto`.
