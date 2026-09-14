---
description: Запустить стадию задачи Multica с проверкой evidence предыдущей стадии
argument-hint: <архитектура|разработка|тестирование|ревью|документация|релиз> T-NNN
---

Этот агент или команда подключены только запуском Multica. Перед работой прочитай
`docs/multica/runtime-entry.md`, включая ритуал и контракт проверок. Если файл отсутствует
в старом checkout, используй `/Users/egorbondarenko/WebstormProjects/Altera/docs/multica/runtime-entry.md`.

Стадия: **$1**, задача: **$2**

## Шаг 1. Проверь вход стадии

По `docs/multica/operating-model.md` §3 у каждой стадии есть обязательный вход — evidence
предыдущей стадии в репозитории. Найди его и покажи путь к файлу:

- архитектура → файл задачи и её источники;
- разработка → техплан `docs/plans/` с базовым коммитом;
- тестирование → критерии готовности задачи и коммиты стадии разработки;
- ревью → коммиты, отчёт `docs/reports/` с разделом «Как проверено»;
- документация → вердикт ревью «принято»;
- релиз → всё перечисленное выше.

Если evidence предыдущей стадии нет — стадия не начинается. Скажи об этом и остановись.

Перед переходом сопоставь task, AC-ID, authorization, baseline и проверяемую revision evidence с
текущими HEAD и dirty fingerprint. Устаревшее evidence, неизвестный dirty diff, открытый Q или
незакрытая зависимость не разрешают переход. Зафиксируй actor/run текущего запуска.

## Шаг 2. Запусти профильного субагента

- архитектура → `altera-multica:multica-architect`
- разработка → `altera-multica:multica-developer`
- тестирование → `altera-multica:multica-tester`
- ревью → `altera-multica:multica-reviewer`
- документация → `altera-multica:multica-docs-keeper`
- релиз → `altera-multica:multica-release`

Стадии дизайна, текстов и SEO ведут `altera-multica:multica-designer`, `altera-multica:multica-editor`, `altera-multica:multica-seo` по
разделу «Участники стадий» файла задачи.

Ревью запускается **только** отдельным субагентом `altera-multica:multica-reviewer` и только если он не
выполнял реализацию этой же задачи в этой сессии. Самопроверка ревью не заменяет.

## Шаг 3. Зафиксируй выход

Стадия завершена, когда evidence из §3 записан в репозиторий. По каждой проверке сохрани AC-ID,
стабильный `check_id`, actor/run, полный commit, dirty fingerprint, cwd, команду, exit code,
фактическое число сценариев, значимый вывод, `trace_ref`, результат и ограничения. Покажи путь.

Разделяй native run outcome, stage outcome и task acceptance. Успешный run сам не завершает
стадию, а завершённая стадия не принимает задачу. Если стадия возвращается или останавливается,
добавь запись в отчёт с причиной и persistent failures (`check_id → число`); старую запись не
удаляй. Две подряд неуспешные попытки одного `check_id` останавливают эту проверку в стадии,
даже если начат новый run.

## Обязательный контракт артефакта

Применяй полностью разделы 1–4 `docs/development/artifact-contracts.md`; command не может
отбрасывать поля канонического контракта. Зафиксируй: task/источник поручения, authorization,
scope, полный baseline SHA, проверяемую revision, dirty fingerprint, стадию, AC-ID, стабильные
`check_id`, actor/run, `trace_ref`, предыдущий счёт неуспехов по каждому `check_id`, handoff
и наблюдаемое условие resume, а также раздельные run outcome, stage outcome и task acceptance.
Если revision, проверка или handoff ещё не существуют на этом шаге, пиши
`not_yet_applicable: <причина>`; не придумывай значение и не опускай поле молча.
