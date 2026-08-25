const MONDAY_URL = "https://api.monday.com/v2";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

function cleanKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function textOf(value) {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).trim();
  return cleaned && !/^(n\/a|na|null|undefined|-)$/i.test(cleaned) ? cleaned : null;
}

function numberOf(value) {
  const cleaned = textOf(value);
  if (!cleaned) return null;
  const numeric = Number(cleaned.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function getAny(record, names) {
  for (const name of names) {
    const value = record[cleanKey(name)];
    if (value) return value;
  }
  return null;
}

async function mondayRequest(boardId) {
  const query = `query ($boardIds: [ID!]) {
    boards(ids: $boardIds) {
      id
      name
      columns { id title type }
      items_page(limit: 500) {
        items { id name column_values { id text } }
      }
    }
  }`;
  const result = await fetch(MONDAY_URL, {
    method: "POST",
    headers: { Authorization: process.env.MONDAY_API_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { boardIds: [String(boardId)] } })
  });
  const payload = await result.json();
  if (!result.ok || payload.errors) throw new Error(payload.errors?.[0]?.message || "monday.com could not be reached.");
  const board = payload.data.boards[0];
  if (!board) throw new Error("The requested monday.com board was not found.");
  const columns = Object.fromEntries(board.columns.map((column) => [column.id, column.title]));
  const rows = board.items_page.items.map((item) => {
    const row = { item_name: textOf(item.name), item_id: item.id };
    for (const value of item.column_values) row[cleanKey(columns[value.id])] = textOf(value.text);
    return row;
  });
  return { name: board.name, rows };
}

function dealRecord(row) {
  return {
    deal: row.item_name,
    sector: getAny(row, ["sector/service", "sector", "service"]),
    status: getAny(row, ["deal status"]),
    stage: getAny(row, ["deal stage"]),
    probability: getAny(row, ["closure probability"]),
    value: numberOf(getAny(row, ["masked deal value", "deal value", "value"])),
    close_date: getAny(row, ["close date (a)", "tentative close date", "close date"]),
    product: getAny(row, ["product deal", "product"])
  };
}

function workOrderRecord(row) {
  return {
    work_order: row.item_name,
    sector: getAny(row, ["sector"]),
    execution_status: getAny(row, ["execution status"]),
    nature_of_work: getAny(row, ["nature of work", "type of work"]),
    probable_start: getAny(row, ["probable start date"]),
    probable_end: getAny(row, ["probable end date"]),
    amount: numberOf(getAny(row, ["amount in rupees (excl of gst) (masked)"])),
    billed_value: numberOf(getAny(row, ["billed value in rupees (incl of gst.) (masked)"])),
    receivable: numberOf(getAny(row, ["amount receivable (masked)"])),
    billing_status: getAny(row, ["billing status", "invoice status"]),
    collection_status: getAny(row, ["collection status"])
  };
}

function aggregateBy(records, key, numericKey) {
  const buckets = {};
  for (const record of records) {
    const label = record[key] || "Missing / unclassified";
    if (!buckets[label]) buckets[label] = { count: 0, value: 0 };
    buckets[label].count += 1;
    buckets[label].value += Number(record[numericKey]) || 0;
  }
  return Object.entries(buckets).map(([name, item]) => ({ name, ...item })).sort((a, b) => b.value - a.value);
}

function dataQuality(deals, workOrders) {
  const missing = (records, field) => records.filter((item) => !item[field]).length;
  return {
    deals_missing_sector: missing(deals, "sector"),
    deals_missing_value: missing(deals, "value"),
    deals_missing_close_date: missing(deals, "close_date"),
    work_orders_missing_sector: missing(workOrders, "sector"),
    work_orders_missing_execution_status: missing(workOrders, "execution_status")
  };
}

function buildContext(deals, workOrders) {
  const dealValue = deals.reduce((total, deal) => total + (deal.value || 0), 0);
  const receivables = workOrders.reduce((total, item) => total + (item.receivable || 0), 0);
  return {
    overview: {
      deal_count: deals.length,
      total_pipeline_value: dealValue,
      work_order_count: workOrders.length,
      total_receivables: receivables
    },
    deals_by_sector: aggregateBy(deals, "sector", "value"),
    deals_by_stage: aggregateBy(deals, "stage", "value"),
    work_orders_by_sector: aggregateBy(workOrders, "sector", "amount"),
    data_quality: dataQuality(deals, workOrders),
    deals: deals.slice(0, 300),
    work_orders: workOrders.slice(0, 300)
  };
}

async function askAI(question, context) {
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const system = `You are Founder BI, an executive business-intelligence assistant. Use only the supplied monday.com data. Be concise and helpful. Start with a direct answer, then give 2-4 evidence-backed insights, then any important data-quality caveat, and finish with one recommended action. Do not invent figures. Dates may be inconsistent: state assumptions. If the question is too ambiguous, ask one short clarifying question. Amounts are INR unless data says otherwise.`;
  const result = await fetch(OPENAI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, temperature: 0.2, messages: [
      { role: "system", content: system },
      { role: "user", content: `Question: ${question}\n\nData from monday.com:\n${JSON.stringify(context)}` }
    ] })
  });
  const payload = await result.json();
  if (!result.ok) throw new Error(payload.error?.message || "The AI service could not be reached.");
  return payload.choices?.[0]?.message?.content || "I could not generate an answer.";
}

module.exports = async (request, response) => {
  if (request.method !== "POST") return response.status(405).json({ error: "Use POST." });
  try {
    const question = textOf(request.body?.question);
    if (!question) return response.status(400).json({ error: "Please enter a question." });
    for (const key of ["MONDAY_API_TOKEN", "MONDAY_DEALS_BOARD_ID", "MONDAY_WORK_ORDERS_BOARD_ID", "OPENAI_API_KEY"]) {
      if (!process.env[key]) throw new Error(`Missing required setting: ${key}.`);
    }
    const [dealBoard, workOrderBoard] = await Promise.all([
      mondayRequest(process.env.MONDAY_DEALS_BOARD_ID),
      mondayRequest(process.env.MONDAY_WORK_ORDERS_BOARD_ID)
    ]);
    const deals = dealBoard.rows.map(dealRecord);
    const workOrders = workOrderBoard.rows.map(workOrderRecord);
    const context = buildContext(deals, workOrders);
    const answer = await askAI(question, context);
    response.status(200).json({ answer, sources: { deals: dealBoard.name, work_orders: workOrderBoard.name }, dataQuality: context.data_quality });
  } catch (error) {
    response.status(500).json({ error: error.message || "Something went wrong. Please try again." });
  }
};
