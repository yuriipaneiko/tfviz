.PHONY: build ui test typecheck dev run clean

bin/tfviz: ui
	go build -o bin/tfviz ./cmd/tfviz

build: bin/tfviz

ui:
	cd web && pnpm install --frozen-lockfile && pnpm build

test:
	go test ./...

typecheck:
	cd web && pnpm typecheck

# API on :7777 + Vite on :5173. Point a browser at http://127.0.0.1:5173
# DIR=. make dev
dev:
	@trap 'kill 0' EXIT; \
	go run ./cmd/tfviz --dev --no-open --port 7777 $${DIR:-.} & \
	cd web && pnpm dev --host 127.0.0.1; \
	wait

run: build
	./bin/tfviz $${DIR:-.}

clean:
	rm -rf bin/tfviz web/dist
	mkdir -p web/dist
	touch web/dist/.gitkeep
