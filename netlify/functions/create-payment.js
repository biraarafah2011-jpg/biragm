// netlify/functions/create-payment.js
// Server key dibaca dari environment variable MIDTRANS_SERVER_KEY
// Harga divalidasi dari Firebase — client tidak bisa manipulasi amount

const https = require("https");

// ── Helper: fetch dari Firebase REST API ──────────────────────
function firebaseGet(path) {
  const dbUrl = process.env.FIREBASE_DB_URL; // e.g. https://biragm-website-default-rtdb.asia-southeast1.firebasedatabase.app
  return new Promise((resolve, reject) => {
    const url = new URL(dbUrl + path + ".json");
    https.get(url.toString(), res => {
      let raw = "";
      res.on("data", chunk => raw += chunk);
      res.on("end", () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error("Firebase parse error: " + raw)); }
      });
    }).on("error", reject);
  });
}

// ── Helper: simpan unlock ke Firebase REST API ────────────────
function firebaseSet(path, data) {
  const dbUrl    = process.env.FIREBASE_DB_URL;
  const fbSecret = process.env.FIREBASE_DB_SECRET; // Database secret untuk server-side write
  return new Promise((resolve, reject) => {
    const body    = JSON.stringify(data);
    const urlStr  = dbUrl + path + ".json" + (fbSecret ? "?auth=" + fbSecret : "");
    const url     = new URL(urlStr);
    const options = {
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method:   "PUT",
      headers:  {
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(body)
      }
    };
    const req = https.request(options, res => {
      let raw = "";
      res.on("data", chunk => raw += chunk);
      res.on("end", () => resolve(raw));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── Helper: kirim request ke Midtrans ────────────────────────
function midtransRequest(path, body) {
  const serverKey = process.env.MIDTRANS_SERVER_KEY;
  if (!serverKey) throw new Error("MIDTRANS_SERVER_KEY belum diset di env");
  const auth    = Buffer.from(serverKey + ":").toString("base64");
  const data    = JSON.stringify(body);
  const options = {
    hostname: "app.midtrans.com",
    path,
    method:   "POST",
    headers:  {
      "Content-Type":   "application/json",
      "Authorization":  "Basic " + auth,
      "Content-Length": Buffer.byteLength(data)
    }
  };
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let raw = "";
      res.on("data",  chunk => raw += chunk);
      res.on("end",   () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error("Midtrans parse error: " + raw)); }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// ── HANDLER UTAMA ─────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const body = JSON.parse(event.body);

    // ── 1. Ambil item_id dari request ──────────────────────────
    const itemDetails = body.item_details;
    if (!itemDetails || !Array.isArray(itemDetails) || itemDetails.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ error: "item_details wajib ada" }) };
    }

    const itemId = itemDetails[0]?.id;
    if (!itemId) {
      return { statusCode: 400, body: JSON.stringify({ error: "item id tidak valid" }) };
    }

    // ── 2. Ambil harga ASLI dari Firebase (jangan percaya client) ─
    const item = await firebaseGet("/items/" + itemId);
    if (!item) {
      return { statusCode: 404, body: JSON.stringify({ error: "Item tidak ditemukan" }) };
    }
    if (item.type !== "paid") {
      return { statusCode: 400, body: JSON.stringify({ error: "Item ini gratis, tidak perlu bayar" }) };
    }

    const realPrice = Number(item.price);
    if (!realPrice || realPrice <= 0) {
      return { statusCode: 400, body: JSON.stringify({ error: "Harga item tidak valid" }) };
    }

    // ── 3. Override gross_amount & item price dengan harga asli ──
    body.transaction_details.gross_amount = realPrice;
    body.item_details[0].price            = realPrice;
    body.item_details[0].name             = item.title;

    // ── 4. Kirim ke Midtrans ───────────────────────────────────
    const result = await midtransRequest("/snap/v1/transactions", body);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result)
    };

  } catch (e) {
    console.error("create-payment error:", e);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e.message })
    };
  }
};
