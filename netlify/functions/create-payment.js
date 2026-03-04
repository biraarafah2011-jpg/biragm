// netlify/functions/create-payment.js
// Perantara ke Midtrans — server key aman di sini, tidak terekspos ke browser

const https = require("https");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const body = JSON.parse(event.body);
    const auth = Buffer.from("Mid-server-UTDNLi0Xs3UbgRmaxU1nA7_:").toString("base64");

    const result = await new Promise((resolve, reject) => {
      const data    = JSON.stringify(body);
      const options = {
        hostname: "app.midtrans.com",
        path:     "/snap/v1/transactions",
        method:   "POST",
        headers: {
          "Content-Type":   "application/json",
          "Authorization":  "Basic " + auth,
          "Content-Length": Buffer.byteLength(data)
        }
      };

      const req = https.request(options, res => {
        let raw = "";
        res.on("data",  chunk => raw += chunk);
        res.on("end",   ()    => {
          try { resolve(JSON.parse(raw)); }
          catch (e) { reject(new Error("Invalid JSON from Midtrans: " + raw)); }
        });
      });

      req.on("error", reject);
      req.write(data);
      req.end();
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result)
    };

  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e.message })
    };
  }
};
