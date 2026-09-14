# Task 9 legacy passport — scoped review

**Spec: PASS. Quality: PASS — только исправление отсутствующего legacy `slot.input`.**
Новых actionable defects в этом delta не найдено.

Проверен frozen collector SHA256
`6a9b8b2b9bd5598e32ff81506c9508727adc0e3eab274841e9449b777b681958`.
Все девять source pins совпали с обновлённым `task-9-frozen-modules.json`; runtime и adapters
сохраняют прежние reviewed bytes. Exact двухфайловый Git delta прочитан один раз после Trace
outline. Прочитаны report correction, сохранённый RED и raw GREEN. Tests/live/native/config
операции reviewer не запускал; source/index/HEAD не менялись.

Исправление закрывает исходную причину: `admit` вычисляет отдельный immutable ticket
`gate_input` через существующий `gate.snapshot(root, validated_passport.scope)`, не требует
несуществующего поля в legacy slot и не добавляет выдуманных полей в gate state. При наличии
typed `slot.input` требуется его точное равенство. Preparation и proof используют этот же
ticket snapshot. `current` сравнивает настоящий сохранённый набор slot fields, кроме
изменяющегося evidence, и сохраняет source/passport/lease проверки. Разрешённое позднее
artifact binding по-прежнему делегируется существующему gate; остальные проверки строгие.

Raw `task-9-legacy-red.log` воспроизводит прежний `KeyError: input` после gate start.
`task-9-legacy-green.log`, SHA256
`a34689ac8877544fb177c52e07310002323133af2219001949fc6eb76d4731bc`, содержит 10 tests / OK
за 27.793 s. Новая meaningful regression проводит две реальные legacy verification stages
через admit/collect/record/reconcile/finish при неизменном HEAD, проверяет отсутствие input и
iteration в slot, неизменность паспорта и освобождение parent после второй стадии. Старый
typed archive/commit/bind/finish test также прошёл.

Модель, Docker и Multica в этом regression остаются synthetic boundaries; это доказательство
совместимости collector с двумя gate contracts, не фактическая native приёмка. Для live
продолжения нужен свежий ticket на новых pins; исходный неуспешный admission и освобождение
его lease остаются в истории. Другие ранее принятые codepaths не переоткрывались.
