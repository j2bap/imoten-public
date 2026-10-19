globalThis.fetch = async (url, options) => {
  let body;
  if (url.endsWith("/models")) {
    body = { object: "list", data: [{ id: "deepseek-flash" }] };
  } else {
    const request = JSON.parse(options.body);
    body = { status: "completed", model: request.model, output: [] };
  }
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
};
