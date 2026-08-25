require("dotenv").config({ path: ".env.local" });

const MONDAY_URL = "https://api.monday.com/v2";

function cleanText(value) {
  if (value === null || value === undefined) return null;

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
  if (value === null || value === undefined) return null;

  const text = String(value)
    .replace(/[$₹€£,\s]/g, "")
    .trim();

  if (!text) return null;

  const match = text.match(/-?\d+(\.\d+)?/);

  if (!match) return null;

  const number = Number(match[0]);

  return Number.isFinite(number) ? number : null;
}

function normalizeDate(value) {
  if (!value) return null;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return null;

  return date.toISOString().slice(0, 10);
}

function normalizeProbability(value) {
  const text = cleanText(value);

  if (!text) return null;

  const lower = text.toLowerCase();

  if (lower.includes("high")) return 0.8;
  if (lower.includes("medium")) return 0.5;
  if (lower.includes("low")) return 0.2;

  const number = parseNumber(text);

  if (number === null) return null;

  if (number > 1) {
    return Math.min(number / 100, 1);
  }

  return Math.max(number, 0);
}

async function mondayRequest(query, variables = {}) {
  const response = await fetch(MONDAY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: process.env.MONDAY_API_TOKEN,
    },
    body: JSON.stringify({
      query,
      variables,
    }),
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
    boardId: String(boardId),
  });

  const board = data.boards?.[0];

  if (!board) {
    throw new Error(`Monday board ${boardId} was not found.`);
  }

  return {
    boardName: board.name,
    items: board.items_page?.items || [],
  };
}

function getColumn(item, title) {
  const column = item.column_values?.find(
    (column) =>
      column.column?.title?.toLowerCase() === title.toLowerCase()
  );

  return column?.text || null;
}

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

    status: cleanText(
      getColumn(item, "Deal Status")
    ),

    sector: cleanText(
      getColumn(item, "Sector/service")
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

    stage: cleanText(
      getColumn(item, "Deal Stage")
    ),
  };
}

function normalizeWorkOrder(item) {
  return {
    id: item.id,

    name: cleanText(item.name),

    executionStatus: cleanText(
      getColumn(item, "Execution Status")
    ),

    endDate: normalizeDate(
      getColumn(item, "Probable End Date")
    ),

    sector: cleanText(
      getColumn(item, "Sector")
    ),

    amount: parseNumber(
      getColumn(
        item,
        "Amount in Rupees (Incl of GST) (Masked)"
      )
    ),

    receivable: parseNumber(
      getColumn(
        item,
        "Amount Receivable (Masked)"
      )
    ),

    billingStatus: cleanText(
      getColumn(item, "Billing Status")
    ),
  };
}

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
    label: `Q${quarter} ${now.getFullYear()}`,
    start,
    end,
  };
}

function isCurrentQuarter(dateString) {
  if (!dateString) return false;

  const date = new Date(dateString);

  if (Number.isNaN(date.getTime())) return false;

  const quarter = getCurrentQuarter();

  return (
    date >= quarter.start &&
    date <= quarter.end
  );
}

function calculatePipeline(deals) {
  const validDeals = deals.filter(
    (deal) => deal.amount !== null
  );

  const pipeline = validDeals.reduce(
    (sum, deal) => sum + deal.amount,
    0
  );

  const weightedPipeline = validDeals.reduce(
    (sum, deal) =>
      sum +
      deal.amount *
        (deal.probability ?? 0),
    0
  );

  return {
    dealCount: validDeals.length,
    pipeline,
    weightedPipeline,
  };
}

function calculateSectorPipeline(deals) {
  const sectors = {};

  for (const deal of deals) {
    if (deal.amount === null) continue;

    const sector = deal.sector || "Unknown";

    if (!sectors[sector]) {
      sectors[sector] = {
        deals: 0,
        pipeline: 0,
        weightedPipeline: 0,
      };
    }

    sectors[sector].deals += 1;
    sectors[sector].pipeline += deal.amount;

    sectors[sector].weightedPipeline +=
      deal.amount *
      (deal.probability ?? 0);
  }

  return Object.entries(sectors)
    .map(([sector, data]) => ({
      sector,
      ...data,
    }))
    .sort(
      (a, b) => b.pipeline - a.pipeline
    );
}

function findDealRisks(deals) {
  const now = new Date();

  return deals
    .map((deal) => {
      let score = 0;
      const reasons = [];

      if (
        deal.probability !== null &&
        deal.probability <= 0.2
      ) {
        score += 3;
        reasons.push("Low probability");
      }

      if (
        deal.effectiveCloseDate
      ) {
        const closeDate = new Date(
          deal.effectiveCloseDate
        );

        if (
          closeDate < now &&
          deal.status?.toLowerCase() === "open"
        ) {
          score += 3;
          reasons.push("Close date passed");
        }
      } else {
        score += 1;
        reasons.push("Missing close date");
      }

      if (
        deal.stage &&
        /hold|lost|stalled|inactive/i.test(
          deal.stage
        )
      ) {
        score += 3;
        reasons.push(
          `Stage: ${deal.stage}`
        );
      }

      return {
        ...deal,
        riskScore: score,
        riskReasons: reasons,
      };
    })
    .filter(
      (deal) => deal.riskScore >= 3
    )
    .sort(
      (a, b) =>
        b.riskScore - a.riskScore
    );
}

