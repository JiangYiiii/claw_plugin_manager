.PHONY: help build run stop logs clean test

help:
	@echo "OpenClaw Plugin Manager - Makefile"
	@echo ""
	@echo "容器操作:"
	@echo "  make build       - 构建容器镜像"
	@echo "  make run         - 启动容器"
	@echo "  make pod         - 启动 Pod"
	@echo "  make stop        - 停止容器"
	@echo "  make restart     - 重启容器"
	@echo "  make logs        - 查看日志"
	@echo "  make shell       - 进入容器"
	@echo "  make clean       - 清理容器和镜像"
	@echo ""
	@echo "原生运行:"
	@echo "  make install     - 安装依赖"
	@echo "  make dev         - 开发模式运行"
	@echo "  make test        - 测试运行"
	@echo ""
	@echo "其他:"
	@echo "  make status      - 查看状态"
	@echo "  make config      - 编辑配置"

# 容器操作
build:
	./scripts/build-container.sh

run:
	./scripts/run-container.sh

pod:
	./scripts/run-pod.sh

stop:
	podman stop openclaw-plugin-manager || true

restart:
	podman restart openclaw-plugin-manager

logs:
	podman logs -f openclaw-plugin-manager

shell:
	podman exec -it openclaw-plugin-manager /bin/bash

clean:
	podman rm -f openclaw-plugin-manager || true
	podman rmi -f openclaw-plugin-manager:latest || true
	podman pod rm -f openclaw-plugin-manager-pod || true

# 原生运行
install:
	npm install

dev:
	npm run dev

test:
	./scripts/test-run.sh

# 其他
status:
	@echo "=== Container Status ==="
	@podman ps -a | grep openclaw || echo "No containers running"
	@echo ""
	@echo "=== Images ==="
	@podman images | grep openclaw || echo "No images found"

config:
	${EDITOR:-vi} config/config.yaml
