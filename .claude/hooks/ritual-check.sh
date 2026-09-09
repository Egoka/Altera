#!/usr/bin/env bash
# Проверка ритуала «план + отчёт» перед завершением ответа.
#
# Правило CLAUDE.md: работа по неописанному плану не начинается, а план не считается
# выполненным, пока нет парного отчёта. Хук не даёт молча закончить заход, в котором
# менялся продуктовый код, но нет ни плана, ни отчёта.
#
# Коды: 0 — можно завершать; 2 — завершение блокируется один раз, текст уходит модели.

set -uo pipefail

INPUT="$(cat 2>/dev/null || true)"

# Защита от зацикливания: если хук уже блокировал завершение в этом же заходе — пропускаем.
if printf '%s' "$INPUT" | grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$PROJECT_DIR" || exit 0

command -v git >/dev/null 2>&1 || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

# Изменения продуктового кода в рабочем дереве относительно HEAD.
CHANGED="$(git status --porcelain -- server web packages 2>/dev/null | grep -v '^!!' || true)"
[ -z "$CHANGED" ] && exit 0

TODAY="$(date +%Y-%m-%d)"

# Планы, изменённые или созданные в рабочем дереве, либо созданные сегодня.
PLANS="$(git status --porcelain -- docs/plans 2>/dev/null | awk '{print $NF}' | grep '\.md$' || true)"
[ -z "$PLANS" ] && PLANS="$(ls docs/plans/${TODAY}-*.md 2>/dev/null || true)"

if [ -z "$PLANS" ]; then
  cat >&2 <<'MSG'
Ритуал проекта не соблюдён: в рабочем дереве изменён продуктовый код (server/, web/ или
packages/), но нет плана в docs/plans/ за сегодня и нет изменённого плана.

CLAUDE.md: «Работа по неописанному плану не начинается». В шапке плана обязателен базовый
коммит (git rev-parse --short HEAD).

Сохрани план в docs/plans/ГГГГ-ММ-ДД-имя.md по формату docs/plans/README.md либо, если правки
продуктового кода не входили в задачу, откати их.
MSG
  exit 2
fi

# У каждого затронутого плана должен быть парный отчёт с тем же слагом.
MISSING=""
while IFS= read -r plan; do
  [ -n "$plan" ] || continue
  base="$(basename "$plan" .md)"
  [ "$base" = "README" ] && continue
  if [ ! -f "docs/reports/${base}-report.md" ]; then
    MISSING="${MISSING}  docs/reports/${base}-report.md\n"
  fi
done <<< "$PLANS"

if [ -n "$MISSING" ]; then
  {
    echo "Ритуал проекта не завершён: продуктовый код изменён, план есть, парного отчёта нет."
    echo
    echo "Отсутствуют файлы:"
    printf "$MISSING"
    echo
    echo "CLAUDE.md: «План не считается выполненным, пока отчёта нет — даже если код уже"
    echo "написан и закоммичен». Раздел «Как проверено» содержит выполненные команды и их"
    echo "фактический вывод; утверждение «работает» без проверки в отчёт не попадает."
  } >&2
  exit 2
fi

exit 0
