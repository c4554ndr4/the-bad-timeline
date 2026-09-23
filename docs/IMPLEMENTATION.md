# Implementation notes

This repository records an exploratory demonstration and subsequent product-infrastructure work. The README explains the research idea; these notes identify which implementation supports each architectural claim.

## Original demonstration and later changes

The early Kimi-K2 implementation, retained in the private development history, selected `moonshotai/kimi-k2-instruct` through Groq. It supplied written preferences and examples of liked and unliked posts to generation. Some negative examples were inferred from posts that had not been liked, rather than explicit downvotes.

Both current generation paths select `llama-3.3-70b-versatile`. There is no automatic Kimi-to-Llama fallback router. The DEF CON context and Doherty-threshold design goal describe the original project; the current checkout includes later authentication, payment, loading, and deployment experiments.

## Feedback and generation

The current [serverless generation handler](../api/tweets/generate.js) retrieves up to ten user preferences, ten user likes, and twenty recent posts. The first three database queries run concurrently; liked-post IDs are then resolved to their text. Recent history is global rather than scoped to a single user.

The model returns a structured batch. The service keeps nonempty text, limits posts to 280 characters, caps the requested batch at ten, and supplies placeholder posts when too few usable entries remain. These are basic output-shaping steps, not a complete response-schema or content-safety validation layer.

[The public feed handler](../api/tweets/index.js) lists stored posts by recency without filtering by the generating user. Per-user feedback and personalized generation therefore coexist with a shared feed.

## Responsiveness

The [feed controller](../frontend/src/App.jsx) uses an end-of-feed observer with a 100-pixel lead and appends batches while retaining the existing timeline. It reads stored pages before requesting fresh generation. It does not implement a separately replenished generation buffer or token streaming.

The present checkout deliberately waits 800 ms before its initial feed request and 600 ms before fetching another stored page. [Likes](../frontend/src/components/Tweet.jsx) update visually after the API request succeeds. These paths do not establish a sub-400 ms interaction result. Those delays were added after the earliest Kimi prototype; they should not be projected backward onto that version.

No committed timing measurements or latency-regression checks establish the original demonstration's end-to-end performance. A future evaluation should report interaction feedback time, stored-page delivery, and fresh-generation latency separately, including their slow-tail behavior.

## Two backend paths

| Path | Responsibility | State |
| --- | --- | --- |
| Root `api/` handlers, selected by `vercel.json` | Same-origin API requests, Supabase authentication, persisted generation and credits | Supabase tables for profiles, preferences, likes, tweets, and credit transactions |
| `backend/server.js` | Earlier local application and generation service | SQLite-backed account/feedback data and a process-wide tweet array |

The local database switches to in-memory operation in production mode. Its feed array is also process-local. It should not be described as the same durable storage architecture as the serverless path.

For serverless generation, credits are deducted before inference and a refund is attempted if generation or insertion fails. The balance update and ledger write are separate operations; this is compensating error handling, not atomic or exactly-once accounting.

## Clean release and remaining integration work

The public snapshot fixes the serverless prompt path, treats the absent optional seed dataset as an empty initial feed, and sends preferences using the handler's `text` field. Missing dependencies and placeholder package metadata have been corrected. Node 22.13 or later is required.

The frontend production build, JavaScript syntax checks, mocked configuration/feed/preference checks, backend startup, unauthorized-request rejection, and SQLite session storage were verified. Dependency audits of the root, frontend, and backend reported no known vulnerabilities at publication. These checks do not establish that the separate local and serverless paths work interchangeably, or that a live model, Supabase deployment, and payment integration function together.

The serverless path still requires its database schema, authentication settings, provider credentials, and payment configuration. Credit deduction, storage, and compensating refunds should receive end-to-end failure tests before use as a paid service.

## README figure

The [cognitive-insecurity figure](cognitive-insecurity.png) uses fictional posts and abbreviated illustrative prompts. It shows the reader's context and an operator-defined objective entering the same generation request. Multiple apparent authors share one model process. A like becomes context on a later generation request; saving it does not immediately call the model.

The AI-control examples paraphrase the kind of influence under study. They are not captured outputs or verbatim prompt records. The original Kimi demonstration and current Llama-based implementation are distinguished above. The image was generated with ImageGen and checked against these architectural claims.
