require("dotenv").config({ path: ".env.local" });

const Groq = require("groq-sdk");

const MONDAY_URL = "https://api.monday.com/v2";

/* =========================================================
   BASIC HELPERS
========================================================= */

function cleanText(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();

  if (
    !text ||
    ["n/a", "na", "-", "null", "none", "undefined"].includes(
      text.toLowerCase()
    )
  ) {
    return null;
  }

  return text;
}

function parseNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value)
    .replace(/[$₹€£,\s]/g, "")
    .trim();

  if (!text) {
    return null;
  }

  const match = text.match(/-?\d+(\.\d+)?/);

  if (!match) {
    return null;
  }

  const number = Number(match[0]);

  return Number.isFinite(number) ? number : null;
}

function normalizeDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

function normalizeText(value) {
  const text = cleanText(value);

  if (!text) {
    return null;
  }

  return text.trim();
}

/* =========================================================
   PROBABILITY
========================================================= */

function normalizeProbability(value) {
  const text = cleanText(value);

  if (!text) {
    return null;
  }

  const lower = text.toLowerCase();

  if (lower.includes("high")) {
    return 0.8;
  }

  if (lower.includes("medium")) {
    return 0.5;
  }

  if (lower.includes("low")) {
    return 0.2;
  }

  const number = parseNumber(text);

  if (number === null) {
    return null;
  }

  if (number > 1) {
    return Math.min(number / 100, 1);
  }

  return Math.max(number, 0);
}

/* =========================================================
   MONDAY API
========================================================= */

async function mondayRequest(query, variables = {}) {
  const response = await fetch(MONDAY_URL, {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
      Authorization: process.env.MONDAY_API_TOKEN
    },

    body: JSON.stringify({
      query,
      variables
    })
  });

  const data = await response.json();

  if (!response.ok || data.errors) {
    throw new Error(
      data.errors?.map((e) => e.message).join("; ") ||
        `Monday API error: ${response.status}`
    );
  }

  return data.data;
}

async function getBoardItems(boardId) {
  const query = `
    query ($boardId: ID!) {
      boards(ids: [$boardId]) {
        id
        name

        items_page(limit: 500) {
          items {
            id
            name

            column_values {
              id
              text

              column {
                title
                type
              }
            }
          }
        }
      }
    }
  `;

  const data = await mondayRequest(query, {
    boardId: String(boardId)
  });

  const board = data.boards?.[0];

  if (!board) {
    throw new Error(
      `Monday board ${boardId} was not found.`
    );
  }

  return {
    boardName: board.name,
    items: board.items_page?.items || []
  };
}

/* =========================================================
   COLUMN LOOKUP
========================================================= */

function getColumn(item, title) {
  const column = item.column_values?.find(
    (column) =>
      column.column?.title?.toLowerCase() ===
      title.toLowerCase()
  );

  return column?.text || null;
}

/* =========================================================
   DEAL NORMALIZATION
========================================================= */

function normalizeDeal(item) {
  const actualCloseDate = normalizeDate(
    getColumn(item, "Close Date (A)")
  );

  const tentativeCloseDate = normalizeDate(
    getColumn(item, "Tentative Close Date")
  );

  return {
    id: item.id,

    name: cleanText(item.name),

    owner: normalizeText(
      getColumn(item, "Owner code")
    ),

    client: normalizeText(
      getColumn(item, "Client Code")
    ),

    status: normalizeText(
      getColumn(item, "Deal Status")
    ),

    sector: normalizeText(
      getColumn(item, "Sector/service")
    ),

    probabilityLabel: normalizeText(
      getColumn(item, "Closure Probability")
    ),

    probability: normalizeProbability(
      getColumn(item, "Closure Probability")
    ),

    amount: parseNumber(
      getColumn(item, "Masked Deal value")
    ),

    closeDate: actualCloseDate,

    tentativeCloseDate,

    effectiveCloseDate:
      actualCloseDate || tentativeCloseDate,

    stage: normalizeText(
      getColumn(item, "Deal Stage")
    ),

    product: normalizeText(
      getColumn(item, "Product deal")
    ),

    createdDate: normalizeDate(
      getColumn(item, "Created Date")
    )
  };
}