function findWorkOrderRisks(workOrders) {
  const now = new Date();

  return workOrders
    .map((workOrder) => {
      let score = 0;
      const reasons = [];

      const status =
        workOrder.executionStatus?.toLowerCase() ||
        "";

      if (
        /delay|delayed|hold|on hold|not started|blocked|update required/i.test(
          status
        )
      ) {
        score += 3;

        reasons.push(
          `Status: ${workOrder.executionStatus}`
        );
      }

      if (workOrder.endDate) {
        const endDate = new Date(
          workOrder.endDate
        );

        if (
          endDate < now &&
          !/completed|executed/i.test(status)
        ) {
          score += 3;

          reasons.push(
            "End date passed"
          );
        }
      } else {
        score += 1;
        reasons.push("Missing end date");
      }

      if (
        workOrder.receivable &&
        workOrder.receivable > 0
      ) {
        score += 1;

        reasons.push(
          "Outstanding receivable"
        );
      }

      return {
        ...workOrder,
        riskScore: score,
        riskReasons: reasons,
      };
    })
    .filter(
      (workOrder) =>
        workOrder.riskScore >= 3
    )
    .sort(
      (a, b) =>
        b.riskScore - a.riskScore
    );
}

function formatMoney(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return 0;
  }

  return Math.round(value);
}

async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res
        .status(405)
        .json({
          error: "Method not allowed",
        });
    }

    const {
      MONDAY_API_TOKEN,
      MONDAY_DEALS_BOARD_ID,
      MONDAY_WORK_ORDERS_BOARD_ID,
    } = process.env;

    if (
      !MONDAY_API_TOKEN ||
      !MONDAY_DEALS_BOARD_ID ||
      !MONDAY_WORK_ORDERS_BOARD_ID
    ) {
      return res
        .status(500)
        .json({
          error:
            "Missing Monday environment variables.",
        });
    }

    const [
      dealsBoard,
      workOrdersBoard,
    ] = await Promise.all([
      getBoardItems(
        MONDAY_DEALS_BOARD_ID
      ),

      getBoardItems(
        MONDAY_WORK_ORDERS_BOARD_ID
      ),
    ]);

    const deals =
      dealsBoard.items.map(
        normalizeDeal
      );

    const workOrders =
      workOrdersBoard.items.map(
        normalizeWorkOrder
      );

    const quarter =
      getCurrentQuarter();

    const currentQuarterDeals =
      deals.filter((deal) =>
        isCurrentQuarter(
          deal.effectiveCloseDate
        )
      );

    const pipeline =
      calculatePipeline(deals);

    const currentQuarterPipeline =
      calculatePipeline(
        currentQuarterDeals
      );

    const sectors =
      calculateSectorPipeline(deals);

    const dealRisks =
      findDealRisks(deals);

    const workOrderRisks =
      findWorkOrderRisks(
        workOrders
      );

    const outstandingReceivables =
      workOrders.reduce(
        (sum, workOrder) =>
          sum +
          (workOrder.receivable || 0),
        0
      );

    const missingDealData = {
      sector: deals.filter(
        (d) => !d.sector
      ).length,

      amount: deals.filter(
        (d) => d.amount === null
      ).length,

      probability: deals.filter(
        (d) => d.probability === null
      ).length,

      closeDate: deals.filter(
        (d) => !d.effectiveCloseDate
      ).length,
    };

    const missingWorkOrderData = {
      sector: workOrders.filter(
        (w) => !w.sector
      ).length,

      amount: workOrders.filter(
        (w) => w.amount === null
      ).length,

      endDate: workOrders.filter(
        (w) => !w.endDate
      ).length,
    };

    return res.status(200).json({
      quarter: quarter.label,

      kpis: {
        totalPipeline:
          formatMoney(
            pipeline.pipeline
          ),

        weightedPipeline:
          formatMoney(
            pipeline.weightedPipeline
          ),

        currentQuarterPipeline:
          formatMoney(
            currentQuarterPipeline.pipeline
          ),

        deals:
          pipeline.dealCount,

        totalDeals:
          deals.length,

        workOrders:
          workOrders.length,

        dealRisks:
          dealRisks.length,

        workOrderRisks:
          workOrderRisks.length,

        outstandingReceivables:
          formatMoney(
            outstandingReceivables
          ),
      },

      sectors,

      dealRisks:
        dealRisks.slice(0, 10).map(
          (deal) => ({
            name:
              deal.name ||
              "Unnamed",

            sector:
              deal.sector ||
              "Unknown",

            stage:
              deal.stage ||
              "Unknown",

            amount:
              formatMoney(
                deal.amount
              ),

            probability:
              deal.probability,

            closeDate:
              deal.effectiveCloseDate,

            risk:
              deal.riskReasons.join(
                "; "
              ),
          })
        ),

      workOrderRisks:
        workOrderRisks
          .slice(0, 10)
          .map((workOrder) => ({
            name:
              workOrder.name ||
              "Unnamed",

            sector:
              workOrder.sector ||
              "Unknown",

            status:
              workOrder.executionStatus ||
              "Unknown",

            endDate:
              workOrder.endDate,

            amount:
              formatMoney(
                workOrder.amount
              ),

            receivable:
              formatMoney(
                workOrder.receivable
              ),

            risk:
              workOrder.riskReasons.join(
                "; "
              ),
          })),

      dataQuality: {
        deals:
          missingDealData,

        workOrders:
          missingWorkOrderData,
      },
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error:
        error.message ||
        "Unable to load dashboard.",
    });
  }
}

module.exports = handler;