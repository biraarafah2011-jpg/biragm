// netlify/functions/create-payment.js
// Payment gateway: Saya Bayar (sayabayar.com)
// API key dibaca dari environment variable SAYABAYAR_API_KEY
// Harga divalidasi dari Firebase — client tidak bisa manipulasi amount

const https = require("https");

// ── Helper: fetch dari Firebase REST API ──────────────────────
function firebaseGet(path) {
  const dbUrl    = process.env.FIREBASE_DB_URL;
  const fbSecret = process.env.FIREBASE_DB_SECRET;
  return new Promise((resolve, reject) => {
    const urlStr = dbUrl + path + ".json" + (fbSecret ? "?auth=" + fbSecret : "");
    const url    = new URL(urlStr);
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

// ── Helper: kirim request ke Saya Bayar ───────────────────────
function sayaBayarRequest(path, method, body) {
  const apiKey = process.env.SAYABAYAR_API_KEY;
  if (!apiKey) throw new Error("SAYABAYAR_API_KEY belum diset di env");

  const data    = body ? JSON.stringify(body) : null;
  const options = {
    hostname: "api.sayabayar.com",
    path,
    method,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key":    apiKey
    }
  };
  if (data) options.headers["Content-Length"] = Buffer.byteLength(data);

  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let raw = "";
      res.on("data", chunk => raw += chunk);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch (e) { reject(new Error("Saya Bayar parse error: " + raw)); }
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
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
    const itemId = body.item_id;
    if (!itemId) {
      return { statusCode: 400, body: JSON.stringify({ error: "item_id wajib ada" }) };
    }

    // ── 2. Ambil harga ASLI dari Firebase (jangan percaya client) ─
    console.log("[1] Mengambil item dari Firebase, itemId:", itemId);
    const item = await firebaseGet("/items/" + itemId);
    console.log("[2] Data item dari Firebase:", JSON.stringify(item));

    if (!item) {
      return { statusCode: 404, body: JSON.stringify({ error: "Item tidak ditemukan" }) };
    }
    if (item.type !== "paid") {
      return { statusCode: 400, body: JSON.stringify({ error: "Item ini gratis, tidak perlu bayar" }) };
    }

    const realPrice = Number(item.price);
    console.log("[3] Harga item:", realPrice);
    if (!realPrice || realPrice <= 0) {
      return { statusCode: 400, body: JSON.stringify({ error: "Harga item tidak valid" }) };
    }

    // ── 3. Bangun order_id internal kita sendiri ──────────────
    const orderId = "biragm-" + itemId.slice(-6) + "-" + Date.now();

    const customerName  = (body.customer_name  || "Guest").slice(0, 100);
    const customerEmail = body.customer_email || "guest@biragm.com";

    // ── 4. Buat invoice di Saya Bayar ──────────────────────────
    const invoicePayload = {
      customer_name:      customerName,
      customer_email:     customerEmail,
      amount:             realPrice,
      description:        item.title,
      channel_preference: "platform",
      redirect_url:       "https://biragm-website.netlify.app/"
    };

    console.log("[4] Mengirim request ke Saya Bayar:", JSON.stringify(invoicePayload));

    const { status, body: result } = await sayaBayarRequest("/v1/invoices", "POST", invoicePayload);

    console.log("[5] Saya Bayar HTTP status:", status);
    console.log("[6] Saya Bayar response body:", JSON.stringify(result));

    if (status !== 201 || !result.success) {
      const errMsg = result?.error?.message || result?.message || "Gagal membuat invoice di Saya Bayar";
      console.error("[ERROR] Saya Bayar gagal — status:", status, "message:", errMsg);
      return {
        statusCode: 502,
        body: JSON.stringify({ error: errMsg })
      };
    }

    // ── 5. Simpan pemetaan invoice_id -> order_id/item_id di Firebase ─
    const dbUrl    = process.env.FIREBASE_DB_URL;
    const fbSecret = process.env.FIREBASE_DB_SECRET;
    await new Promise((resolve, reject) => {
      const mapBody = JSON.stringify({
        orderId,
        itemId,
        itemId6:   itemId.slice(-6),
        amount:    realPrice,
        createdAt: Date.now()
      });
      const urlStr = dbUrl + "/invoice_map/" + result.data.id + ".json" +
        (fbSecret ? "?auth=" + fbSecret : "");
      const url = new URL(urlStr);
      const options = {
        hostname: url.hostname,
        path:     url.pathname + url.search,
        method:   "PUT",
        headers:  { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(mapBody) }
      };
      const req = https.request(options, res => {
        let raw = "";
        res.on("data", c => raw += c);
        res.on("end", () => {
          console.log("[7] Firebase invoice_map tersimpan:", raw);
          resolve(raw);
        });
      });
      req.on("error", reject);
      req.write(mapBody);
      req.end();
    });

    // ── 6. Kembalikan info yang dibutuhkan frontend ────────────
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        order_id:     orderId,
        invoice_id:   result.data.id,
        payment_url:  result.data.payment_url,
        expired_at:   result.data.expired_at
      })
    };

  } catch (e) {
    console.error("create-payment error:", e);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e.message })
    };
  }
};
