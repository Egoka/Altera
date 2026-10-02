# Доказательства запусков

Каталог для доказательств планов и стадий: `docs/reports/evidence/<план>/…` пишет
`scripts/agent-loop/gate.py`, формат — [artifact-contracts](../../development/artifact-contracts.md).

## Удалённые архивы

2026-10-02 из дерева убраны архивы первых запусков автономии — 1557 файлов, около 6 МБ:

- `2026-09-13-autonomy/` — кроме пяти файлов, на которые ссылаются действующие документы
  (`t110-review.md`, `task-3-initial-report.md`, `task-3-fix1-report.md`,
  `claude-persistent-auth/auth-status-proof.json`, `claude-persistent-auth/model-auth-proof.json`);
- `2026-09-14-runtime-native/` — целиком.

Ссылки на них из отчётов 13–14.09 ведут в историю Git. Полный архив лежит в коммите `c3c28f2c`:

```bash
git show c3c28f2c:docs/reports/evidence/2026-09-13-autonomy/<путь>
git archive c3c28f2c docs/reports/evidence | tar -x -C /tmp/altera-evidence
```