/* =========================================================
   WORK ORDER NORMALIZATION
========================================================= */

function normalizeWorkOrder(item) {
  return {
    id: item.id,

    name: cleanText(item.name),

    customer: normalizeText(
      getColumn(item, "Customer Name Code")
    ),

    serialNumber: normalizeText(
      getColumn(item, "Serial #")
    ),

    natureOfWork: normalizeText(
      getColumn(item, "Nature of Work")
    ),

    executionStatus: normalizeText(
      getColumn(item, "Execution Status")
    ),

    dataDeliveryDate: normalizeDate(
      getColumn(item, "Data Delivery Date")
    ),

    poDate: normalizeDate(
      getColumn(item, "Date of PO/LOI")
    ),

    startDate: normalizeDate(
      getColumn(item, "Probable Start Date")
    ),

    endDate: normalizeDate(
      getColumn(item, "Probable End Date")
    ),

    owner: normalizeText(
      getColumn(item, "BD/KAM Personnel code")
    ),

    sector: normalizeText(
      getColumn(item, "Sector")
    ),

    typeOfWork: normalizeText(
      getColumn(item, "Type of Work")
    ),

    amountExclGST: parseNumber(
      getColumn(
        item,
        "Amount in Rupees (Excl of GST) (Masked)"
      )
    ),

    amountInclGST: parseNumber(
      getColumn(
        item,
        "Amount in Rupees (Incl of GST) (Masked)"
      )
    ),

    billedExclGST: parseNumber(
      getColumn(
        item,
        "Billed Value in Rupees (Excl of GST.) (Masked)"
      )
    ),

    billedInclGST: parseNumber(
      getColumn(
        item,
        "Billed Value in Rupees (Incl of GST.) (Masked)"
      )
    ),

    collectedAmount: parseNumber(
      getColumn(
        item,
        "Collected Amount in Rupees (Incl of GST.) (Masked)"
      )
    ),

    amountToBeBilled: parseNumber(
      getColumn(
        item,
        "Amount to be billed in Rs. (Incl. of GST) (Masked)"
      )
    ),

    receivable: parseNumber(
      getColumn(item, "Amount Receivable (Masked)")
    ),

    invoiceStatus: normalizeText(
      getColumn(item, "Invoice Status")
    ),

    billingStatus: normalizeText(
      getColumn(item, "Billing Status")
    ),

    woBillingStatus: normalizeText(
      getColumn(item, "WO Status (billed)")
    ),

    collectionStatus: normalizeText(
      getColumn(item, "Collection status")
    ),

    collectionDate: normalizeDate(
      getColumn(item, "Collection Date")
    )
  };
}

/* =========================================================
   CURRENT QUARTER
========================================================= */

function getCurrentQuarter() {
  const now = new Date();

  const quarter =
    Math.floor(now.getMonth() / 3) + 1;

  const startMonth =
    (quarter - 1) * 3;

  const start = new Date(
    now.getFullYear(),
    startMonth,
    1
  );

  const end = new Date(
    now.getFullYear(),
    startMonth + 3,
    0,
    23,
    59,
    59
  );

  return {
    year: now.getFullYear(),
    quarter,
    start,
    end,
    label: `Q${quarter} ${now.getFullYear()}`
  };
}

function isDateInCurrentQuarter(dateString) {
  if (!dateString) {
    return false;
  }

  const date = new Date(dateString);

  if (Number.isNaN(date.getTime())) {
    return false;
  }

  const quarter = getCurrentQuarter();

  return (
    date >= quarter.start &&
    date <= quarter.end
  );
}

/* =========================================================
   PIPELINE
========================================================= */

