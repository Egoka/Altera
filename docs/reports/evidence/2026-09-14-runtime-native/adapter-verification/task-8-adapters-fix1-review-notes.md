# Task 8 fix1 — первая часть единого scoped review

Промежуточные замечания для sole writer; это не отдельный gate и не итоговый verdict.
Окончательная оценка ожидает замороженную collector wave и её evidence.

Прочитан один раз cumulative frozen diff `task-8-adapters-fix1.diff`, SHA256
`2c259bccd9d5b1e8b0a029d3ad14ac19947bd51f330a37b4a78a0a6b3a3948ff`.
Прочитаны исходные R1–R8, `task-8-adapters-fix-round1.md` и raw
`task-8-fix-green2.log`: команда, cwd, exit 0, 47 tests / OK сохранены.
Изменяющиеся native_adapter/runtime не читались как frozen; tests, native, model, Docker и
прочие внешние операции reviewer не запускал.

## Состояние исходных findings

- **R1:** actual `--mcp-config` теперь связывается с `/runtime/policy/claude-mcp.json`.
  Реальная synthetic D1 → verifier → runtime.command цепочка присутствует и прошла в raw log.
- **R2:** preparation теперь задаёт `provider-proxy`; обе реальные command-цепочки проходят.
  Полнота production policy связана с оставшимся R3 ниже.
- **R3:** fresh output generation и копирование обязательных файлов реализованы, но pin
  подготовленного policy теряется: run_pending принимает свежий `policy_sha256` verifier поверх
  подготовленного значения без проверки исходного дерева. Изменённый после prepare guard/proxy
  тем самым получает новый разрешённый hash. Нужно проверить подготовленное дерево до mapping,
  затем закрепить только ожидаемый materializer delta. Минимальная regression: изменение guard
  между prepare и invocation отклоняется до launch. Сохранённые integration fixtures имеют
  `export {}` вместо production guard и не проверяют полный proxy policy набор.
- **R4:** проверяются claim, observation, registry относительно cache/tmp/evidence. Не охвачены
  runtime/store manifests, deployment и другая trusted metadata authority, явно названная в
  исходном finding. Нужна такая же canonical overlap admission для этих точных путей;
  regression с manifest под cache должна отказать до claim/launch.
- **R5:** отдельный registry file теперь имеет metadata/size/no-follow/nonblocking admission.
  Но `_write_observation` всё ещё повторно делает unbounded `read_text()` runtime manifest;
  число registry entries не ограничено; malformed candidates с TypeError/OSError молча
  пропускаются. Передавать уже проверенный manifest/run root, ограничить enumeration и закрыть
  malformed-candidate ambiguity. Минимальные regressions: FIFO/oversize, malformed eligible
  ticket рядом с valid, а также запрет повторного открытия manifest при observation.
- **R6:** existing store/generations проверяются до probe/Store constructor; whole-run lock
  сохранён. Нет regression через настоящий Store на adapter lifecycle: позитивные adapter
  lifecycle tests по-прежнему используют EmptyStore. Нужны отсутствующий store без mkdir и
  реальная synthetic published generation с lock, удержанным на время synchronous launcher.
- **R7:** dependency hashes, authorized cwd/source, passport digest и prepared HEAD добавлены.
  Проверка actual gate dirty/lease/actor остаётся ожидаемым collector-owned prelaunch boundary;
  это не требование второй state machine. Итог — после второй части. Отрицательные regressions
  по этим новым adapter admission checks в frozen тестах отсутствуют.
- **R8:** bare help/version и allowlisted environment исправлены. Но stable profile form
  `<deployment> <sha> -- --version` / `--help` проходит обычную registry admission и claim;
  статическая проверка распознаёт только argv ровно из одного элемента. Нужен static branch для
  реального bootstrap form до чтения deployment/environment/registry; regression без deployment
  и без расходования pending ticket. Если trusted bootstrap делает это вне adapter, показать
  именно его frozen implementation и тест.

Root уже обнаружил отдельный свежий D2 prerequisite: frozen Codex verifier принимает заранее
составленный record. Исправление назначено collector wave и повторно не диспетчеризуется здесь.
Synthetic Codex test использует вручную составленный record: это mapper/command evidence, не
доказательство actual per-invocation D2.

Исходные отсутствующие raw 44 logs честно признаны отсутствующими. Новые 47 tests — сохранённое
evidence, но только семь из них adapter tests; оно не подменяет отсутствующие отрицательные
regressions по перечисленным load-bearing checks. История прежнего отрицательного review
сохраняется; эта записка не меняет счёт и не разрешает native acceptance.
