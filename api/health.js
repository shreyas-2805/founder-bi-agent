require("dotenv").config({ path: ".env.local" });

module.exports = (_request, response) => {
  response.status(200).json({
    status: "ok",
    mondayToken: Boolean(process.env.MONDAY_API_TOKEN),
    dealsBoard: Boolean(process.env.MONDAY_DEALS_BOARD_ID),
    workOrdersBoard: Boolean(process.env.MONDAY_WORK_ORDERS_BOARD_ID),
    groqKey: Boolean(process.env.GROQ_API_KEY)
  });
};