function calculatePipeline(deals) {
  const validDeals = deals.filter(
    (deal) =>
      deal.amount !== null &&
      deal.amount !== undefined
  );

  const totalPipeline = validDeals.reduce(
    (sum, deal) =>
      sum + deal.amount,
    0
  );

  const weightedPipeline = validDeals.reduce(
    (sum, deal) =>
      sum +
      deal.amount *
        (deal.probability ?? 0),
    0
  );

  const bySector = {};

  for (const deal of validDeals) {
    const sector =
      deal.sector || "Unknown";

    if (!bySector[sector]) {
      bySector[sector] = {
        deals: 0,
        pipeline: 0,
        weightedPipeline: 0
      };
    }

    bySector[sector].deals += 1;

    bySector[sector].pipeline +=
      deal.amount;

    bySector[sector].weightedPipeline +=
      deal.amount *
      (deal.probability ?? 0);
  }

  return {
    dealCount: validDeals.length,
    totalPipeline,
    weightedPipeline,
    bySector
  };
}

/* =========================================================
   DEAL RISKS
========================================================= */

function findDealRisks(deals) {
  const now = new Date();

  return deals
    .map((deal) => {
      let riskScore = 0;
      const reasons = [];

      if (
        deal.probability !== null &&
        deal.probability <= 0.2
      ) {
        riskScore += 3;
        reasons.push("Low closure probability");
      }

      if (
        deal.probability !== null &&
        deal.probability <= 0.5
      ) {
        riskScore += 1;
      }

      if (
        deal.effectiveCloseDate
      ) {
        const closeDate = new Date(
          deal.effectiveCloseDate
        );

        if (
          closeDate < now &&
          deal.status?.toLowerCase() ===
            "open"
        ) {
          riskScore += 3;
          reasons.push(
            "Expected close date has passed"
          );
        }
      } else {
        riskScore += 1;
        reasons.push(
          "Missing close date"
        );
      }

      if (
        deal.status &&
        deal.status.toLowerCase() !== "open"
      ) {
        riskScore += 1;
      }

      if (
        deal.stage &&
        /hold|lost|stalled|inactive/i.test(
          deal.stage
        )
      ) {
        riskScore += 3;
        reasons.push(
          `Stage indicates concern: ${deal.stage}`
        );
      }

      return {
        ...deal,
        riskScore,
        riskReasons: reasons
      };
    })
    .filter(
      (deal) =>
        deal.riskScore >= 3
    )
    .sort(
      (a, b) =>
        b.riskScore -
        a.riskScore
    );
}

/* =========================================================
   WORK ORDER RISKS
========================================================= */

function findWorkOrderRisks(workOrders) {
  const now = new Date();

  return workOrders
    .map((workOrder) => {
      let riskScore = 0;
      const reasons = [];

      const status =
        workOrder.executionStatus?.toLowerCase() ||
        "";

      if (
        /delay|delayed|hold|on hold|not started|blocked|update required/i.test(
          status
        )
      ) {
        riskScore += 3;

        reasons.push(
          `Execution status: ${workOrder.executionStatus}`
        );
      }

      if (
        workOrder.endDate
      ) {
        const endDate = new Date(
          workOrder.endDate
        );

        if (
          endDate < now &&
          !/completed|executed/i.test(status)
        ) {
          riskScore += 3;

          reasons.push(
            "Probable end date has passed"
          );
        }
      } else {
        riskScore += 1;

        reasons.push(
          "Missing probable end date"
        );
      }

      if (
        workOrder.billingStatus &&
        /update required|pending|overdue/i.test(
          workOrder.billingStatus
        )
      ) {
        riskScore += 2;

        reasons.push(
          `Billing status: ${workOrder.billingStatus}`
        );
      }

      if (
        workOrder.receivable &&
        workOrder.receivable > 0
      ) {
        riskScore += 1;

        reasons.push(
          "Outstanding receivable"
        );
      }

      return {
        ...workOrder,
        riskScore,
        riskReasons: reasons
      };
    })
    .filter(
      (workOrder) =>
        workOrder.riskScore >= 3
    )
    .sort(
      (a, b) =>
        b.riskScore -
        a.riskScore
    );
}

