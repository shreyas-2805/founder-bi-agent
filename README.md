# Founder BI

A lightweight conversational business-intelligence prototype for founders. It reads Deals and Work Orders from monday.com, normalizes common messy values, builds a focused analysis context, and uses OpenAI to deliver an executive answer with data-quality caveats.

## Architecture

Browser chat UI → Vercel server function → monday.com GraphQL API (read-only) → normalizer/aggregator → OpenAI → answer and data-quality notes.

The browser never receives API keys. `api/chat.js` reads both boards dynamically on each request. It does not write to monday.com.

## Setup

1. Import the supplied spreadsheets to two monday.com boards.
2. Create a monday API token with access to the boards.
3. Deploy this repository to Vercel.
4. In Vercel → Project → Settings → Environment Variables, add the values from `.env.example`.
5. Redeploy and open the public URL.

Required settings: `MONDAY_API_TOKEN`, `MONDAY_DEALS_BOARD_ID`, `MONDAY_WORK_ORDERS_BOARD_ID`, `OPENAI_API_KEY`.

## What it handles

- Revenue/pipeline questions by sector and stage.
- Operational, billing, collection, and receivable questions.
- Leadership-update prompts that combine sales and operations.
- Blank values, inconsistent text labels, currency formatting, and missing dates are treated as null and reported as caveats.

## Trade-offs

The app loads up to 500 board items per board and sends a compact, capped context to the model. This is suitable for an assessment prototype and provides live data; production work would add pagination, secure user authentication, caching, explicit field mapping, source links to individual monday items, and automated tests.
