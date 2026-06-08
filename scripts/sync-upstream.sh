#!/bin/bash
# =============================================================================
# scripts/sync-upstream.sh — sincroniza origin/main con nousresearch/main.
#
# Uso:
#   bash scripts/sync-upstream.sh status
#       Muestra commits ahead/behind sin tocar nada.
#
#   bash scripts/sync-upstream.sh sync [--rebase|--merge]
#       Hace fetch + rebase (default) o merge de nousresearch/main a origin/main.
#       Si hay conflictos, los resolve`ás a mano y después `git push origin main`.
#
# Por qué existe:
#   El fork diverge 274 commits de NousResearch al día de hoy. Sin sync
#   periódico, mergear cambios upstream después de N semanas se vuelve
#   infernal. La CI corre este mismo script vía .github/workflows/sync-
#   upstream.yml cada lunes 06:00 UTC, abre un PR automático y vos lo
#   revisás cuando quieras.
#
# Variables de entorno:
#   UPSTREAM_REMOTE  (default: nousresearch)
#   UPSTREAM_BRANCH  (default: main)
#   STRATEGY         (default: rebase; alterna con --merge)
# =============================================================================

set -euo pipefail

UPSTREAM_REMOTE="${UPSTREAM_REMOTE:-nousresearch}"
UPSTREAM_BRANCH="${UPSTREAM_BRANCH:-main}"
STRATEGY="${STRATEGY:-rebase}"

cd "$(dirname "$0")/.."

ensure_remote() {
  if ! git remote get-url "$UPSTREAM_REMOTE" >/dev/null 2>&1; then
    echo "➕ Agregando remote $UPSTREAM_REMOTE → https://github.com/NousResearch/hermes-agent.git"
    git remote add "$UPSTREAM_REMOTE" https://github.com/NousResearch/hermes-agent.git
  fi
}

cmd_status() {
  ensure_remote
  echo "📥 Fetching $UPSTREAM_REMOTE (depth: 200)..."
  git fetch "$UPSTREAM_REMOTE" --depth=200 --quiet
  local ahead behind
  ahead=$(git rev-list --count "origin/main..$UPSTREAM_REMOTE/$UPSTREAM_BRANCH" 2>/dev/null || echo "?")
  behind=$(git rev-list --count "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH..origin/main" 2>/dev/null || echo "?")
  echo
  echo "  origin/main  vs  $UPSTREAM_REMOTE/$UPSTREAM_BRANCH"
  echo "  ahead:  $behind commits (tus cambios locales que NO están upstream)"
  echo "  behind: $ahead commits (cambios upstream que no tenés)"
  echo
  if [ "$ahead" != "0" ] && [ "$behind" != "0" ]; then
    echo "  ⚠️  Hay divergencia. Corré: make sync-upstream"
  fi
}

cmd_sync() {
  ensure_remote
  if [ "${1:-}" = "--merge" ]; then
    STRATEGY="merge"
  fi

  echo "🛡️  Haciendo backup del branch actual..."
  local current_branch
  current_branch=$(git symbolic-ref --short HEAD)
  local backup_branch="backup/${current_branch}-$(date +%Y%m%d-%H%M%S)"
  git branch "$backup_branch" 2>/dev/null || true
  echo "  → $backup_branch"

  echo "📥 Fetching $UPSTREAM_REMOTE/$UPSTREAM_BRANCH..."
  git fetch "$UPSTREAM_REMOTE" --quiet

  echo "🔀 Sync vía $STRATEGY..."
  if [ "$STRATEGY" = "merge" ]; then
    if ! git merge --no-ff "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH" -m "chore(sync): merge $UPSTREAM_REMOTE/$UPSTREAM_BRANCH @ $(date +%Y-%m-%d)"; then
      echo
      echo "❌ Merge conflict. Resolvelo a mano y corré:"
      echo "   git add -A && git commit --no-edit"
      echo "   git push origin main"
      exit 1
    fi
  else
    if ! git rebase "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH"; then
      echo
      echo "❌ Rebase conflict. Resolvelo a mano y corré:"
      echo "   git rebase --continue   (o --abort para volver atrás)"
      echo "   git push --force-with-lease origin main"
      exit 1
    fi
  fi

  echo
  echo "✅ Sync completo. Cambios en origin/main."
  echo "   Para subir: git push $([ "$STRATEGY" = "merge" ] && echo origin || echo --force-with-lease origin) main"
}

case "${1:-status}" in
  status)
    cmd_status
    ;;
  sync)
    shift
    cmd_sync "$@"
    ;;
  *)
    echo "Uso: $0 {status|sync [--merge]}"
    exit 2
    ;;
esac