/* =========================================================
   DATA QUALITY
========================================================= */

function calculateDataQuality(
  deals,
  workOrders
) {
  return {
    deals: {
      total: deals.length,

      missingSector: deals.filter(
        (d) => !d.sector
      ).length,

      missingAmount: deals.filter(
        (d) => d.amount === null
      ).length,

      missingProbability:
        deals.filter(
          (d) =>
            d.probability === null
        ).length,

      missingCloseDate:
        deals.filter(
          (d) =>
            !d.effectiveCloseDate
        ).length
    },

    workOrders: {
      total: workOrders.length,

      missingSector:
        workOrders.filter(
          (w) => !w.sector
        ).length,

      missingAmount:
        workOrders.filter(
          (w) =>
            w.amountInclGST === null
        ).length,

      missingEndDate:
        workOrders.filter(
          (w) => !w.endDate
        ).length,

      outstandingReceivables:
        workOrders.filter(
          (w) =>
            w.receivable &&
            w.receivable > 0
        ).length
    }
  };
}

/* =========================================================
   SECTOR DETECTION
========================================================= */

function detectSector(question) {
  const text =
    question.toLowerCase();

  const sectors = [
    "energy",
    "mining",
    "powerline",
    "technology",
    "healthcare",
    "finance",
    "manufacturing"
  ];

  for (const sector of sectors) {
    if (text.includes(sector)) {
      return sector
        .replace(/\b\w/g, (c) =>
          c.toUpperCase()
        );
    }
  }

  return null;
}

/* =========================================================
   TABLE HELPERS
========================================================= */

function money(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return "—";
  }

  return `₹${Math.round(value).toLocaleString(
    "en-IN"
  )}`;
}

function percent(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return "—";
  }

  return `${Math.round(value * 100)}%`;
}

function createPipelineTable(deals) {
  return {
    title: "Pipeline by Sector",

    columns: [
      "Sector",
      "Deals",
      "Pipeline",
      "Weighted Pipeline"
    ],

    rows: Object.entries(
      calculatePipeline(deals).bySector
    )
      .sort(
        (a, b) =>
          b[1].pipeline -
          a[1].pipeline
      )
      .map(
        ([sector, data]) => [
          sector,
          data.deals,
          money(data.pipeline),
          money(
            data.weightedPipeline
          )
        ]
      )
  };
}

function createDealRiskTable(deals) {
  return {
    title: "Deals Requiring Attention",

    columns: [
      "Deal",
      "Sector",
      "Stage",
      "Amount",
      "Probability",
      "Close Date",
      "Risk"
    ],

    rows: deals
      .slice(0, 15)
      .map((deal) => [
        deal.name || "Unnamed",
        deal.sector || "Unknown",
        deal.stage || "Unknown",
        money(deal.amount),
        percent(
          deal.probability
        ),
        deal.effectiveCloseDate ||
          "Missing",
        deal.riskReasons.join(
          "; "
        )
      ])
  };
}

function createWorkOrderRiskTable(
  workOrders
) {
  return {
    title:
      "Work Orders Requiring Attention",

    columns: [
      "Work Order",
      "Sector",
      "Execution Status",
      "End Date",
      "Value",
      "Billing Status",
      "Risk"
    ],

    rows: workOrders
      .slice(0, 15)
      .map((workOrder) => [
        workOrder.name ||
          "Unnamed",

        workOrder.sector ||
          "Unknown",

        workOrder.executionStatus ||
          "Unknown",

        workOrder.endDate ||
          "Missing",

        money(
          workOrder.amountInclGST
        ),

        workOrder.billingStatus ||
          "—",

        workOrder.riskReasons.join(
          "; "
        )
      ])
  };
}

/* =========================================================
   HANDLER
========================================================= */

