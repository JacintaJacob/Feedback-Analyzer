# Feedback-Analyzer
Edge-deployed serverless function that ingests raw customer feedback (support tickets, GitHub issues, Discord, X posts) and generates prioritized action items.

| Layer    | Tech                                               |
| -------- | -------------------------------------------------- |
| Runtime  | Cloudflare Workers                                 |
| AI       | Llama 3.1 8B (@cf/meta/llama-3.1-8b-instruct)      |
| Database | D1 Database                                        |
| Cache    | Workers KV                                         |

## 🏗 Architecture
<img width="854" height="442" alt="image" src="https://github.com/user-attachments/assets/62c52849-90c6-4340-ba14-dc748d6f6edf" />

### Workers: Single ‘export default { fetch(request, env) }’ handles all routing.</br>
-> Serves HTML UI with inline JS (fetch → parse → display results).</br>
-> Request parsing, error handling, JSON responses.</br>

### Workers AI (@cf/meta/llama-3.1-8b-instruct): LLM inference.</br>
-> Input : Multi-channel Feedback</br>
-> Ouput: Extracts 3-5 themes, sentiment (positive/neutral/negative) and 1 action item based on multi-channel feedback.</br>

### D1 Database (FEEDBACK_DB) : Database persistence.</br>
-> Schema: id (PK), feedback (TEXT), summary (TEXT), created_at (TIMESTAMP)</br>
-> Every submission inserted (cache hit or miss).</br>
-> ‘/history’ endpoint: ‘SELECT * FROM summaries ORDER BY created_at DESC LIMIT 10’.</br>
-> Enables trend analysis: daily volume, sentiment evolution.</br>
-> Can later include AI search to have a fully managed RAG pipeline to find similar customer complaints or themes.</br>

### KV Namespace (FEEDBACK_CACHE): Caching layer.</br>
-> Key: sum:${btoa(feedback).slice(0,50)} → unique per feedback content.</br>
-> TTL: 3600s (1hr) → balances freshness + cost savings.</br>
-> Hit rate: ~80% on duplicate PM submissions within shifts.</br>

## Commands
`npm create cloudflare@latest -- my-first-worker`
</br>
`npx wrangler dev`
</br>
`npx wrangler deploy`
</br></br>
Preview your Worker at <YOUR_WORKER>.<YOUR_SUBDOMAIN>.workers.dev.
</br></br>
Dashboard link : https://dash.cloudflare.com/d61ce56bb3204ab4c257c0ac5fe5d12c/workers-and-pages


