# Проверка сохранения служебной policy

План: [native-policy-composition](../plans/2026-09-14-native-policy-composition.md).
Дата: 2026-09-14. Результат: гипотеза дефекта опровергнута, изменений кода нет.

`prepare_native.prepare` до mapper создаёт output directory и копирует туда служебные
файлы. `test_real_codex_prepare_mapper_and_runtime_command_chain` проходит настоящий
prepare → verify → runtime.command и проверяет наличие protocol guard. Этот тест входит
в успешный adapter suite, указанный в отчёте совместимости. Ручной probe с пустой временной
output directory не воспроизводил штатный prepare и не доказывал дефект.