async function handler(
  request,
  response
) {
  try {
    if (request.method !== "POST") {
      return response.status(405).json({
        error:
          "Method not allowed"
      });
    }

    const {
      MONDAY_API_TOKEN,
      MONDAY_DEALS_BOARD_ID,
      MONDAY_WORK_ORDERS_BOARD_ID,
      GROQ_API_KEY
    } = process.env;

    if (
      !MONDAY_API_TOKEN ||
      !MONDAY_DEALS_BOARD_ID ||
      !MONDAY_WORK_ORDERS_BOARD_ID ||
      !GROQ_API_KEY
    ) {
      return response.status(500).json({
        error:
          "Missing required environment variable."
      });
    }

    const { message } =
      request.body || {};

    if (
      !message ||
      typeof message !== "string"
    ) {
      return response.status(400).json({
        error:
          "Please provide a message."
      });
    }

    /* -----------------------------------------------------
       FETCH LIVE DATA
    ----------------------------------------------------- */

    const [
      dealBoard,
      workOrderBoard
    ] = await Promise.all([
      getBoardItems(
        MONDAY_DEALS_BOARD_ID
      ),

      getBoardItems(
        MONDAY_WORK_ORDERS_BOARD_ID
      )
    ]);

    /* -----------------------------------------------------
       NORMALIZE
    ----------------------------------------------------- */

    const deals =
      dealBoard.items.map(
        normalizeDeal
      );

    const workOrders =
      workOrderBoard.items.map(
        normalizeWorkOrder
      );

    /* -----------------------------------------------------
       ANALYTICS
    ----------------------------------------------------- */

    const currentQuarter =
      getCurrentQuarter();

    const currentQuarterDeals =
      deals.filter((deal) =>
        isDateInCurrentQuarter(
          deal.effectiveCloseDate
        )
      );

    const pipeline =
      calculatePipeline(deals);

    const currentQuarterPipeline =
      calculatePipeline(
        currentQuarterDeals
      );

    const dealRisks =
      findDealRisks(deals);

    const workOrderRisks =
      findWorkOrderRisks(
        workOrders
      );

    const quality =
      calculateDataQuality(
        deals,
        workOrders
      );

    /* -----------------------------------------------------
       FILTER BY SECTOR
    ----------------------------------------------------- */

    const requestedSector =
      detectSector(message);

    const sectorDeals =
      requestedSector
        ? deals.filter(
            (deal) =>
              deal.sector?.toLowerCase() ===
              requestedSector.toLowerCase()
          )
        : deals;

    const sectorQuarterDeals =
      requestedSector
        ? currentQuarterDeals.filter(
            (deal) =>
              deal.sector?.toLowerCase() ===
              requestedSector.toLowerCase()
          )
        : currentQuarterDeals;

    const sectorPipeline =
      calculatePipeline(
        sectorDeals
      );

    const sectorQuarterPipeline =
      calculatePipeline(
        sectorQuarterDeals
      );

    /* -----------------------------------------------------
       DETERMINE QUESTION TYPE
    ----------------------------------------------------- */

    const question =
      message.toLowerCase();

    const asksRisk =
      question.includes("risk") ||
      question.includes("attention") ||
      question.includes("problem") ||
      question.includes("concern");

    const asksLeadership =
      question.includes(
        "leadership"
      ) ||
      question.includes(
        "executive update"
      );

    const asksWorkOrders =
      question.includes(
        "work order"
      ) ||
      question.includes(
        "operations"
      ) ||
      question.includes(
        "execution"
      );

    /* -----------------------------------------------------
       CREATE TABLES
    ----------------------------------------------------- */

    const tables = [];

    if (
      requestedSector ||
      question.includes(
        "pipeline"
      )
    ) {
      tables.push(
        createPipelineTable(
          requestedSector
            ? sectorDeals
            : deals
        )
      );
    }

    if (asksRisk) {
      if (asksWorkOrders) {
        tables.push(
          createWorkOrderRiskTable(
            workOrderRisks
          )
        );
      } else {
        tables.push(
          createDealRiskTable(
            dealRisks
          )
        );
      }
    }

    if (asksLeadership) {
      tables.push(
        createPipelineTable(
          deals
        )
      );

      tables.push(
        createWorkOrderRiskTable(
          workOrderRisks
        )
      );
    }

    /* -----------------------------------------------------
       COMPACT CONTEXT FOR GROQ
    ----------------------------------------------------- */

    const compactContext = {
      question: message,

      currentQuarter:
        currentQuarter.label,

      requestedSector,

      overallPipeline: {
        deals:
          pipeline.dealCount,

        pipeline:
          pipeline.totalPipeline,

        weightedPipeline:
          pipeline.weightedPipeline
      },

      currentQuarterPipeline: {
        deals:
          currentQuarterPipeline.dealCount,

        pipeline:
          currentQuarterPipeline.totalPipeline,

        weightedPipeline:
          currentQuarterPipeline.weightedPipeline
      },

      requestedSectorPipeline:
        requestedSector
          ? {
              deals:
                sectorPipeline.dealCount,

              pipeline:
                sectorPipeline.totalPipeline,

              weightedPipeline:
                sectorPipeline.weightedPipeline
            }
          : null,

      requestedSectorCurrentQuarter:
        requestedSector
          ? {
              deals:
                sectorQuarterPipeline.dealCount,

              pipeline:
                sectorQuarterPipeline.totalPipeline,

              weightedPipeline:
                sectorQuarterPipeline.weightedPipeline
            }
          : null,

      dealRiskCount:
        dealRisks.length,

      workOrderRiskCount:
        workOrderRisks.length,

      dataQuality: quality,

      tables: tables.map(
        (table) => ({
          title: table.title,
          columns: table.columns,
          rows: table.rows.slice(0, 10)
        })
      )
    };

    /* -----------------------------------------------------
       GROQ
    ----------------------------------------------------- */

    const groq =
      new Groq({
        apiKey:
          GROQ_API_KEY
      });

    const completion =
      await groq.chat.completions.create(
        {
          model:
            "openai/gpt-oss-20b",

          temperature: 0.2,

          max_tokens: 1000,

          messages: [
            {
              role: "system",

              content: `
You are Founder BI, an executive business intelligence assistant.

Answer the founder's question using ONLY the supplied
calculated context.

IMPORTANT:

- Never invent numbers.
- Do not make up missing data.
- JavaScript has already performed the calculations.
- Your job is to explain the results.
- Use Indian Rupees (₹) because the underlying work-order
  financial data is in Rupees.
- Be concise and executive-friendly.
- Mention important data-quality caveats.
- If a requested sector has zero records, say that clearly.
- If the current-quarter pipeline is zero because there are
  no records dated in the current quarter, explain that.
- Do not claim that zero means no business exists if the data
  itself may be incomplete.

For executive responses, use:

**Summary**

Write 2-4 concise sentences.

**Key numbers**

Use short bullet points only.

**Insights**

Use 3-5 concise bullet points.

**Risks / caveats**

Use concise bullet points.

**Recommended action**

Use a numbered list of practical actions.

For leadership updates, summarize sales and operations
together.

IMPORTANT FORMATTING RULES:

- NEVER create a Markdown table.
- NEVER use the "|" character to create a table.
- NEVER output rows and columns.
- NEVER repeat the table data supplied in the context.
- The application renders structured tables separately.
- Only provide the narrative explanation.
- Use bullets or numbered lists for numbers.
`
            },

            {
              role: "user",

              content:
                JSON.stringify(
                  compactContext
                )
            }
          ]
        }
      );

    const answer =
      completion.choices?.[0]
        ?.message?.content ||
      "I couldn't generate an answer.";

    /* -----------------------------------------------------
       RESPONSE
    ----------------------------------------------------- */

    return response.status(200).json({
      answer,

      tables,

      dataQuality: quality,

      metadata: {
        currentQuarter:
          currentQuarter.label,

        requestedSector,

        dealsAnalyzed:
          deals.length,

        workOrdersAnalyzed:
          workOrders.length
      }
    });

  } catch (error) {
    console.error(error);

    return response.status(500).json({
      error:
        error.message ||
        "Something went wrong."
    });
  }
}

module.exports = handler;