const axios = require("axios");
const fs = require("fs");

// 👉 Paste your access token here
const ACCESS_TOKEN = "eyJ0eXAiOiJKV1QiLCJrZXlfaWQiOiJza192MS4wIiwiYWxnIjoiSFMyNTYifQ.eyJzdWIiOiI3M0IyRlMiLCJqdGkiOiI2OTlmMGJmNjVjNTdjODY5OTEwOTM1MDIiLCJpc011bHRpQ2xpZW50IjpmYWxzZSwiaXNQbHVzUGxhbiI6dHJ1ZSwiaWF0IjoxNzcyMDMwOTY2LCJpc3MiOiJ1ZGFwaS1nYXRld2F5LXNlcnZpY2UiLCJleHAiOjE3NzIwNTY4MDB9.hcTaAeGcp7tlMrX8dSMNi68wDFZN_J_UnYrjh_qv-Wk";

// 👉 File name to save
const FILE_NAME = "option-chain.json";

async function fetchAndSave() {

    try {

        const response = await axios.get(
            "https://api.upstox.com/v2/option/chain",
            {
                params: {
                    instrument_key: "NSE_INDEX|Nifty 50",
                    expiry_date: "2026-03-02"
                },
                headers: {
                    Authorization: `Bearer ${ACCESS_TOKEN}`,
                    Accept: "application/json"
                }
            }
        );

        // Save to file
        fs.writeFileSync(
            FILE_NAME,
            JSON.stringify(response.data, null, 2)
        );

        console.log("✅ Data fetched successfully");
        console.log("📁 Saved to:", FILE_NAME);

    }
    catch (error) {

        console.log("❌ Error");

        console.log(error.response?.data || error.message);

    }

}

fetchAndSave();