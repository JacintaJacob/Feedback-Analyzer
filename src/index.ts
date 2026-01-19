/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */
export interface Env {
  AI: Ai; 
  FEEDBACK_DB: D1Database;
  FEEDBACK_CACHE: KVNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      // Serve the simple HTML UI
      return serveHtml();
    }

    if (request.method === "POST" && url.pathname === "/summarize") {
      // Handle feedback summarization
      return handleSummarize(request, env);
    }
    if (request.method === "GET" && url.pathname === "/history") {
     const { results } = await env.FEEDBACK_DB
     .prepare("SELECT id, feedback, summary, created_at FROM summaries ORDER BY created_at DESC LIMIT 10")
     .all();
      return Response.json(results);
   }


    // Fallback: keep a simple test route similar to your original code
    if (request.method === "GET" && url.pathname === "/feedback-analyzer") {
      const response = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
        prompt: "What is the origin of the phrase Hello, World?",
      });
      return new Response(JSON.stringify(response), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404 });
  },
};

async function handleSummarize(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { feedback?: string } | null;

  if (!body || !body.feedback || body.feedback.trim().length === 0) {
    return Response.json({ error: "Missing 'feedback' in request body" }, { status: 400 });
  }

  const feedback = body.feedback.trim();

  // KV cache key: simple hash of feedback
  const cacheKey = `sum:${btoa(feedback).slice(0, 50)}`;

  // Check cache first
  let text = await env.FEEDBACK_CACHE.get(cacheKey);

  if (!text) {
    const prompt = `
You are helping a product manager understand customer feedback.

Feedback (from multiple channels such as tickets, GitHub, Discord, and X):
${feedback}

Task:
1) Provide 3-5 bullet points summarizing the key themes.
2) Provide an overall sentiment (positive, neutral, or negative) with one sentence explanation.
3) Suggest one concrete action item for the product team.

Respond in clear markdown text.
    `.trim();

    const model = "@cf/meta/llama-3.1-8b-instruct"; 

    try {
      const aiResponse = await env.AI.run(model, {
        prompt,
        max_tokens: 400,
      });

      const out: any = aiResponse;
      text =
        out.response ??
        out.result ??
        out.output ??
        JSON.stringify(out);

      // Cache for 1 hour
      await env.FEEDBACK_CACHE.put(cacheKey, text, { expirationTtl: 3600 });
    } catch (err: any) {
      console.error("AI Error:", err);
      return Response.json(
        { error: "Failed to generate summary" },
        { status: 500 }
      );
    }
  }

  // Always persist to D1 (even cache hits, for history)
  try {
    await env.FEEDBACK_DB
      .prepare("INSERT INTO summaries (feedback, summary) VALUES (?, ?)")
      .bind(feedback, text)
      .run();
  } catch (dbErr) {
    console.error("D1 Error:", dbErr);
     }

  return Response.json({ 
    summary: text, 
    fromCache: !!text  // true if cached
  });
}

function serveHtml(): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>AI Feedback Summarizer</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; max-width: 800px; }
    textarea { width: 100%; height: 200px; }
    button { margin-top: 0.5rem; padding: 0.5rem 1rem; }
    #result { white-space: pre-wrap; margin-top: 1rem; padding: 1rem; border: 1px solid #ccc; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>AI Feedback Summarizer</h1>
  <p>Paste customer feedback from multiple channels (support tickets, GitHub, Discord, X, etc.) and get a summary + sentiment.</p>

  <textarea id="feedback" placeholder="[Support] The dashboard is slow...&#10;[GitHub] The API docs are unclear..."></textarea>
  <br />
  <button id="summarize">Summarize</button>

  <h2>Result</h2>
  <div id="result">No summary yet.</div>

  <script>
    const button = document.getElementById("summarize");
    const feedbackEl = document.getElementById("feedback");
    const resultEl = document.getElementById("result");

    button.addEventListener("click", async () => {
      const feedback = feedbackEl.value.trim();
      if (!feedback) {
        resultEl.textContent = "Please paste some feedback first.";
        return;
      }

      resultEl.textContent = "Summarizing...";
      try {
        const res = await fetch("/summarize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ feedback }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          resultEl.textContent = "Error: " + (err.error || res.statusText);
          return;
        }

        const data = await res.json();
        resultEl.textContent = data.summary || JSON.stringify(data, null, 2);
      } catch (e) {
        console.error(e);
        resultEl.textContent = "Unexpected error while calling the summarizer.";
      }
    });
  </script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
