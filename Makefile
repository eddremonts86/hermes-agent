# =============================================================================
# eddremonts86/hermes-agent (fork) — convenience targets.
# Upstream NousResearch/hermes-agent no usa Make; este Makefile agrega
# utilidades para mantener el fork sincronizado con upstream y para
# arrancar el contenedor publicado por el workflow de GHCR.
#
# Targets principales:
#   make sync-upstream     — trae los últimos cambios de NousResearch
#   make sync-status       — muestra commits ahead/behind sin tocar nada
#   make shell             — abre shell dentro del container (usa la imagen GHCR)
#   make up / down / logs  — los mismos que en HermesWorkSpace, pero acá
# =============================================================================

SHELL := /bin/bash
IMAGE ?= ghcr.io/eddremonts86/hermes-agent:latest
COMPOSE := docker compose -f docker/docker-compose.yml

.PHONY: help sync-upstream sync-status up down logs shell test \
        fork-publish-version

help: ## Muestra esta ayuda
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "\033[36m%-22s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# =============================================================================
# Sincronización con NousResearch/hermes-agent
# =============================================================================
#
# Cómo funciona:
#   - Remote `nousresearch` apunta al repo original
#   - `make sync-status` te dice cuántos commits de diferencia hay
#   - `make sync-upstream` hace `git fetch` + `git rebase` (o merge, según flag)
#   - Si hay conflictos, los resolve`ás a mano y después `git push origin main`
#
# Para automatizar: el workflow `.github/workflows/sync-upstream.yml` corre
# este mismo script una vez por semana, abre un PR con los cambios, y re-
# publica la imagen cuando el PR se merge'a.

sync-status: ## Muestra cuántos commits ahead/behind de NousResearch
	@bash scripts/sync-upstream.sh status

sync-upstream: ## Sincroniza origin/main con nousresearch/main (rebase o merge)
	@bash scripts/sync-upstream.sh sync $(ARGS)

# =============================================================================
# Container (usa la imagen que este fork publica a GHCR)
# =============================================================================

up: ## Levanta el container usando la imagen de GHCR
	@echo "Imagen: $(IMAGE)"
	@docker run -d --name hermes-fork --rm \
		--network host \
		-v $(PWD)/hermes-data:/opt/data \
		$(IMAGE) sleep infinity

down: ## Para el container
	@docker stop hermes-fork 2>/dev/null || true

shell: ## Shell dentro del container
	@docker exec -it -u hermes hermes-fork bash

logs: ## Sigue los logs del container
	@docker logs -f hermes-fork

test: ## Corre los tests del fork (smoke + unit)
	@bash scripts/fork-tests.sh
