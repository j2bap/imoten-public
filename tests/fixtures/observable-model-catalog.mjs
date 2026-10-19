import { createHash } from "node:crypto";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const model = (slug, efforts) => ({
  slug,
  display_name: slug,
  supported_in_api: true,
  visibility: "list",
  default_reasoning_level: efforts[0],
  supported_reasoning_levels: efforts.map((effort) => ({ effort })),
  model_messages: {},
  base_instructions: "test",
});

export function observableModelCatalog() {
  const catalog = {
    models: [
      model("gpt-5.6-sol", ["low", "medium", "high", "xhigh", "max"]),
      model("gpt-5.6-terra", ["low", "medium", "high", "xhigh", "max"]),
      model("gpt-5.6-luna", ["low", "medium", "high", "xhigh", "max"]),
      model("gpt-6-astra", ["low", "medium", "high", "xhigh", "max"]),
      model("gpt-6-sol", ["low", "medium", "high", "xhigh", "max"]),
      model("gpt-6-luna", ["low", "medium", "high", "xhigh", "max"]),
      model("gemini-3.8-flash", ["minimal", "low", "medium", "high"]),
      model("grok-4.6", ["low", "medium", "high", "xhigh"]),
      model("mai-code-1.1-flash", ["low", "medium", "high"]),
    ],
  };
  return {
    catalog,
    receipt: {
      schema_version: 1,
      source: "direct-provider",
      generated_at: "2026-09-06T00:00:00.000Z",
      provider: { name: "deepseek", base_url: "https://api.deepseek.test" },
      provider_models_sha256: "0".repeat(64),
      generated_catalog_sha256: sha256(JSON.stringify(catalog)),
      verified_requests: [
        ...catalog.models.flatMap((entry) => entry.supported_reasoning_levels.map(({ effort }) => ({
          model: entry.slug,
          reasoning_effort: effort,
          served_model: entry.slug,
          status: "passed",
        }))),
      ],
    },
  };
}
