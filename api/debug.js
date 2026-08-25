require("dotenv").config({ path: ".env.local" });

const MONDAY_URL = "https://api.monday.com/v2";

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

module.exports = async function handler(req, res) {
  try {
    const boardIds = [
      process.env.MONDAY_DEALS_BOARD_ID,
      process.env.MONDAY_WORK_ORDERS_BOARD_ID
    ];

    const query = `
      query ($boardIds: [ID!]) {
        boards(ids: $boardIds) {
          id
          name

          columns {
            id
            title
            type
          }

          items_page(limit: 3) {
            items {
              id
              name

              column_values {
                id
                text
                value
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
      boardIds
    });

    res.status(200).json(data);

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: error.message
    });
  }
};