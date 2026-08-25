# Decision Log

## Assumptions

- The supplied sheets are imported into separate monday.com boards and may have inconsistent values, blank cells, and changing board column types.
- The application is read-only. The user holds the monday and OpenAI credentials; no credentials are committed to source control.
- All monetary values are treated as INR unless the board explicitly indicates otherwise.

## Decisions and trade-offs

I chose a small serverless Vercel prototype instead of a complex agent framework. This makes the system easy to deploy and explain, while keeping monday and OpenAI keys on the server. The app queries monday dynamically on every chat request, satisfying the requirement not to hardcode the CSV data.

The agent separates responsibilities: code retrieves, normalizes, and aggregates data; the language model interprets a founder’s question and writes the executive narrative. Text is normalized by trimming, standardizing field names, treating blank/N/A/- values as null, and parsing number-like currency values. The response includes a data-quality summary rather than hiding incomplete records.

For the time limit, the agent uses a heuristic field mapper that recognizes the supplied Deals and Work Orders headings. A production version would provide an administrator field-mapping screen, semantic schema validation, request audit logs, pagination/caching, authentication per user, and links back to the source monday items.

## Leadership updates

I interpret a leadership update as a concise cross-functional briefing: pipeline and stage movement, execution/billing/collection risks, material data caveats, and one recommended management action. It is designed to be a starting point for a leadership meeting, not a financial system of record.

## AI tools used

Codex was used to plan the architecture, generate the prototype, and review the integration approach. OpenAI is used at runtime to understand questions and compose grounded executive summaries; it is not the source of truth and is instructed not to invent figures.
