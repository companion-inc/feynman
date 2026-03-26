import { dirname, resolve } from "node:path";

import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";

export function getModelsJsonPath(authPath: string): string {
	return resolve(dirname(authPath), "models.json");
}

export function createModelRegistry(authPath: string): ModelRegistry {
	return new ModelRegistry(AuthStorage.create(authPath), getModelsJsonPath(authPath));
}

